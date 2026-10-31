import re
import threading
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app import memory, models, schemas
from app.analyzers import ANALYZERS
from app.config import Settings, get_settings
from app.db import get_session
from app.ingest import UploadRejected, ingest
from app.ratelimit import RateLimited, SlidingWindowLimiter, check_daily_cap, client_ip
from app.retention import retention_cutoff

router = APIRouter(prefix="/api")

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

upload_limiter = SlidingWindowLimiter(get_settings().uploads_per_ip_per_hour)
DETECTOR = next(a for a in ANALYZERS if a.name == "detector")
SHA256_RE = re.compile(r"[0-9a-f]{64}")


# HEAD too: uptime monitors (UptimeRobot) check with HEAD, and a 405 reads as an outage.
@router.api_route("/health", methods=["GET", "HEAD"], tags=["System"], summary="Health check")
def health() -> dict:
    return {"status": "ok"}


STATUS_SQL = text("""
    SELECT pg_database_size(current_database()) AS size_bytes,
           count(*) FILTER (WHERE created_at >= now() - interval '1 day') AS analyses_24h,
           count(*) FILTER (WHERE created_at >= now() - interval '1 day'
                              AND status = 'failed') AS failed_24h,
           max(finished_at) AS last_analysis_at
      FROM analysis_jobs
""")
STATUS_TTL_S = 10
_status_cache: tuple[float, schemas.ServiceStatus] | None = None
_status_lock = threading.Lock()


@router.get("/status", response_model=schemas.ServiceStatus, tags=["System"],
            summary="Storage and analysis figures")
def service_status(session: SessionDep, settings: SettingsDep):
    """Database size against the plan's limit, the last day's analyses and failures, and the
    API's memory and detector model. Unlike /health this reads the database, so the database
    figures are cached for STATUS_TTL_S seconds: the Settings page polls it, and however many tabs
    are open the database answers it at most once per window. Memory and the model cost nothing
    to read and change from one analysis to the next, so they are read every time."""
    global _status_cache
    with _status_lock:
        if not (_status_cache and time.monotonic() - _status_cache[0] < STATUS_TTL_S):
            row = session.execute(STATUS_SQL).one()
            _status_cache = (time.monotonic(), schemas.ServiceStatus(
                database_mb=round(row.size_bytes / (1024 * 1024), 1),
                storage_warn_mb=settings.storage_warn_mb,
                storage_limit_mb=settings.storage_limit_mb,
                retention_days=settings.retention_days,
                analyses_24h=row.analyses_24h,
                failed_24h=row.failed_24h,
                daily_cap=settings.daily_upload_cap,
                last_analysis_at=row.last_analysis_at,
                pipeline_version=settings.pipeline_version,
                memory_limit_mb=settings.memory_limit_mb,
                detector="missing",  # replaced below on every request
            ))
        cached = _status_cache[1]
    now_mb, peak_mb = memory.process_memory_mb()
    detector = "loaded" if DETECTOR.loaded else "available" if DETECTOR.available else "missing"
    return cached.model_copy(update={"memory_mb": now_mb, "memory_peak_mb": peak_mb,
                                     "detector": detector})


