import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.config import Settings, get_settings
from app.db import get_session
from app.ingest import UploadRejected, ingest

router = APIRouter(prefix="/api")

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/health", tags=["System"], summary="Health check")
def health() -> dict:
    return {"status": "ok"}


@router.post(
    "/analyses",
    response_model=schemas.JobCreated,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Analyses"],
    summary="Upload an image for analysis",
    responses={200: {"description": "Already analyzed: returns the existing job"},
               422: {"description": "Not a supported image, too large, or corrupt"}},
)
def create_analysis(
    file: UploadFile,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
):
    """Accepts JPEG, PNG, WebP or TIFF. Returns a job id to poll; the file itself is deleted
    after analysis. Uploading a file that was already analyzed returns the existing job."""
    try:
        upload = ingest(file.file, settings.temp_dir, settings.max_upload_bytes,
                        settings.max_image_pixels)
    except UploadRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

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

        existing = _latest_job(session, media.id, settings.pipeline_version)
        if existing is not None:
            upload.path.unlink(missing_ok=True)
            session.commit()
            response.status_code = status.HTTP_200_OK
            return schemas.JobCreated(job_id=existing.id, sha256=media.sha256,
                                      status=existing.status.value, duplicate=True)

        job = models.AnalysisJob(
            media_id=media.id, pipeline_version=settings.pipeline_version,
            original_filename=(file.filename or "")[:255] or None, temp_path=str(upload.path),
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
    job = session.scalars(
        _job_query()
        .join(models.AnalysisJob.media)
        .where(models.MediaFile.sha256 == sha256.lower(),
               models.AnalysisJob.status == models.JobStatus.done)
        .order_by(models.AnalysisJob.finished_at.desc())
        .limit(1)
    ).one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No finished report for this file.")
    return _job_out(job)


@router.get("/media/{sha256}/thumbnail", tags=["Reports"], summary="Thumbnail (WebP)",
            response_class=Response)
def get_thumbnail(sha256: str, session: SessionDep):
    thumb = session.scalar(
        select(models.MediaFile.thumbnail).where(models.MediaFile.sha256 == sha256.lower())
    )
    if thumb is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown file.")
    return Response(thumb, media_type="image/webp",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


def _latest_job(session: Session, media_id: uuid.UUID, pipeline_version: str):
    """A queued, running or finished job for this file under the current pipeline, if any."""
    return session.scalars(
        select(models.AnalysisJob)
        .where(models.AnalysisJob.media_id == media_id,
               models.AnalysisJob.pipeline_version == pipeline_version,
               models.AnalysisJob.status != models.JobStatus.failed)
        .order_by(models.AnalysisJob.created_at.desc())
        .limit(1)
    ).one_or_none()


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

