# Team Task Manager

The repository is organized as a small monorepo:

```text
frontend/                 React + Vite application
backend/                  FastAPI application and Python dependencies
database/                 Database references and migration files
  migrations/             Database migration scripts
  reference/               Existing schema reference files
```

## Run the frontend

From the repository root:

```bash
npm install --prefix frontend
npm run dev
```

## Run the backend

Create and activate a virtual environment, install the backend requirements, then run:

```bash
python -m pip install -r backend/requirements.txt
npm run dev:backend
```

The backend health endpoint is `http://localhost:8000/api/health`. The database
health endpoint is `http://localhost:8000/api/health/db`, and the interactive API
reference is `http://localhost:8000/docs`.

The frontend reads and writes workspace, member, project, task, and task-comment
data through the FastAPI service. Existing browser data has to be migrated once
before account authentication is enabled. Set
`VITE_API_URL` in `frontend/.env` only if the backend API uses a different URL;
this variable must never contain database credentials.

Database credentials belong in `backend/.env`, which is ignored by Git. Use
`backend/.env.example` as a template. Never put database credentials in Vite
variables or commit a real `.env` file.

## Migrate PostgreSQL to Supabase

The migration helper restores the `public` schema and data into an **empty**
Supabase database. Back up both databases first. For a live PostgreSQL source,
install `pg_dump` and `pg_restore` and ensure they are available on `PATH`.

Add these values to `backend/.env` (the file is ignored by Git):

```dotenv
SOURCE_DATABASE_URL=postgresql://USER:PASSWORD@SOURCE_HOST:5432/DATABASE
SUPABASE_DATABASE_URL=postgresql://USER:PASSWORD@SUPABASE_HOST:5432/postgres?sslmode=require
```

For an existing custom-format backup, set `BACKUP_FILE` to its path; the
`SOURCE_DATABASE_URL` and `PG_DUMP_PATH` variables are then not needed. To copy
from a live PostgreSQL source instead, leave `BACKUP_FILE` blank and provide
`SOURCE_DATABASE_URL`; `PG_DUMP_PATH` is optional when `pg_dump` is on `PATH`.
`PG_RESTORE_PATH` is optional when `pg_restore` is on `PATH`. Use the Supabase
**Session Pooler** URL if the direct database connection is unavailable from
your network. URL-encode special characters in passwords. The script also
accepts the project's `postgresql+psycopg://` URL format.

For example, on Windows, quote paths containing spaces in `backend/.env`:

```dotenv
BACKUP_FILE="C:/Users/your-name/Documents/custom.backup"
PG_RESTORE_PATH="C:/Program Files/PostgreSQL/18/bin/pg_restore.exe"
```

Use forward slashes in Windows paths in `.env`; backslashes can be interpreted
as escape sequences while the file is loaded.

From the repository root, run:

```bash
python -m pip install -r backend/requirements.txt
python backend/scripts/migrate_to_supabase.py
```

Review the destination and type `MIGRATE` when prompted. The helper refuses to
restore if it finds tables, views, or sequences in Supabase's `public` schema;
use a fresh Supabase project rather than overwriting existing data. After
checking the migrated schema and data, set `DATABASE_URL` in `backend/.env` to
the Supabase URL so the application uses the new database. The migration helper
prompts for the Supabase database password without displaying it, so password
characters do not need to be escaped in the URL.

## Accounts and workspace roles

Use the sign-in screen to register a new account. To activate an existing
migrated profile, set its password locally from the `backend/` directory with
`python -m app.cli set-password --email user@example.com`; the command prompts
for the password and does not place it on the shell command line. The bearer
token identifies the signed-in user; the demo profile switcher is removed.
Passwords are stored as scrypt hashes and access tokens expire after
`ACCESS_TOKEN_MINUTES`. Set `AUTH_SECRET_KEY` to a long random value before
exposing the app outside local development.

Workspace admins can manage workspace settings, projects, members, invitations,
and task assignments. Members can view workspace data, comment, and update
tasks assigned to their account. The API checks membership and role on every
request, regardless of the controls shown in the UI.

Admins send seven-day invitations from **Team → Invite Member**. To deliver
them by email on Render Free, configure the Gmail API OAuth variables
(`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
`GMAIL_SENDER_EMAIL`) plus `FRONTEND_BASE_URL` in the backend service's
environment. Gmail API sends over HTTPS, so it works with Render's free service
limits. Alternatively, use Resend with a verified sender domain, or SMTP on a
paid Render service. See `backend/.env.example` for the complete variable list;
keep all keys and passwords private. If email is unconfigured or delivery fails,
the invitation remains valid and the app provides a copyable link. Invitees set
their name and password through the link. Workspace changes notify connected
browsers over an authenticated WebSocket, which then reloads authorized data
from the API.
