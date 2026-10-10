-- The API also creates this table idempotently on startup for local development.
CREATE TABLE IF NOT EXISTS public.workspace_invitations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email varchar(255) NOT NULL,
    role varchar(30) NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    token_hash varchar(64) NOT NULL UNIQUE,
    invited_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_workspace_invitations_workspace_email
    ON public.workspace_invitations (workspace_id, email);
