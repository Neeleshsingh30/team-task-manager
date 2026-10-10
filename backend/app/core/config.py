from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str
    cors_origins: str = "http://localhost:5173"
    auth_secret_key: str = "development-only-change-this-secret-before-deploying"
    access_token_minutes: int = 720
    frontend_base_url: str = "http://localhost:5173"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "Team Task Manager"
    smtp_use_ssl: bool = False
    smtp_starttls: bool = True
    smtp_timeout_seconds: int = 15

    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def require_production_secret(self):
        if self.app_env.lower() == "production" and self.auth_secret_key == "development-only-change-this-secret-before-deploying":
            raise ValueError("AUTH_SECRET_KEY must be set to a private random value in production")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def smtp_configured(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_from_email))


@lru_cache
def get_settings() -> Settings:
    return Settings()
