"""Local account maintenance commands for existing migrated user rows."""

from __future__ import annotations

import argparse
from getpass import getpass

from sqlalchemy import select, update

from app.api.auth import _password_hash, tables
from app.db.session import SessionLocal


def set_password(email: str) -> None:
    password = getpass("New password (at least 10 characters): ")
    if len(password) < 10:
        raise SystemExit("Password must contain at least 10 characters")
    confirm = getpass("Confirm password: ")
    if password != confirm:
        raise SystemExit("Passwords did not match")
    db = SessionLocal()
    try:
        users = tables["users"]
        user = db.execute(select(users).where(users.c.email == email.strip().lower())).first()
        if user is None:
            raise SystemExit("No existing account has that email")
        db.execute(update(users).where(users.c.id == user._mapping["id"]).values(
            password_hash=_password_hash(password), is_active=True,
        ))
        db.commit()
        print(f"Password set for {email.strip().lower()}. You can now sign in.")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    password_parser = subparsers.add_parser("set-password", help="activate an existing migrated account")
    password_parser.add_argument("--email", required=True)
    args = parser.parse_args()
    if args.command == "set-password":
        set_password(args.email)


if __name__ == "__main__":
    main()
