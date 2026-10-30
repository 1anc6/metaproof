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
    # Larger images are rejected. 24 MP still covers phone cameras' default photos and keeps the
    # worst case (an RGBA PNG at the limit) about 70 MB under the 512 MB Render free instance;
    # at 30 MP it peaked at 494 MB. It also guards against decompression bombs.
    max_image_pixels: int = 24_000_000
    temp_dir: Path = Path(tempfile.gettempdir()) / "metaproof"

    # Comma-separated list of frontend origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"

    # ONNX model from ml/export_onnx.py; the Docker image downloads it at build time.
    # When the file is missing the detector is skipped and the other analyzers still run.
    detector_model_path: Path = Path("models/detector.onnx")

    # Upload limits that protect the free tiers.
    uploads_per_ip_per_hour: int = 20
    daily_upload_cap: int = 500
    # Header holding the visitor's IP that the client cannot forge (set by Cloudflare on Render).
    client_ip_header: str = "cf-connecting-ip"

    # Images not analyzed for this many days are deleted, report included; 0 keeps everything.
    # One day: reports can still be shared for a while, but nothing is kept long term.
    retention_days: int = 1
    # The example report shown on the home screen (frontend/src/lib/demo.ts). It is exempt from
    # retention, so "See an example" keeps working; an empty value exempts nothing.
    example_sha256: str = "27da9d4deb3f8c139a1767e52e9ce1569eeb132e6e7dcf96d0902ec8bacb969c"
    # Log a warning once the database passes this size (Neon's free tier stops at 512 MB).
    storage_warn_mb: int = 400
    # The database plan's storage limit, shown on the status page (Neon free tier: 0.5 GB).
    storage_limit_mb: int = 512
    # The API instance's memory, shown on the status page beside what the process uses
    # (Render free instance: 512 MB).
    memory_limit_mb: int = 512

    # Cosine similarity at or above which two images count as near-duplicates.
    similar_min_similarity: float = 0.92

    # Run the analysis worker inside the API process (a single container on Render).
    run_worker: bool = True

    # Bump when analyzers or the evidence engine change, so old results are re-analyzed.
    pipeline_version: str = "0.7.1"

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
