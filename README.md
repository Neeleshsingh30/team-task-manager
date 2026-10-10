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
them by email, set the `SMTP_*` values and `FRONTEND_BASE_URL` in `backend/.env`;
see `backend/.env.example` for the complete list. The sender address must be
authorized by the SMTP provider. Keep `SMTP_PASSWORD` private (for Gmail, use
an app password if the account requires one), then restart the backend. If SMTP
is not configured or delivery fails, the app keeps the invitation valid and
provides a copyable link as a fallback. Invitees set their name and password
through the link. Workspace changes notify connected browsers over an
authenticated WebSocket, which then reloads authorized data from the API.
