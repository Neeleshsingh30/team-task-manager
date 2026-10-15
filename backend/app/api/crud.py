"""CRUD endpoints backed by the existing PostgreSQL tables."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import MetaData, Table, Uuid, delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.api.auth import _create_notification, current_user
from app.db.session import engine, get_db


router = APIRouter()
metadata = MetaData()
metadata.reflect(bind=engine, only=[
    "users", "workspaces", "workspace_members", "projects", "project_members",
    "tasks", "task_comments", "activity_logs", "notifications",
])
tables: dict[str, Table] = metadata.tables
UUID_NAMESPACE = uuid.UUID("b18275a2-8cde-4a6b-986c-2e16cf52b74e")

ALIASES = {
    "ownerId": "owner_id", "workspaceId": "workspace_id", "projectId": "project_id",
    "userId": "user_id", "assigneeId": "assignee_id", "due_date": "due_date",
    "team_lead": "team_lead", "image_url": "image_url", "profile_image": "profile_image",
    "createdAt": "created_at", "updatedAt": "updated_at", "start_date": "start_date",
    "end_date": "end_date", "isRead": "is_read", "entityType": "entity_type",
    "entityId": "entity_id",
}


def _table(name: str) -> Table:
    return tables[name]


def _values(table_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    table = _table(table_name)
    allowed = set(table.c.keys()) - {"id", "password_hash", "created_at", "updated_at", "joined_at"}
    result: dict[str, Any] = {}
    for key, value in payload.items():
        column = ALIASES.get(key, key)
        if column in allowed:
            result[column] = None if value == "" and isinstance(table.c[column].type, Uuid) else value
    return result


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        # Database timestamps written by this app are UTC, but legacy columns
        # may return naive values. Mark them as UTC so browsers convert them
        # to the viewer's local timezone instead of treating them as local.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _stable_id(kind: str, value: Any, id_map: dict[tuple[str, str], uuid.UUID]) -> uuid.UUID:
    key = (kind, str(value))
    if key in id_map:
        return id_map[key]
    try:
        parsed = uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        parsed = uuid.uuid5(UUID_NAMESPACE, f"{kind}:{value}")
    id_map[key] = parsed
    return parsed


def _date_value(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _upsert(db: Session, table_name: str, values: dict[str, Any]) -> None:
    table = _table(table_name)
    statement = pg_insert(table).values(**values)
    updates = {key: getattr(statement.excluded, key) for key in values if key not in {"id", "password_hash"}}
    if "updated_at" in table.c and "updated_at" not in values:
        updates["updated_at"] = datetime.utcnow()
    if updates:
        statement = statement.on_conflict_do_update(index_elements=[table.c.id], set_=updates)
    else:
        statement = statement.on_conflict_do_nothing(index_elements=[table.c.id])
    db.execute(statement)


def _user_sources(workspace: dict[str, Any]):
    if isinstance(workspace.get("owner"), dict):
        yield workspace["owner"]
    for member in workspace.get("members") or []:
        if isinstance(member.get("user"), dict):
            yield member["user"]
    for project in workspace.get("projects") or []:
        for member in project.get("members") or []:
            if isinstance(member.get("user"), dict):
                yield member["user"]
        for task in project.get("tasks") or []:
            if isinstance(task.get("assignee"), dict):
                yield task["assignee"]
            for actor_key in ("createdBy", "updatedBy", "assignedBy"):
                if isinstance(task.get(actor_key), dict):
                    yield task[actor_key]
            for comment in task.get("comments") or []:
                if isinstance(comment.get("user"), dict):
                    yield comment["user"]


def _save_user(db: Session, user: dict[str, Any], id_map: dict[tuple[str, str], uuid.UUID]) -> uuid.UUID:
    email = str(user.get("email") or "").strip().lower()
    source_id = user.get("id") or email or uuid.uuid4()
    user_id = _stable_id("user", source_id, id_map)
    if email:
        existing = db.execute(select(_table("users").c.id).where(_table("users").c.email == email)).first()
        if existing:
            user_id = existing._mapping["id"]
            id_map[("user", str(source_id))] = user_id
    else:
        email = f"{user_id}@local.invalid"
    user_values = {
        "id": user_id,
        "name": str(user.get("name") or email.split("@", 1)[0])[:100],
        "email": email,
        "password_hash": "!pending-invitation-no-auth-configured!",
        "is_active": True,
    }
    users = _table("users")
    image_column = "profile_image" if "profile_image" in users.c else "image" if "image" in users.c else None
    if image_column:
        user_values[image_column] = user.get("image") or user.get("profile_image") or ""
    _upsert(db, "users", user_values)
    return user_id


def _persist_workspace_graph(db: Session, workspace: dict[str, Any], id_map: dict[tuple[str, str], uuid.UUID]) -> uuid.UUID:
    for user in _user_sources(workspace):
        _save_user(db, user, id_map)

    owner_source = workspace.get("owner") if isinstance(workspace.get("owner"), dict) else {}
    owner_source_id = workspace.get("ownerId") or workspace.get("owner_id") or owner_source.get("id")
    if owner_source_id and ("user", str(owner_source_id)) not in id_map:
        _save_user(db, {
            **owner_source,
            "id": owner_source_id,
            "name": owner_source.get("name") or "Workspace owner",
            "email": owner_source.get("email") or f"owner-{owner_source_id}@local.invalid",
        }, id_map)
    owner_id = _stable_id("user", owner_source_id, id_map) if owner_source_id else None
    if owner_id is None:
        raise HTTPException(status_code=422, detail="Workspace owner is required")

    workspace_id = _stable_id("workspace", workspace.get("id") or uuid.uuid4(), id_map)
    name = str(workspace.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Workspace name is required")
    slug = str(workspace.get("slug") or "-".join(name.lower().split()) + "-" + workspace_id.hex[:6])[:150]
    _upsert(db, "workspaces", {
        "id": workspace_id,
        "name": name[:150],
        "slug": slug,
        "description": workspace.get("description"),
        "image_url": workspace.get("image_url") or "",
        "owner_id": owner_id,
    })

    workspace_members = _table("workspace_members")
    seen_member_users: set[uuid.UUID] = set()
    workspace_member_ids: set[uuid.UUID] = set()
    for member in workspace.get("members") or []:
        member_user_source = member.get("user") if isinstance(member.get("user"), dict) else {}
        raw_user_id = member.get("userId") or member.get("user_id") or member_user_source.get("id")
        if not raw_user_id:
            continue
        user_id = _stable_id("user", raw_user_id, id_map)
        if user_id in seen_member_users:
            continue
        seen_member_users.add(user_id)
        member_id = _stable_id("workspace_member", member.get("id") or f"{workspace_id}:{user_id}", id_map)
        workspace_member_ids.add(member_id)
        _upsert(db, "workspace_members", {
            "id": member_id,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "role": "ADMIN" if user_id == owner_id else str(member.get("role") or "MEMBER").upper().replace("ORG:", ""),
            "message": member.get("message") or "",
        })
    if owner_id not in seen_member_users:
        owner_member_id = uuid.uuid5(UUID_NAMESPACE, f"workspace_member:{workspace_id}:{owner_id}")
        workspace_member_ids.add(owner_member_id)
        _upsert(db, "workspace_members", {
            "id": owner_member_id,
            "workspace_id": workspace_id, "user_id": owner_id, "role": "ADMIN", "message": "",
        })
    existing_workspace_members = db.execute(select(workspace_members.c.id).where(workspace_members.c.workspace_id == workspace_id)).scalars().all()
    removed_workspace_members = set(existing_workspace_members) - workspace_member_ids
    if removed_workspace_members:
        db.execute(delete(workspace_members).where(workspace_members.c.id.in_(removed_workspace_members)))

    project_table = _table("projects")
    project_member_table = _table("project_members")
    task_table = _table("tasks")
    comment_table = _table("task_comments")
    incoming_projects: set[uuid.UUID] = set()
    for project in workspace.get("projects") or []:
        project_id = _stable_id("project", project.get("id") or uuid.uuid4(), id_map)
        incoming_projects.add(project_id)
        lead = project.get("team_lead") or project.get("teamLead")
        lead_id = _stable_id("user", lead, id_map) if lead else owner_id
        _upsert(db, "projects", {
            "id": project_id,
            "workspace_id": workspace_id,
            "name": str(project.get("name") or "Untitled project")[:255],
            "description": project.get("description"),
            "status": str(project.get("status") or "PLANNING").upper(),
            "priority": str(project.get("priority") or "MEDIUM").upper(),
            "team_lead": lead_id,
            "progress": max(0, min(100, int(project.get("progress") or 0))),
            "start_date": _date_value(project.get("start_date")),
            "end_date": _date_value(project.get("end_date")),
        })

        seen_project_users: set[uuid.UUID] = set()
        project_member_ids: set[uuid.UUID] = set()
        for member in project.get("members") or []:
            member_user = member.get("user") if isinstance(member.get("user"), dict) else {}
            raw_user_id = member.get("userId") or member.get("user_id") or member_user.get("id")
            if not raw_user_id:
                continue
            user_id = _stable_id("user", raw_user_id, id_map)
            if user_id in seen_project_users:
                continue
            seen_project_users.add(user_id)
            project_member_id = _stable_id("project_member", member.get("id") or f"{project_id}:{user_id}", id_map)
            project_member_ids.add(project_member_id)
            _upsert(db, "project_members", {
                "id": project_member_id,
                "project_id": project_id, "user_id": user_id,
            })
        existing_project_members = db.execute(select(project_member_table.c.id).where(project_member_table.c.project_id == project_id)).scalars().all()
        removed_project_members = set(existing_project_members) - project_member_ids
        if removed_project_members:
            db.execute(delete(project_member_table).where(project_member_table.c.id.in_(removed_project_members)))

        incoming_tasks: set[uuid.UUID] = set()
        for task in project.get("tasks") or []:
            task_id = _stable_id("task", task.get("id") or uuid.uuid4(), id_map)
            incoming_tasks.add(task_id)
            assignee_source = task.get("assignee") if isinstance(task.get("assignee"), dict) else {}
            raw_assignee_id = task.get("assigneeId") or task.get("assignee_id") or assignee_source.get("id")
            assignee_id = _stable_id("user", raw_assignee_id, id_map) if raw_assignee_id else None
            existing_task = db.execute(select(task_table).where(task_table.c.id == task_id)).first()
            previous_values = existing_task._mapping if existing_task else None
            changed_fields = []
            if previous_values:
                comparisons = {
                    "title": str(task.get("title") or "Untitled task")[:255],
                    "description": task.get("description"),
                    "status": str(task.get("status") or "TODO").upper(),
                    "priority": str(task.get("priority") or "MEDIUM").upper(),
                    "type": str(task.get("type") or "TASK").upper(),
                    "assignee_id": assignee_id,
                    "due_date": _date_value(task.get("due_date")),
                }
                changed_fields = [key for key, value in comparisons.items() if previous_values[key] != value]
            _upsert(db, "tasks", {
                "id": task_id,
                "project_id": project_id,
                "title": str(task.get("title") or "Untitled task")[:255],
                "description": task.get("description"),
                "status": str(task.get("status") or "TODO").upper(),
                "priority": str(task.get("priority") or "MEDIUM").upper(),
                "type": str(task.get("type") or "TASK").upper(),
                "assignee_id": assignee_id,
                "due_date": _date_value(task.get("due_date")),
            })
            if not previous_values or changed_fields:
                actor = task.get("createdBy") if not previous_values else None
                if "assignee_id" in changed_fields:
                    actor = task.get("assignedBy") or task.get("updatedBy")
                actor = actor or task.get("updatedBy") or task.get("assignedBy")
                actor_id = None
                if isinstance(actor, dict) and actor.get("id"):
                    actor_id = _stable_id("user", actor["id"], id_map)
                if actor_id and _get(db, "users", str(actor_id)):
                    action = "task.created" if not previous_values else (
                        "task.assigned" if "assignee_id" in changed_fields else "task.updated"
                    )
                    actor_name = actor.get("name") or actor.get("email") or "A team member"
                    description = f"{actor_name} {action.removeprefix('task.')} task: {task.get('title') or 'Untitled task'}"
                    db.execute(insert(_table("activity_logs")).values(
                        id=uuid.uuid4(), workspace_id=workspace_id, user_id=actor_id,
                        action=action, entity_type="task", entity_id=task_id, description=description,
                    ))
            db.execute(delete(comment_table).where(comment_table.c.task_id == task_id))
            for comment in task.get("comments") or []:
                comment_user = comment.get("user") if isinstance(comment.get("user"), dict) else {}
                raw_comment_user = comment.get("userId") or comment.get("user_id") or comment_user.get("id")
                if not raw_comment_user:
                    continue
                _upsert(db, "task_comments", {
                    "id": _stable_id("comment", comment.get("id") or uuid.uuid4(), id_map),
                    "task_id": task_id,
                    "user_id": _stable_id("user", raw_comment_user, id_map),
                    "content": str(comment.get("content") or ""),
                })
        existing_tasks = db.execute(select(task_table.c.id).where(task_table.c.project_id == project_id)).scalars().all()
        removed_tasks = set(existing_tasks) - incoming_tasks
        if removed_tasks:
            db.execute(delete(comment_table).where(comment_table.c.task_id.in_(removed_tasks)))
            db.execute(delete(task_table).where(task_table.c.id.in_(removed_tasks)))

    existing_projects = db.execute(select(project_table.c.id).where(project_table.c.workspace_id == workspace_id)).scalars().all()
    removed_projects = set(existing_projects) - incoming_projects
    if removed_projects:
        removed_tasks = db.execute(select(task_table.c.id).where(task_table.c.project_id.in_(removed_projects))).scalars().all()
        if removed_tasks:
            db.execute(delete(comment_table).where(comment_table.c.task_id.in_(removed_tasks)))
            db.execute(delete(task_table).where(task_table.c.id.in_(removed_tasks)))
        db.execute(delete(project_member_table).where(project_member_table.c.project_id.in_(removed_projects)))
        db.execute(delete(project_table).where(project_table.c.id.in_(removed_projects)))
    return workspace_id


@router.put("/workspaces/{workspace_id}/sync")
def sync_workspace(workspace_id: str, payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    id_map: dict[tuple[str, str], uuid.UUID] = {}
    try:
        target_id = uuid.UUID(workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="workspaceId must be a UUID") from exc
    if payload.get("id") and str(payload["id"]) != workspace_id:
        raise HTTPException(status_code=422, detail="Workspace ID does not match the URL")
    actor = {"id": str(user._mapping["id"]), "name": user._mapping["name"], "email": user._mapping["email"]}
    for project in payload.get("projects") or []:
        for task in project.get("tasks") or []:
            task["updatedBy"] = actor
            task.setdefault("createdBy", actor)
            if task.get("assigneeId") or task.get("assignee_id"):
                task["assignedBy"] = actor
    try:
        persisted_id = _persist_workspace_graph(db, payload, id_map)
        if persisted_id != target_id:
            raise HTTPException(status_code=422, detail="Workspace ID did not match the URL")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not save workspace changes") from exc
    return _workspace(db, _get_or_404(db, "workspaces", workspace_id))


@router.post("/migrate-local", status_code=status.HTTP_201_CREATED)
def migrate_local_data(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    workspaces = payload.get("workspaces")
    if not isinstance(workspaces, list):
        raise HTTPException(status_code=422, detail="workspaces must be an array")
    if db.execute(select(_table("workspaces").c.id).limit(1)).first():
        raise HTTPException(status_code=409, detail="Database already has workspaces; migration was not run")
    id_map: dict[tuple[str, str], uuid.UUID] = {}
    try:
        for workspace in workspaces:
            if isinstance(workspace, dict):
                _persist_workspace_graph(db, workspace, id_map)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not migrate the saved browser data") from exc
    old_current_user = payload.get("currentUserId") or payload.get("current_user_id")
    current_user_id = id_map.get(("user", str(old_current_user))) if old_current_user else None
    rows = db.execute(select(_table("workspaces")).order_by(_table("workspaces").c.created_at)).all()
    return {"workspaces": [_workspace(db, row) for row in rows], "currentUserId": str(current_user_id) if current_user_id else None}


def _row(row: Any, table_name: str | None = None) -> dict[str, Any]:
    item = {key: _json_value(value) for key, value in row._mapping.items()}
    item.pop("password_hash", None)
    if "created_at" in item:
        item["createdAt"] = item["created_at"]
    if "updated_at" in item:
        item["updatedAt"] = item["updated_at"]
    if table_name == "users":
        item["image"] = item.get("profile_image") or item.get("image") or ""
    if table_name == "workspaces":
        item["ownerId"] = item.get("owner_id")
        item["image_url"] = item.get("image_url") or ""
    if table_name == "workspace_members":
        item["workspaceId"] = item.get("workspace_id")
        item["userId"] = item.get("user_id")
    if table_name == "projects":
        item["workspaceId"] = item.get("workspace_id")
        item["team_lead"] = item.get("team_lead")
    if table_name == "project_members":
        item["projectId"] = item.get("project_id")
        item["userId"] = item.get("user_id")
    if table_name == "tasks":
        item["projectId"] = item.get("project_id")
        item["assigneeId"] = item.get("assignee_id")
    if table_name == "task_comments":
        item["taskId"] = item.get("task_id")
        item["userId"] = item.get("user_id")
    return item


def _get(db: Session, table_name: str, record_id: str) -> Any | None:
    table = _table(table_name)
    try:
        parsed_id = uuid.UUID(str(record_id))
    except (ValueError, TypeError):
        return None
    return db.execute(select(table).where(table.c.id == parsed_id)).first()


def _get_or_404(db: Session, table_name: str, record_id: str) -> Any:
    row = _get(db, table_name, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{table_name[:-1].capitalize()} not found")
    return row


def _insert(db: Session, table_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    values = _values(table_name, payload)
    values["id"] = uuid.uuid4()
    try:
        db.execute(insert(_table(table_name)).values(**values))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create record; check required fields and duplicates") from exc
    return _row(_get_or_404(db, table_name, str(values["id"])), table_name)


def _update(db: Session, table_name: str, record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    record = _get_or_404(db, table_name, record_id)
    values = _values(table_name, payload)
    if "updated_at" in _table(table_name).c:
        values["updated_at"] = datetime.utcnow()
    if values:
        try:
            db.execute(update(_table(table_name)).where(_table(table_name).c.id == record._mapping["id"]).values(**values))
            db.commit()
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="Could not update record; check fields and relationships") from exc
    return _row(_get_or_404(db, table_name, record_id), table_name)


def _delete(db: Session, table_name: str, record_id: str) -> None:
    record = _get_or_404(db, table_name, record_id)
    record_uuid = record._mapping["id"]
    if table_name == "workspaces":
        project_ids = db.execute(select(_table("projects").c.id).where(_table("projects").c.workspace_id == record_uuid)).scalars().all()
        if project_ids:
            task_ids = db.execute(select(_table("tasks").c.id).where(_table("tasks").c.project_id.in_(project_ids))).scalars().all()
            if task_ids:
                db.execute(delete(_table("task_comments")).where(_table("task_comments").c.task_id.in_(task_ids)))
                db.execute(delete(_table("tasks")).where(_table("tasks").c.id.in_(task_ids)))
            db.execute(delete(_table("project_members")).where(_table("project_members").c.project_id.in_(project_ids)))
            db.execute(delete(_table("projects")).where(_table("projects").c.id.in_(project_ids)))
        db.execute(delete(_table("workspace_members")).where(_table("workspace_members").c.workspace_id == record_uuid))
        db.execute(delete(_table("activity_logs")).where(_table("activity_logs").c.workspace_id == record_uuid))
    elif table_name == "projects":
        task_ids = db.execute(select(_table("tasks").c.id).where(_table("tasks").c.project_id == record_uuid)).scalars().all()
        if task_ids:
            db.execute(delete(_table("task_comments")).where(_table("task_comments").c.task_id.in_(task_ids)))
            db.execute(delete(_table("tasks")).where(_table("tasks").c.id.in_(task_ids)))
        db.execute(delete(_table("project_members")).where(_table("project_members").c.project_id == record_uuid))
    elif table_name == "tasks":
        db.execute(delete(_table("task_comments")).where(_table("task_comments").c.task_id == record_uuid))
    db.execute(delete(_table(table_name)).where(_table(table_name).c.id == record_uuid))
    db.commit()


def _user(db: Session, user_id: Any) -> dict[str, Any] | None:
    if not user_id:
        return None
    row = _get(db, "users", str(user_id))
    return _row(row, "users") if row else None


def _project(db: Session, row: Any) -> dict[str, Any]:
    project = _row(row, "projects")
    project_id = uuid.UUID(project["id"])
    members = db.execute(select(_table("project_members")).where(_table("project_members").c.project_id == project_id)).all()
    project["members"] = []
    for member_row in members:
        member = _row(member_row, "project_members")
        member["user"] = _user(db, member["user_id"])
        project["members"].append(member)
    task_rows = db.execute(select(_table("tasks")).where(_table("tasks").c.project_id == project_id).order_by(_table("tasks").c.created_at)).all()
    project["tasks"] = []
    for task_row in task_rows:
        task = _row(task_row, "tasks")
        task["assignee"] = _user(db, task["assignee_id"])
        activity = db.execute(
            select(_table("activity_logs"))
            .where(
                _table("activity_logs").c.entity_type == "task",
                _table("activity_logs").c.entity_id == uuid.UUID(task["id"]),
            )
            .order_by(_table("activity_logs").c.created_at.desc())
            .limit(1)
        ).first()
        task["updatedBy"] = _user(db, activity._mapping["user_id"]) if activity else None
        if activity:
            task["lastActivity"] = _row(activity, "activity_logs")
        comment_rows = db.execute(select(_table("task_comments")).where(_table("task_comments").c.task_id == uuid.UUID(task["id"]))).all()
        task["comments"] = []
        for comment_row in comment_rows:
            comment = _row(comment_row, "task_comments")
            comment["user"] = _user(db, comment["user_id"])
            task["comments"].append(comment)
        project["tasks"].append(task)
    return project


def _workspace(db: Session, row: Any) -> dict[str, Any]:
    workspace = _row(row, "workspaces")
    workspace_id = uuid.UUID(workspace["id"])
    workspace["owner"] = _user(db, workspace["owner_id"])
    member_rows = db.execute(select(_table("workspace_members")).where(_table("workspace_members").c.workspace_id == workspace_id)).all()
    workspace["members"] = []
    for member_row in member_rows:
        member = _row(member_row, "workspace_members")
        member["user"] = _user(db, member["user_id"])
        workspace["members"].append(member)
    project_rows = db.execute(select(_table("projects")).where(_table("projects").c.workspace_id == workspace_id).order_by(_table("projects").c.created_at)).all()
    workspace["projects"] = [_project(db, project_row) for project_row in project_rows]
    return workspace


@router.get("/users")
def list_users(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    member_table = _table("workspace_members")
    user_ids = db.execute(select(member_table.c.user_id).where(
        member_table.c.workspace_id.in_(select(member_table.c.workspace_id).where(member_table.c.user_id == user._mapping["id"]))
    )).scalars().all()
    if not user_ids:
        return [_row(user, "users")]
    return [_row(row, "users") for row in db.execute(
        select(_table("users")).where(_table("users").c.id.in_(set(user_ids))).order_by(_table("users").c.name)
    ).all()]


@router.get("/workspaces")
def list_workspaces(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    member_table = _table("workspace_members")
    workspace_ids = select(member_table.c.workspace_id).where(member_table.c.user_id == user._mapping["id"])
    rows = db.execute(select(_table("workspaces")).where(_table("workspaces").c.id.in_(workspace_ids)).order_by(_table("workspaces").c.created_at)).all()
    return [_workspace(db, row) for row in rows]


@router.get("/workspaces/{workspace_id}")
def get_workspace(workspace_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _workspace(db, _get_or_404(db, "workspaces", workspace_id))


@router.post("/workspaces", status_code=status.HTTP_201_CREATED)
def create_workspace(payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    owner_id = user._mapping["id"]
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="Workspace name is required")
    slug = payload.get("slug") or "-".join(name.lower().split()) + "-" + uuid.uuid4().hex[:6]
    try:
        workspace_id = uuid.UUID(str(payload.get("id"))) if payload.get("id") else uuid.uuid4()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Workspace ID must be a UUID") from exc
    values = _values("workspaces", payload)
    values.update(id=workspace_id, name=name, slug=slug, owner_id=owner_id)
    try:
        db.execute(insert(_table("workspaces")).values(**values))
        db.execute(insert(_table("workspace_members")).values(id=uuid.uuid4(), workspace_id=workspace_id, user_id=owner_id, role="ADMIN", message=""))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create workspace") from exc
    return _workspace(db, _get_or_404(db, "workspaces", str(workspace_id)))


@router.put("/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    workspace = _update(db, "workspaces", workspace_id, payload)
    return _workspace(db, _get_or_404(db, "workspaces", workspace["id"]))


@router.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: str, db: Session = Depends(get_db)) -> Response:
    _delete(db, "workspaces", workspace_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/members", status_code=status.HTTP_201_CREATED)
def add_workspace_member(workspace_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    workspace = _get_or_404(db, "workspaces", workspace_id)
    user_id = payload.get("userId") or payload.get("user_id")
    user = payload.get("user") or {}
    if user_id:
        user_row = _get(db, "users", str(user_id))
    else:
        user_row = None
    if user_row is None and user.get("email"):
        email = user["email"].strip().lower()
        user_row = db.execute(select(_table("users")).where(_table("users").c.email == email)).first()
        if user_row is None:
            user_id = uuid.uuid4()
            user_values = {
                "id": user_id,
                "name": user.get("name") or email.split("@")[0],
                "email": email,
                "password_hash": "!no-password-auth-configured!",
            }
            users = _table("users")
            image_column = "profile_image" if "profile_image" in users.c else "image" if "image" in users.c else None
            if image_column:
                user_values[image_column] = user.get("image") or ""
            db.execute(insert(users).values(**user_values))
        else:
            user_id = user_row._mapping["id"]
    elif user_row is not None:
        user_id = user_row._mapping["id"]
    if not user_id:
        raise HTTPException(status_code=422, detail="A valid user or user email is required")
    member_id = uuid.uuid4()
    try:
        db.execute(insert(_table("workspace_members")).values(
            id=member_id, workspace_id=workspace._mapping["id"], user_id=user_id,
            role=payload.get("role", "MEMBER"), message=payload.get("message", ""),
        ))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Member already exists or could not be added") from exc
    member = _row(_get_or_404(db, "workspace_members", str(member_id)), "workspace_members")
    member["user"] = _user(db, user_id)
    return member


@router.delete("/workspaces/{workspace_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_workspace_member(workspace_id: str, member_id: str, db: Session = Depends(get_db)) -> Response:
    table = _table("workspace_members")
    try:
        parsed_workspace_id, parsed_member_id = uuid.UUID(workspace_id), uuid.UUID(member_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Workspace member not found") from exc
    result = db.execute(delete(table).where(table.c.id == parsed_member_id, table.c.workspace_id == parsed_workspace_id))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(status_code=404, detail="Workspace member not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/projects", status_code=status.HTTP_201_CREATED)
def create_project(workspace_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    workspace = _get_or_404(db, "workspaces", workspace_id)
    values = _values("projects", payload)
    values["workspace_id"] = workspace._mapping["id"]
    values.setdefault("team_lead", workspace._mapping["owner_id"])
    project = _insert(db, "projects", values)
    project_id = uuid.UUID(project["id"])
    for member in payload.get("members", []):
        user_id = member.get("userId") or member.get("user_id")
        if user_id and _get(db, "users", str(user_id)):
            db.execute(insert(_table("project_members")).values(id=uuid.uuid4(), project_id=project_id, user_id=uuid.UUID(str(user_id))))
    db.commit()
    return _project(db, _get_or_404(db, "projects", project["id"]))


@router.put("/projects/{project_id}")
def update_project(project_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _update(db, "projects", project_id, payload)
    return _project(db, _get_or_404(db, "projects", project["id"]))


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _project(db, _get_or_404(db, "projects", project_id))


@router.post("/projects/{project_id}/members", status_code=status.HTTP_201_CREATED)
def add_project_member(project_id: str, payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _get_or_404(db, "projects", project_id)
    user_id = payload.get("userId") or payload.get("user_id")
    if not user_id or not _get(db, "users", str(user_id)):
        raise HTTPException(status_code=422, detail="A valid userId is required")
    member_id = uuid.uuid4()
    try:
        db.execute(insert(_table("project_members")).values(
            id=member_id, project_id=project._mapping["id"], user_id=uuid.UUID(str(user_id)),
        ))
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Project member already exists or could not be added") from exc
    member = _row(_get_or_404(db, "project_members", str(member_id)), "project_members")
    member["user"] = _user(db, user_id)
    return member


@router.delete("/projects/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(project_id: str, member_id: str, db: Session = Depends(get_db)) -> Response:
    try:
        parsed_project_id, parsed_member_id = uuid.UUID(project_id), uuid.UUID(member_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Project member not found") from exc
    result = db.execute(delete(_table("project_members")).where(
        _table("project_members").c.id == parsed_member_id,
        _table("project_members").c.project_id == parsed_project_id,
    ))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(status_code=404, detail="Project member not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Session = Depends(get_db)) -> Response:
    _delete(db, "projects", project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/projects/{project_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_task(project_id: str, payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    project = _get_or_404(db, "projects", project_id)
    values = _values("tasks", payload)
    values["project_id"] = project._mapping["id"]
    task = _insert(db, "tasks", values)
    assignee_id = task.get("assignee_id")
    if assignee_id and assignee_id != user._mapping["id"]:
        _create_notification(
            db,
            assignee_id,
            "Task assigned to you",
            f"{user._mapping['name']} assigned you \"{task.get('title') or 'a task'}\" in {project._mapping['name']}.",
        )
        db.commit()
    return next(item for item in _project(db, project)["tasks"] if item["id"] == task["id"])


@router.put("/tasks/{task_id}")
def update_task(task_id: str, payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    task_row = _get_or_404(db, "tasks", task_id)
    old_assignee_id = task_row._mapping.get("assignee_id")
    project_row = _get_or_404(db, "projects", str(task_row._mapping["project_id"]))
    membership = db.execute(select(_table("workspace_members")).where(
        _table("workspace_members").c.workspace_id == project_row._mapping["workspace_id"],
        _table("workspace_members").c.user_id == user._mapping["id"],
    )).first()
    workspace_row = _get_or_404(db, "workspaces", str(project_row._mapping["workspace_id"]))
    is_admin = bool(
        (membership and str(membership._mapping.get("role", "")).upper() == "ADMIN")
        or workspace_row._mapping["owner_id"] == user._mapping["id"]
    )
    if not is_admin and project_row._mapping["workspace_id"]:
        if "due_date" in payload and _date_value(payload.get("due_date")) != task_row._mapping.get("due_date"):
            raise HTTPException(status_code=403, detail="Only workspace admins can change task due dates")
        payload = {key: value for key, value in payload.items() if key not in {"assigneeId", "assignee_id", "assignee", "assignedBy", "createdBy", "updatedBy", "projectId", "project_id"}}
    task = _update(db, "tasks", task_id, payload)
    task_row = _get_or_404(db, "tasks", task["id"])
    project_row = _get_or_404(db, "projects", str(task_row._mapping["project_id"]))
    log_table = _table("activity_logs")
    db.execute(insert(log_table).values(
        id=uuid.uuid4(), workspace_id=project_row._mapping["workspace_id"], user_id=user._mapping["id"],
        action="task.updated", entity_type="task", entity_id=task_row._mapping["id"],
        description=f"Updated task: {task_row._mapping['title']}",
    ))
    new_assignee_id = task_row._mapping.get("assignee_id")
    if new_assignee_id and new_assignee_id != old_assignee_id and new_assignee_id != user._mapping["id"]:
        _create_notification(
            db,
            new_assignee_id,
            "Task assigned to you",
            f"{user._mapping['name']} assigned you \"{task_row._mapping['title']}\" in {project_row._mapping['name']}.",
        )
    db.commit()
    return next(item for item in _project(db, project_row)["tasks"] if item["id"] == task["id"])


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str, db: Session = Depends(get_db)) -> Response:
    _delete(db, "tasks", task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/tasks/{task_id}/comments", status_code=status.HTTP_201_CREATED)
def create_task_comment(task_id: str, payload: dict[str, Any], user: Any = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    task_row = _get_or_404(db, "tasks", task_id)
    project_row = _get_or_404(db, "projects", str(task_row._mapping["project_id"]))
    values = _values("task_comments", payload)
    values["task_id"] = uuid.UUID(task_id)
    values["user_id"] = user._mapping["id"]
    comment = _insert(db, "task_comments", values)
    comment["user"] = _user(db, comment.get("user_id"))
    recipient_ids = set(db.execute(select(_table("project_members").c.user_id).where(
        _table("project_members").c.project_id == project_row._mapping["id"],
    )).scalars().all())
    if task_row._mapping.get("assignee_id"):
        recipient_ids.add(task_row._mapping["assignee_id"])
    if project_row._mapping.get("team_lead"):
        recipient_ids.add(project_row._mapping["team_lead"])
    recipient_ids.discard(user._mapping["id"])
    for recipient_id in recipient_ids:
        _create_notification(
            db,
            recipient_id,
            "New task comment",
            f"{user._mapping['name']} commented on \"{task_row._mapping['title']}\" in {project_row._mapping['name']}.",
        )
    if recipient_ids:
        db.commit()
    return comment


@router.get("/tasks/{task_id}/comments")
def list_task_comments(task_id: str, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    task = _get_or_404(db, "tasks", task_id)
    rows = db.execute(
        select(_table("task_comments"))
        .where(_table("task_comments").c.task_id == task._mapping["id"])
        .order_by(_table("task_comments").c.created_at)
    ).all()
    comments = []
    for row in rows:
        comment = _row(row, "task_comments")
        comment["user"] = _user(db, comment.get("user_id"))
        comments.append(comment)
    return comments


@router.delete("/tasks/{task_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_comment(task_id: str, comment_id: str, db: Session = Depends(get_db)) -> Response:
    try:
        parsed_task_id, parsed_comment_id = uuid.UUID(task_id), uuid.UUID(comment_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Comment not found") from exc
    result = db.execute(delete(_table("task_comments")).where(
        _table("task_comments").c.id == parsed_comment_id,
        _table("task_comments").c.task_id == parsed_task_id,
    ))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(status_code=404, detail="Comment not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/my/tasks")
def my_tasks(user: Any = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    parsed_user_id = user._mapping["id"]
    membership_workspace_ids = select(_table("workspace_members").c.workspace_id).where(_table("workspace_members").c.user_id == parsed_user_id)
    rows = db.execute(
        select(_table("tasks"))
        .join(_table("projects"), _table("projects").c.id == _table("tasks").c.project_id)
        .where(_table("tasks").c.assignee_id == parsed_user_id, _table("projects").c.workspace_id.in_(membership_workspace_ids))
    ).all()
    results: list[dict[str, Any]] = []
    for row in rows:
        task = _row(row, "tasks")
        project = _get(db, "projects", task["project_id"])
        task["assignee"] = _user(db, task["assignee_id"])
        task["project"] = _row(project, "projects") if project else None
        results.append(task)
    return results
