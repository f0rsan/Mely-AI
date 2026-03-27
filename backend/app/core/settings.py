from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MELY_", extra="ignore")

    app_env: str = Field(default="development")
    data_dir: Path | None = Field(default=None)
    model_registry_path: Path | None = Field(default=None)


def get_settings() -> Settings:
    return Settings()
