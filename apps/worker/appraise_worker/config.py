from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed worker configuration loaded from environment variables."""

    model_config = SettingsConfigDict(env_prefix="", env_file=".env", extra="ignore")

    appraise_env: Literal["development", "test", "production"] = "development"
    appraise_model_provider: Literal["fake", "anthropic"] = "fake"
    database_url: str = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")

    def validate_runtime(self) -> None:
        if self.appraise_env == "production" and not self.supabase_service_role_key.get_secret_value():
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required in production")
        if self.appraise_model_provider == "anthropic" and not self.anthropic_api_key.get_secret_value():
            raise ValueError("ANTHROPIC_API_KEY is required for the anthropic provider")


@lru_cache
def get_settings() -> Settings:
    return Settings()
