# Database

PostgreSQL is the source of truth for application data. The current local
database already contains tables. The previous Prisma schema is kept under
`reference/` for inspection only; FastAPI will use SQLAlchemy models and
Alembic migrations for schema changes.

Keep database credentials in `backend/.env`, never in the frontend. Migration
files belong in this folder and should be checked against the existing local
PostgreSQL schema before applying changes.
