CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id
    ON public.password_reset_tokens (user_id);