@router.post(
    "/analyses",
    response_model=schemas.JobCreated,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Analyses"],
    summary="Upload an image for analysis",
    responses={200: {"description": "Already analyzed: returns the existing job"},
               422: {"description": "Not a supported image, too large, or corrupt"},
               429: {"description": "Upload limit reached"}},
)
def create_analysis(
    file: UploadFile,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
):
    """Accepts JPEG, PNG, WebP, TIFF or HEIC. Returns a job id to poll; the file itself is deleted
    after analysis. Uploading a file that was already analyzed returns the existing job."""
    try:
        upload_limiter.check(client_ip(request, settings.client_ip_header))
        check_daily_cap(session, settings.daily_upload_cap)
    except RateLimited as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc),
                            headers={"Retry-After": str(exc.retry_after)}) from exc
    try:
        upload = ingest(file.file, settings.temp_dir, settings.max_upload_bytes,
                        settings.max_image_pixels)
    except UploadRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    try:
        # Insert-or-ignore keeps concurrent uploads of the same file from racing.
        session.execute(
            insert(models.MediaFile)
            .values(sha256=upload.sha256, mime_type=upload.mime_type, size_bytes=upload.size_bytes,
                    width=upload.width, height=upload.height, thumbnail=upload.thumbnail)
            .on_conflict_do_nothing(index_elements=["sha256"])
        )
        media = session.scalars(
            select(models.MediaFile).where(models.MediaFile.sha256 == upload.sha256)
        ).one()

        existing = _latest_job(session, media.id, settings)
        if existing is not None:
            upload.path.unlink(missing_ok=True)
            session.commit()
            response.status_code = status.HTTP_200_OK
            return schemas.JobCreated(job_id=existing.id, sha256=media.sha256,
                                      status=existing.status.value, duplicate=True)

        job = models.AnalysisJob(
            media_id=media.id, pipeline_version=settings.pipeline_version,
            temp_path=str(upload.path),
        )
        session.add(job)
        session.commit()
    except BaseException:
        upload.path.unlink(missing_ok=True)
        raise

    worker = getattr(request.app.state, "worker", None)
    if worker is not None:
        worker.notify()
    return schemas.JobCreated(job_id=job.id, sha256=media.sha256, status=job.status.value,
                              duplicate=False)


@router.get("/analyses", response_model=list[schemas.JobSummary], tags=["Analyses"],
            summary="Summaries for a list of jobs")
def list_analyses(
    session: SessionDep,
    ids: Annotated[list[uuid.UUID], Query(max_length=100)],
):
    """There are no accounts, so each browser keeps its own job ids and asks for them here.
    Unknown ids are skipped. Results are newest first."""
    jobs = session.scalars(
        select(models.AnalysisJob)
        .options(selectinload(models.AnalysisJob.media), selectinload(models.AnalysisJob.verdict))
        .where(models.AnalysisJob.id.in_(ids))
        .order_by(models.AnalysisJob.created_at.desc())
    ).all()
    return [
        schemas.JobSummary(
            job_id=j.id, status=j.status.value, sha256=j.media.sha256,
            mime_type=j.media.mime_type, size_bytes=j.media.size_bytes, width=j.media.width,
            height=j.media.height, label=j.verdict.label if j.verdict else None,
            confidence=j.verdict.confidence if j.verdict else None,
            created_at=j.created_at, finished_at=j.finished_at,
        )
        for j in jobs
    ]


@router.get("/analyses/{job_id}", response_model=schemas.JobOut, tags=["Analyses"],
            summary="Get job status, verdict and findings")
def get_analysis(job_id: uuid.UUID, session: SessionDep):
    """Poll until `status` is `done` or `failed`."""
    job = session.scalars(_job_query().where(models.AnalysisJob.id == job_id)).one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found.")
    return _job_out(job)


@router.get("/media/{sha256}/report", response_model=schemas.JobOut, tags=["Reports"],
            summary="Shareable report for a file")
def get_report(sha256: str, session: SessionDep):
    """Shareable link: the latest finished analysis of a file, addressed by its hash."""
    sha256 = _file_hash(sha256, "No finished report for this file.")
    job = session.scalars(
        _job_query()
        .join(models.AnalysisJob.media)
        .where(models.MediaFile.sha256 == sha256,
               models.AnalysisJob.status == models.JobStatus.done)
        .order_by(models.AnalysisJob.finished_at.desc())
        .limit(1)
    ).one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No finished report for this file.")
    return _job_out(job)


SIMILAR_SQL = text("""
    WITH target AS (
        SELECT e.embedding FROM media_embeddings e
        JOIN media_files m ON m.id = e.media_id WHERE m.sha256 = :sha
    )
    SELECT m.sha256, m.first_seen_at,
           1 - (e.embedding <=> (SELECT embedding FROM target)) AS similarity,
           (SELECT v.label FROM analysis_jobs j JOIN verdicts v ON v.job_id = j.id
             WHERE j.media_id = m.id ORDER BY j.finished_at DESC LIMIT 1) AS label
      FROM media_embeddings e
      JOIN media_files m ON m.id = e.media_id
     WHERE m.sha256 <> :sha AND EXISTS (SELECT 1 FROM target)
     ORDER BY e.embedding <=> (SELECT embedding FROM target)
     LIMIT :limit
""")


