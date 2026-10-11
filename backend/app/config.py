import tempfile
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Neon gives a URL like postgresql://user:pass@host/db?sslmode=require
    database_url: str = "postgresql://localhost/metaproof"

    max_upload_mb: int = 25
    max_image_pixels: int = 50_000_000  # anything larger is treated as a decompression bomb
    temp_dir: Path = Path(tempfile.gettempdir()) / "metaproof"

    # Comma-separated list of frontend origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"

    # Run the analysis worker inside the API process (one container on HF Spaces).
    run_worker: bool = True

    # Bump when analyzers or the evidence engine change, so old results are re-analyzed.
    pipeline_version: str = "0.1.0"

    @field_validator("database_url")
    @classmethod
    def use_psycopg3_driver(cls, url: str) -> str:
        # SQLAlchemy needs the driver named explicitly; Neon's copy-paste URL omits it.
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
