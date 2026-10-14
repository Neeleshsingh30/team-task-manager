"""Account authentication and workspace role enforcement."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, MetaData, String, Table, Uuid, and_, func, insert, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email import invitation_url, send_invitation_email
from app.db.session import SessionLocal, engine, get_db


auth_router = APIRouter(prefix="/auth", tags=["authentication"])
logger = logging.getLogger(__name__)
metadata = MetaData()
metadata.reflect(bind=engine, only=["users", "workspaces", "workspace_members", "projects", "tasks", "task_comments", "notifications"])
tables = metadata.tables
invitations = Table(
    "workspace_invitations", metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True),
    Column("workspace_id", Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    Column("email", String(255), nullable=False),
    Column("role", String(30), CheckConstraint("role IN ('ADMIN', 'MEMBER')"), nullable=False),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("invited_by", Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("accepted_at", DateTime(timezone=True)),
    extend_existing=True,
)
Index("ix_workspace_invitations_workspace_email", invitations.c.workspace_id, invitations.c.email)
metadata.create_all(engine, tables=[invitations], checkfirst=True)

bearer = HTTPBearer(auto_error=False)
realtime_router = APIRouter(tags=["workspace events"])


class WorkspaceConnections:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast_refresh(self) -> None:
        stale = []
        for websocket in tuple(self.connections):
            try:
                await websocket.send_json({"type": "workspace.refresh"})
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)


workspace_connections = WorkspaceConnections()


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${_b64(salt)}${_b64(derived)}"


def _password_matches(password: str, saved: str) -> bool:
    try:
        algorithm, salt_text, digest_text = saved.split("$", 2)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = base64.urlsafe_b64decode(digest_text + "=" * (-len(digest_text) % 4))
        actual = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _token_for(user_id: Any) -> str:
    now = datetime.now(timezone.utc)
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps({
        "sub": str(user_id), "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=get_settings().access_token_minutes)).timestamp()),
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}".encode()
    signature = hmac.new(get_settings().auth_secret_key.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64(signature)}"


def _token_subject(token: str) -> uuid.UUID:
    try:
        header, payload, signature = token.split(".")
        signing_input = f"{header}.{payload}".encode()
        expected = _b64(hmac.new(get_settings().auth_secret_key.encode(), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(expected, signature):
            raise ValueError("signature")
        decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        claims = json.loads(decoded)
        if int(claims["exp"]) <= int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("expired")
        return uuid.UUID(claims["sub"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc


@realtime_router.websocket("/ws/workspaces/{workspace_id}")
async def workspace_events(websocket: WebSocket, workspace_id: str) -> None:
    try:
        offered_protocols = [part.strip() for part in websocket.headers.get("sec-websocket-protocol", "").split(",")]
        if len(offered_protocols) != 2 or offered_protocols[0] != "bearer":
            raise ValueError("missing bearer protocol")
        token = offered_protocols[1]
        user_id = _token_subject(token)
        parsed_workspace_id = uuid.UUID(workspace_id)
    except (HTTPException, ValueError):
        await websocket.close(code=4401)
        return
    db = SessionLocal()
    try:
        membership = db.execute(select(tables["workspace_members"]).where(and_(
            tables["workspace_members"].c.workspace_id == parsed_workspace_id,
            tables["workspace_members"].c.user_id == user_id,
        ))).first()
        if membership is None:
            await websocket.close(code=4403)
            return
    finally:
        db.close()
    await websocket.accept(subprotocol="bearer")
    workspace_connections.connections.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        workspace_connections.disconnect(websocket)


def _public_user(row: Any) -> dict[str, Any]:
    data = dict(row._mapping)
    data.pop("password_hash", None)
    data["image"] = data.get("profile_image") or data.get("image") or ""
    return data


def _user_image_column(users: Table) -> str | None:
    if "profile_image" in users.c:
        return "profile_image"
    if "image" in users.c:
        return "image"
    return None


def _utc_isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Any:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue")
    user_id = _token_subject(credentials.credentials)
    row = db.execute(select(tables["users"]).where(tables["users"].c.id == user_id)).first()
    if row is None or ("is_active" in tables["users"].c and not row._mapping.get("is_active", True)):
        raise HTTPException(status_code=401, detail="Account is unavailable")
    return row


def _scope_workspace(request: Request, db: Session) -> uuid.UUID | None:
    path_params = request.path_params
    if path_params.get("workspace_id"):
        try:
            return uuid.UUID(path_params["workspace_id"])
        except ValueError:
            raise HTTPException(status_code=404, detail="Workspace not found")
    if path_params.get("project_id"):
        try:
            project_id = uuid.UUID(path_params["project_id"])
        except ValueError:
            return None
        result = db.execute(select(tables["projects"].c.workspace_id).where(tables["projects"].c.id == project_id)).first()
        return result[0] if result else None
    if path_params.get("task_id"):
        try:
            task_id = uuid.UUID(path_params["task_id"])
        except ValueError:
            return None
        result = db.execute(
            select(tables["projects"].c.workspace_id)
            .join(tables["tasks"], tables["tasks"].c.project_id == tables["projects"].c.id)
            .where(tables["tasks"].c.id == task_id)
        ).first()
        return result[0] if result else None
    if request.url.path.endswith("/my/tasks"):
        return None
    return None


def authorize_request(
    request: Request,
    user: Any = Depends(current_user),
    db: Session = Depends(get_db),
) -> Any:
    """Apply membership and admin/member rules to all data CRUD routes."""
    user_id = user._mapping["id"]
    path = request.url.path
    if path.endswith("/workspaces") and request.method == "POST":
        return user
    if path.endswith("/workspaces") and request.method == "GET":
        return user
    if path.endswith("/users"):
        return user
    if path.endswith("/my/tasks"):
        return user
    if path.endswith("/migrate-local"):
        raise HTTPException(status_code=403, detail="Local migration is disabled after account authentication is enabled")
    workspace_id = _scope_workspace(request, db)
    if workspace_id is None:
        raise HTTPException(status_code=404, detail="Workspace resource not found")
    workspace = db.execute(select(tables["workspaces"]).where(tables["workspaces"].c.id == workspace_id)).first()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    member = db.execute(select(tables["workspace_members"]).where(and_(
        tables["workspace_members"].c.workspace_id == workspace_id,
        tables["workspace_members"].c.user_id == user_id,
    ))).first()
    if member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")
    role = str(member._mapping.get("role", "MEMBER")).upper().replace("ORG:", "")
    is_admin = role == "ADMIN" or workspace._mapping["owner_id"] == user_id
    method = request.method.upper()
    if method in {"GET", "HEAD", "OPTIONS"}:
        return user
    if path.endswith("/sync"):
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only workspace admins can synchronize workspace settings and membership")
    elif "/members" in path or path.endswith("/workspaces/" + str(workspace_id)):
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only workspace admins can manage workspace and project members")
    elif "/projects" in path and method != "GET":
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only workspace admins can create or delete projects")
    elif "/tasks" in path:
        if "/comments" in path:
            if method == "DELETE" and not is_admin:
                comment_id = uuid.UUID(request.path_params["comment_id"])
                comment = db.execute(select(tables["task_comments"]).where(tables["task_comments"].c.id == comment_id)).first()
                if comment is None or comment._mapping.get("user_id") != user_id:
                    raise HTTPException(status_code=403, detail="Members can delete only their own comments")
        else:
            if method == "POST" and not is_admin:
                raise HTTPException(status_code=403, detail="Only workspace admins can create tasks")
            if method == "DELETE" and not is_admin:
                raise HTTPException(status_code=403, detail="Only workspace admins can delete tasks")
            if method == "PUT" and not is_admin:
                task_id = uuid.UUID(request.path_params["task_id"])
                task = db.execute(select(tables["tasks"]).where(tables["tasks"].c.id == task_id)).first()
                if task is None or task._mapping.get("assignee_id") != user_id:
                    raise HTTPException(status_code=403, detail="Members can update only tasks assigned to them")
    return user


@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    email = str(payload.get("email") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    password = str(payload.get("password") or "")
    if not email or "@" not in email or not name or len(password) < 10:
        raise HTTPException(status_code=422, detail="Name, valid email, and a password of at least 10 characters are required")
    users = tables["users"]
    existing = db.execute(select(users).where(users.c.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in or accept a workspace invitation")
    user_id = uuid.uuid4()
    values = {"id": user_id, "name": name, "email": email, "password_hash": _password_hash(password), "is_active": True}
    image_column = _user_image_column(users)
    if image_column:
        values[image_column] = ""
    db.execute(insert(users).values(**values))
    db.commit()
    user = db.execute(select(users).where(users.c.id == user_id)).first()
    return {"accessToken": _token_for(user_id), "tokenType": "bearer", "user": _public_user(user)}


@auth_router.post("/login")
def login(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    user = db.execute(select(tables["users"]).where(tables["users"].c.email == email)).first()
    if not user or not _password_matches(password, str(user._mapping.get("password_hash") or "")):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"accessToken": _token_for(user._mapping["id"]), "tokenType": "bearer", "user": _public_user(user)}


@auth_router.get("/me")
def get_me(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    user_id = user._mapping["id"]
    memberships = db.execute(select(tables["workspace_members"].c.workspace_id, tables["workspace_members"].c.role).where(tables["workspace_members"].c.user_id == user_id)).all()
    data = _public_user(user)
    data["workspaces"] = [{"id": str(row.workspace_id), "role": row.role} for row in memberships]
    return data


@auth_router.put("/profile")
def update_profile(payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    users = tables["users"]
    user_id = user._mapping["id"]
    name = str(payload.get("name") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    profile_image = payload.get("profileImage", user._mapping.get("profile_image") or user._mapping.get("image") or "")
    if not name or len(name) > 100:
        raise HTTPException(status_code=422, detail="Name must contain 1 to 100 characters")
    if not email or len(email) > 255 or "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if profile_image is None:
        profile_image = ""
    if not isinstance(profile_image, str) or len(profile_image) > 2_000_000:
        raise HTTPException(status_code=422, detail="Profile image is too large")
    if profile_image and not profile_image.lower().startswith(("https://", "http://", "data:image/", "/")):
        raise HTTPException(status_code=422, detail="Profile image must be an image URL or data image")

    old_email = str(user._mapping["email"]).strip().lower()
    if email != old_email:
        current_password = str(payload.get("currentPassword") or "")
        if not _password_matches(current_password, str(user._mapping.get("password_hash") or "")):
            raise HTTPException(status_code=401, detail="Enter your current password to change your email")
        duplicate = db.execute(select(users.c.id).where(func.lower(users.c.email) == email, users.c.id != user_id)).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

    values = {"name": name, "email": email}
    image_column = _user_image_column(users)
    if image_column:
        values[image_column] = profile_image
    if "updated_at" in users.c:
        values["updated_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    db.execute(update(users).where(users.c.id == user_id).values(**values))
    db.commit()
    updated_user = db.execute(select(users).where(users.c.id == user_id)).first()
    return _public_user(updated_user)


@auth_router.post("/change-password")
def change_password(payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    current_password = str(payload.get("currentPassword") or "")
    new_password = str(payload.get("newPassword") or "")
    if not _password_matches(current_password, str(user._mapping.get("password_hash") or "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(new_password) < 10:
        raise HTTPException(status_code=422, detail="New password must be at least 10 characters")
    if hmac.compare_digest(current_password, new_password):
        raise HTTPException(status_code=422, detail="Choose a password different from your current password")
    users = tables["users"]
    values: dict[str, Any] = {"password_hash": _password_hash(new_password)}
    if "updated_at" in users.c:
        values["updated_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    db.execute(update(users).where(users.c.id == user._mapping["id"]).values(**values))
    db.commit()
    return {"status": "ok", "message": "Password updated successfully"}


def _create_notification(db: Session, user_id: Any, title: str, message: str) -> None:
    if not user_id or "notifications" not in tables:
        return
    db.execute(insert(tables["notifications"]).values(
        id=uuid.uuid4(), user_id=user_id, title=title, message=message, is_read=False,
    ))


@auth_router.get("/notifications")
def list_notifications(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    notification_table = tables["notifications"]
    rows = db.execute(
        select(notification_table)
        .where(notification_table.c.user_id == user._mapping["id"])
        .order_by(notification_table.c.created_at.desc())
        .limit(50)
    ).all()
    return [{
        "id": str(row._mapping["id"]),
        "title": row._mapping.get("title") or "Notification",
        "message": row._mapping.get("message") or "",
        "isRead": bool(row._mapping.get("is_read")),
        "createdAt": _utc_isoformat(row._mapping.get("created_at")),
    } for row in rows]


@auth_router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        parsed_id = uuid.UUID(notification_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Notification not found") from exc
    result = db.execute(update(tables["notifications"]).where(
        tables["notifications"].c.id == parsed_id,
        tables["notifications"].c.user_id == user._mapping["id"],
    ).values(is_read=True))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(status_code=404, detail="Notification not found")
    db.commit()
    return {"status": "ok"}


@auth_router.post("/notifications/read-all")
def mark_all_notifications_read(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(update(tables["notifications"]).where(
        tables["notifications"].c.user_id == user._mapping["id"],
        tables["notifications"].c.is_read.is_(False),
    ).values(is_read=True))
    db.commit()
    return {"status": "ok"}


@auth_router.post("/workspaces/{workspace_id}/invitations", status_code=status.HTTP_201_CREATED)
def create_invitation(workspace_id: str, payload: dict[str, Any], request: Request, user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    workspace_id_parsed = uuid.UUID(workspace_id)
    role = str(payload.get("role") or "MEMBER").upper()
    if role not in {"ADMIN", "MEMBER"}:
        raise HTTPException(status_code=422, detail="Role must be ADMIN or MEMBER")
    email = str(payload.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")
    member = db.execute(select(tables["workspace_members"]).where(and_(tables["workspace_members"].c.workspace_id == workspace_id_parsed, tables["workspace_members"].c.user_id == user._mapping["id"]))).first()
    if not member or str(member._mapping.get("role", "")).upper() != "ADMIN":
        raise HTTPException(status_code=403, detail="Only workspace admins can invite members")
    workspace_name = db.execute(select(tables["workspaces"].c.name).where(tables["workspaces"].c.id == workspace_id_parsed)).scalar_one_or_none()
    if workspace_name is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    token = secrets.token_urlsafe(32)
    db.execute(insert(invitations).values(
        id=uuid.uuid4(), workspace_id=workspace_id_parsed, email=email, role=role,
        token_hash=hashlib.sha256(token.encode()).hexdigest(), invited_by=user._mapping["id"],
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    ))
    invited_account = db.execute(select(tables["users"]).where(func.lower(tables["users"].c.email) == email)).first()
    if invited_account and invited_account._mapping["id"] != user._mapping["id"]:
        _create_notification(db, invited_account._mapping["id"], "Workspace invitation", f"You were invited to join {workspace_name} as a {role.lower()}.")
    db.commit()
    settings = get_settings()
    frontend_base_url = settings.frontend_base_url
    request_origin = request.headers.get("origin", "").rstrip("/")
    if frontend_base_url.rstrip("/") in {"http://localhost:5173", "http://127.0.0.1:5173"} and request_origin in settings.allowed_origins:
        frontend_base_url = request_origin
    url = invitation_url(settings, token, frontend_base_url)
    delivery = "copy_link"
    delivery_error = None
    delivery_hint = None
    if settings.render and not settings.email_configured:
        delivery_hint = "Configure Gmail API OAuth credentials, Resend, or Gmail SMTP on a paid Render service to send invitations by email."
    if settings.email_configured:
        try:
            send_invitation_email(settings, email, str(workspace_name), role, url)
            delivery = "email"
        except Exception as exc:
            logger.exception("Could not deliver workspace invitation email")
            delivery = "email_failed"
            delivery_error = str(exc)[:300]
    return {
        "email": email,
        "role": role,
        "inviteToken": token,
        "inviteUrl": url,
        "expiresInDays": 7,
        "delivery": delivery,
        "deliveryError": delivery_error,
        "deliveryHint": delivery_hint,
    }


@auth_router.post("/invitations/accept")
def accept_invitation(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    token = str(payload.get("token") or "")
    email = str(payload.get("email") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    password = str(payload.get("password") or "")
    invite = db.execute(select(invitations).where(invitations.c.token_hash == hashlib.sha256(token.encode()).hexdigest())).first()
    now = datetime.now(timezone.utc)
    if not invite or invite._mapping["accepted_at"] or invite._mapping["expires_at"] <= now:
        raise HTTPException(status_code=400, detail="Invitation is invalid or expired")
    if email != invite._mapping["email"] or not name or len(password) < 10:
        raise HTTPException(status_code=422, detail="Use the invited email, provide your name, and choose a password of at least 10 characters")
    users = tables["users"]
    account = db.execute(select(users).where(users.c.email == email)).first()
    if account and str(account._mapping.get("password_hash") or "").startswith("scrypt$"):
        if not _password_matches(password, str(account._mapping["password_hash"])):
            raise HTTPException(status_code=401, detail="This email already has an account. Sign in with its existing password before accepting the invitation")
        user_id = account._mapping["id"]
    elif account:
        user_id = account._mapping["id"]
        db.execute(update(users).where(users.c.id == user_id).values(name=name, password_hash=_password_hash(password), is_active=True))
    else:
        user_id = uuid.uuid4()
        values = {"id": user_id, "name": name, "email": email, "password_hash": _password_hash(password), "is_active": True}
        image_column = _user_image_column(users)
        if image_column:
            values[image_column] = ""
        db.execute(insert(users).values(**values))
    membership = db.execute(select(tables["workspace_members"]).where(and_(
        tables["workspace_members"].c.workspace_id == invite._mapping["workspace_id"],
        tables["workspace_members"].c.user_id == user_id,
    ))).first()
    if not membership:
        db.execute(insert(tables["workspace_members"]).values(
            id=uuid.uuid4(), workspace_id=invite._mapping["workspace_id"], user_id=user_id,
            role=invite._mapping["role"], message="",
        ))
    db.execute(update(invitations).where(invitations.c.id == invite._mapping["id"]).values(accepted_at=now))
    workspace_name = db.execute(select(tables["workspaces"].c.name).where(tables["workspaces"].c.id == invite._mapping["workspace_id"])).scalar_one_or_none() or "the workspace"
    _create_notification(
        db,
        invite._mapping["invited_by"],
        "Invitation accepted",
        f"{name} accepted your invitation to join {workspace_name}.",
    )
    db.commit()
    account = db.execute(select(users).where(users.c.id == user_id)).first()
    return {"accessToken": _token_for(user_id), "tokenType": "bearer", "user": _public_user(account)}
