"""Retention: MetaProof analyzes images and reports; it does not keep them (default: 1 day).

An image and everything derived from it (thumbnail, embedding, jobs, findings) is deleted once
it has not been analyzed for `retention_days`. Uploading it again after that analyzes it anew.
Older analyses of an image that is still kept are trimmed too, except the one its shareable
report shows. The worker runs this at startup and then at most once an hour, only when woken by
an upload, so it never wakes a suspended database on its own.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import CursorResult, text
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import SessionLocal

log = logging.getLogger("metaproof.retention")

# Jobs still queued or running are never touched: their temp file and worker depend on them.
PURGE_MEDIA_SQL = text("""
    DELETE FROM media_files m
     WHERE m.first_seen_at < :cutoff
       AND m.sha256 <> :keep
       AND NOT EXISTS (
            SELECT 1 FROM analysis_jobs j
             WHERE j.media_id = m.id
               AND (j.created_at >= :cutoff OR j.status IN ('queued', 'running')))
""")

# Keeps the latest finished analysis of each image: GET /media/{sha256}/report serves it.
PURGE_SUPERSEDED_JOBS_SQL = text("""
    DELETE FROM analysis_jobs j
     WHERE j.created_at < :cutoff
       AND j.status IN ('done', 'failed')
       AND j.id IS DISTINCT FROM (
            SELECT k.id FROM analysis_jobs k
             WHERE k.media_id = j.media_id AND k.status = 'done'
             ORDER BY k.finished_at DESC
             LIMIT 1)
""")

DATABASE_SIZE_SQL = text("SELECT pg_database_size(current_database())")


@dataclass
class PurgeResult:
    media_deleted: int
    jobs_deleted: int


def retention_cutoff(settings: Settings) -> datetime | None:
    """Analyses created before this are expired; None when retention is turned off."""
    if settings.retention_days <= 0:
        return None
    return datetime.now(UTC) - timedelta(days=settings.retention_days)


def purge_expired(session: Session, cutoff: datetime, keep_sha256: str = "") -> PurgeResult:
    # A DELETE's result is a CursorResult, which knows how many rows it removed.
    media = cast(CursorResult, session.execute(
        PURGE_MEDIA_SQL, {"cutoff": cutoff, "keep": keep_sha256.lower()})).rowcount
    jobs = cast(CursorResult, session.execute(PURGE_SUPERSEDED_JOBS_SQL, {"cutoff": cutoff})).rowcount
    return PurgeResult(media_deleted=media, jobs_deleted=jobs)


def run_maintenance() -> None:
    """Purge expired data, then log the database size and warn when it nears the limit."""
    settings = get_settings()
    with SessionLocal() as session:
        cutoff = retention_cutoff(settings)
        if cutoff is not None:
            result = purge_expired(session, cutoff, settings.example_sha256)
            session.commit()
            if result.media_deleted or result.jobs_deleted:
                log.info("retention: deleted %d images and %d older analyses",
                         result.media_deleted, result.jobs_deleted)
        size_mb = session.scalar(DATABASE_SIZE_SQL) / (1024 * 1024)

    if size_mb >= settings.storage_warn_mb:
        log.warning("database is %.0f MB, past the %d MB warning threshold; lower "
                    "RETENTION_DAYS or upgrade the Neon plan", size_mb, settings.storage_warn_mb)
    else:
        log.info("database is %.0f MB (warning at %d MB)", size_mb, settings.storage_warn_mb)