@router.get("/media/{sha256}/similar", response_model=list[schemas.SimilarMedia],
            tags=["Reports"], summary="Near-duplicates analyzed before")
def get_similar(sha256: str, session: SessionDep, settings: SettingsDep,
                limit: Annotated[int, Query(ge=1, le=10)] = 5):
    """Other files that look like the same picture (resized, cropped or recompressed copies),
    found by CLIP embedding similarity with a pgvector HNSW index."""
    if not SHA256_RE.fullmatch(sha256.lower()):
        return []
    rows = session.execute(SIMILAR_SQL, {"sha": sha256.lower(), "limit": limit}).all()
    return [
        schemas.SimilarMedia(sha256=r.sha256, similarity=round(float(r.similarity), 4),
                             label=r.label, first_seen_at=r.first_seen_at)
        for r in rows if r.similarity >= settings.similar_min_similarity
    ]


@router.get("/media/{sha256}/thumbnail", tags=["Reports"], summary="Thumbnail (WebP)",
            response_class=Response)
def get_thumbnail(sha256: str, session: SessionDep):
    sha256 = _file_hash(sha256, "Unknown file.")
    thumb = session.scalar(
        select(models.MediaFile.thumbnail).where(models.MediaFile.sha256 == sha256)
    )
    if thumb is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown file.")
    return Response(thumb, media_type="image/webp",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


def _file_hash(value: str, not_found: str) -> str:
    """The lowercase SHA-256 in a URL. Anything else can't name a file, so it is a 404 at once,
    without a database query; the client already handles 404."""
    sha256 = value.lower()
    if not SHA256_RE.fullmatch(sha256):
        raise HTTPException(status.HTTP_404_NOT_FOUND, not_found)
    return sha256


def _latest_job(session: Session, media_id: uuid.UUID, settings: Settings):
    """A queued, running or finished job for this file under the current pipeline, if any.
    Expired jobs don't count: re-uploading the file re-analyzes it and restarts its retention."""
    query = (
        select(models.AnalysisJob)
        .where(models.AnalysisJob.media_id == media_id,
               models.AnalysisJob.pipeline_version == settings.pipeline_version,
               models.AnalysisJob.status != models.JobStatus.failed)
        .order_by(models.AnalysisJob.created_at.desc())
        .limit(1)
    )
    cutoff = retention_cutoff(settings)
    if cutoff is not None:
        query = query.where(models.AnalysisJob.created_at >= cutoff)
    return session.scalars(query).one_or_none()


def _job_query():
    return select(models.AnalysisJob).options(
        selectinload(models.AnalysisJob.media),
        selectinload(models.AnalysisJob.verdict),
        selectinload(models.AnalysisJob.runs).selectinload(models.AnalyzerRun.findings),
    )


def _job_out(job: models.AnalysisJob) -> schemas.JobOut:
    m, v = job.media, job.verdict
    return schemas.JobOut(
        job_id=job.id, status=job.status.value, error=job.error,
        current_step=job.current_step if job.status == models.JobStatus.running else None,
        pipeline_version=job.pipeline_version, created_at=job.created_at,
        finished_at=job.finished_at,
        media=schemas.MediaOut(sha256=m.sha256, mime_type=m.mime_type, size_bytes=m.size_bytes,
                               width=m.width, height=m.height, first_seen_at=m.first_seen_at),
        verdict=None if v is None else schemas.VerdictOut(
            label=v.label, confidence=v.confidence, engine_version=v.engine_version,
            scores=v.scores, top_reasons=[schemas.FindingOut(**r) for r in v.top_reasons],
        ),
        analyzers=[
            schemas.AnalyzerOut(
                analyzer=r.analyzer, version=r.analyzer_version, ok=r.ok,
                duration_ms=r.duration_ms, error=r.error, raw=r.raw_output,
                findings=[schemas.FindingOut(code=f.code, signal=f.signal, strength=f.strength,
                                             message=f.message) for f in r.findings],
            )
            for r in job.runs
        ],
    )

