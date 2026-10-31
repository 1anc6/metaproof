"""Postgres-backed job queue and the analysis worker.

Jobs are claimed with SELECT ... FOR UPDATE SKIP LOCKED, so several workers can share
the table safely without Redis. The worker sleeps until a new upload wakes it instead of
polling: Neon suspends idle databases, and a polling loop would keep it awake (and billed).
"""

import logging
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app import engine as evidence
from app import memory, models, retention
from app.analyzers import ANALYZERS
from app.analyzers.base import Finding, MediaInfo
from app.db import SessionLocal

log = logging.getLogger("metaproof.worker")

MAINTENANCE_INTERVAL_S = 3600  # hourly, so 1-day retention deletes data within ~25 hours
# A job that was running when the process died is retried, but not forever: an image that
# crashes the process (say, by running it out of memory) would otherwise crash every restart.
MAX_ATTEMPTS = 3

CLAIM_SQL = text("""
    UPDATE analysis_jobs
       SET status = 'running', started_at = now(), attempts = attempts + 1, current_step = NULL
     WHERE id = (
        SELECT id FROM analysis_jobs
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
    RETURNING id
""")


class Worker:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="analysis-worker", daemon=True)
        self._last_maintenance: float | None = None

    def start(self) -> None:
        # Recovery reads the database, so it runs on the worker thread: the API must answer
        # /health right away even while Neon wakes up or is unreachable.
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=10)

    def notify(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        try:
            recover_interrupted_jobs()
        except Exception:
            log.exception("could not recover interrupted jobs")
        self._wake.set()  # drain anything queued before startup
        while not self._stop.is_set():
            self._wake.wait()
            self._wake.clear()
            try:
                while not self._stop.is_set() and process_next_job():
                    pass
            except Exception:  # keep the thread alive; the job row records the failure
                log.exception("worker loop error")
                time.sleep(2)
            self._maybe_run_maintenance()

    def _maybe_run_maintenance(self) -> None:
        # Runs only after a wake-up (startup or an upload), so an idle Neon database can sleep.
        now = time.monotonic()
        last = self._last_maintenance
        if last is not None and now - last < MAINTENANCE_INTERVAL_S:
            return
        self._last_maintenance = now
        try:
            retention.run_maintenance()
        except Exception:
            log.exception("maintenance failed")


def recover_interrupted_jobs() -> None:
    """After a restart, requeue jobs whose temp file survived and fail the rest, including
    jobs that have already been tried MAX_ATTEMPTS times."""
    with SessionLocal() as session:
        stuck = session.scalars(
            select(models.AnalysisJob).where(
                models.AnalysisJob.status.in_([models.JobStatus.running, models.JobStatus.queued])
            )
        ).all()
        for job in stuck:
            if job.attempts >= MAX_ATTEMPTS:
                log.warning("job %s interrupted %d times; giving up", job.id, job.attempts)
                _fail(job, "This image could not be analyzed.")
                _delete_upload(job)
            elif job.temp_path and Path(job.temp_path).exists():
                job.status = models.JobStatus.queued
            else:
                _fail(job, "The upload expired before analysis finished. Please upload again.")
        session.commit()


def process_next_job() -> bool:
    """Claim and run one job. Returns False when the queue is empty."""
    with SessionLocal() as session:
        job_id = session.execute(CLAIM_SQL).scalar_one_or_none()
        session.commit()
        if job_id is None:
            return False
        job = session.get(models.AnalysisJob, job_id)
        try:
            run_job(session, job)
        except Exception as exc:
            session.rollback()
            log.exception("job %s failed", job_id)
            job = session.get(models.AnalysisJob, job_id)
            _fail(job, f"Analysis failed: {type(exc).__name__}")
        finally:
            _delete_upload(job)
            session.commit()
    memory.release_freed_memory()
    return True


def run_job(session: Session, job: models.AnalysisJob) -> None:
    path = Path(job.temp_path or "")
    if not path.exists():
        raise FileNotFoundError("upload missing")
    media = MediaInfo(path, job.media.mime_type, job.media.width, job.media.height)

    all_findings: list[Finding] = []
    embedding: tuple[str, list[float]] | None = None
    for analyzer in ANALYZERS:
        set_step(job.id, analyzer.name)
        started = time.perf_counter()
        run = models.AnalyzerRun(
            job_id=job.id, analyzer=analyzer.name, analyzer_version=analyzer.version,
            ok=True, duration_ms=0, raw_output={},
        )
        try:
            with memory.big_image_lock:  # an upload being decoded waits for it, not alongside
                result = analyzer.run(media)
                memory.release_freed_memory()  # before the next analyzer decodes the image again
            run.raw_output = result.raw
            run.findings = [
                models.Finding(code=f.code, signal=f.signal.value, strength=f.strength.value,
                               message=f.message)
                for f in result.findings
            ]
            all_findings.extend(result.findings)
            if result.embedding is not None:
                embedding = (str(result.raw.get("model", analyzer.name)), result.embedding)
        except Exception as exc:
            # One broken analyzer must not sink the whole report.
            log.exception("analyzer %s failed on job %s", analyzer.name, job.id)
            run.ok = False
            run.error = f"{type(exc).__name__}: {exc}"[:500]
        run.duration_ms = int((time.perf_counter() - started) * 1000)
        session.add(run)

    if embedding is not None:
        try:
            with session.begin_nested():  # a savepoint: a failure here must not lose the report
                save_embedding(session, job.media_id, *embedding)
        except Exception:
            log.exception("could not store embedding for job %s", job.id)

    set_step(job.id, "verdict")
    decision = evidence.decide(all_findings)
    session.add(models.Verdict(
        job_id=job.id, label=decision.label, confidence=decision.confidence,
        engine_version=evidence.ENGINE_VERSION, scores=decision.scores,
        top_reasons=decision.top_reasons,
    ))
    job.status = models.JobStatus.done
    job.current_step = None
    flag_modified(job, "current_step")  # set_step wrote it in another session; this one saw NULL
    job.finished_at = datetime.now(UTC)


def set_step(job_id, step: str) -> None:
    """Publish progress for the polling client. A separate, short transaction: the job's own
    session keeps its results uncommitted until the end, so a failure never leaves half a report."""
    try:
        with SessionLocal() as session:
            session.execute(update(models.AnalysisJob)
                            .where(models.AnalysisJob.id == job_id)
                            .values(current_step=step))
            session.commit()
    except Exception:  # progress is cosmetic; never fail the analysis over it
        log.exception("could not record step %s for job %s", step, job_id)


UPSERT_EMBEDDING_SQL = text("""
    INSERT INTO media_embeddings (media_id, model, embedding)
    VALUES (:media_id, :model, CAST(:embedding AS vector))
    ON CONFLICT (media_id) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding
""")


def save_embedding(session: Session, media_id, model: str, vector: list[float]) -> None:
    # pgvector accepts the '[x,y,...]' text form; no extra Python dependency needed.
    literal = "[" + ",".join(f"{v:.6f}" for v in vector) + "]"
    session.execute(UPSERT_EMBEDDING_SQL, {"media_id": media_id, "model": model,
                                           "embedding": literal})


def _fail(job: models.AnalysisJob, message: str) -> None:
    job.status = models.JobStatus.failed
    job.error = message
    job.current_step = None
    flag_modified(job, "current_step")
    job.finished_at = datetime.now(UTC)


def _delete_upload(job: models.AnalysisJob | None) -> None:
    """Originals are never kept: delete the temp file whatever the outcome."""
    if job is None or not job.temp_path:
        return
    Path(job.temp_path).unlink(missing_ok=True)
    job.temp_path = None

