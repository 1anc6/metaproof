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

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import engine as evidence
from app import models
from app.analyzers import ANALYZERS
from app.analyzers.base import Finding, MediaInfo
from app.db import SessionLocal

log = logging.getLogger("metaproof.worker")

CLAIM_SQL = text("""
    UPDATE analysis_jobs
       SET status = 'running', started_at = now(), attempts = attempts + 1
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

    def start(self) -> None:
        recover_interrupted_jobs()
        self._thread.start()
        self._wake.set()  # drain anything queued before startup

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=10)

    def notify(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait()
            self._wake.clear()
            try:
                while not self._stop.is_set() and process_next_job():
                    pass
            except Exception:  # keep the thread alive; the job row records the failure
                log.exception("worker loop error")
                time.sleep(2)


def recover_interrupted_jobs() -> None:
    """After a restart, requeue jobs whose temp file survived and fail the rest."""
    with SessionLocal() as session:
        stuck = session.scalars(
            select(models.AnalysisJob).where(
                models.AnalysisJob.status.in_([models.JobStatus.running, models.JobStatus.queued])
            )
        ).all()
        for job in stuck:
            if job.temp_path and Path(job.temp_path).exists():
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
    return True


def run_job(session: Session, job: models.AnalysisJob) -> None:
    path = Path(job.temp_path or "")
    if not path.exists():
        raise FileNotFoundError("upload missing")
    media = MediaInfo(path, job.media.mime_type, job.media.width, job.media.height)

    all_findings: list[Finding] = []
    for analyzer in ANALYZERS:
        started = time.perf_counter()
        run = models.AnalyzerRun(
            job_id=job.id, analyzer=analyzer.name, analyzer_version=analyzer.version,
            ok=True, duration_ms=0, raw_output={},
        )
        try:
            result = analyzer.run(media)
            run.raw_output = result.raw
            run.findings = [
                models.Finding(code=f.code, signal=f.signal.value, strength=f.strength.value,
                               message=f.message)
                for f in result.findings
            ]
            all_findings.extend(result.findings)
        except Exception as exc:
            # One broken analyzer must not sink the whole report.
            log.exception("analyzer %s failed on job %s", analyzer.name, job.id)
            run.ok = False
            run.error = f"{type(exc).__name__}: {exc}"[:500]
        run.duration_ms = int((time.perf_counter() - started) * 1000)
        session.add(run)

    decision = evidence.decide(all_findings)
    session.add(models.Verdict(
        job_id=job.id, label=decision.label, confidence=decision.confidence,
        engine_version=evidence.ENGINE_VERSION, scores=decision.scores,
        top_reasons=decision.top_reasons,
    ))
    job.status = models.JobStatus.done
    job.finished_at = datetime.now(UTC)


def _fail(job: models.AnalysisJob, message: str) -> None:
    job.status = models.JobStatus.failed
    job.error = message
    job.finished_at = datetime.now(UTC)


def _delete_upload(job: models.AnalysisJob | None) -> None:
    """Originals are never kept: delete the temp file whatever the outcome."""
    if job is None or not job.temp_path:
        return
    Path(job.temp_path).unlink(missing_ok=True)
    job.temp_path = None

