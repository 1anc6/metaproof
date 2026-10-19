"""End-to-end tests against a real Postgres with pgvector.

    TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/metaproof_test pytest
"""

import logging
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from tests.conftest import TEST_DATABASE_URL
from tests.helpers import jpeg_bytes, png_bytes

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")

if TEST_DATABASE_URL:
    from alembic import command
    from alembic.config import Config

    from app import models, retention, worker
    from app.analyzers.base import AnalyzerResult
    from app.analyzers.c2pa_check import C2paAnalyzer
    from app.analyzers.metadata import MetadataAnalyzer
    from app.api import routes
    from app.config import Settings, get_settings
    from app.db import SessionLocal, engine
    from app.main import app
    from app.ratelimit import SlidingWindowLimiter

BACKEND = Path(__file__).resolve().parent.parent
SOFTWARE = 305


@pytest.fixture(scope="session", autouse=True)
def schema():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE media_files CASCADE"))
    routes.upload_limiter._hits.clear()
    routes._status_cache = None
    # The detector needs a 121 MB model that CI does not download; its logic has unit tests.
    monkeypatch.setattr(worker, "ANALYZERS", [MetadataAnalyzer(), C2paAnalyzer()])
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def upload(client, data: bytes, name: str = "a.jpg", mime: str = "image/jpeg"):
    return client.post("/api/analyses", files={"file": (name, data, mime)})


def unique_jpeg(i: int) -> bytes:
    return jpeg_bytes(exif={SOFTWARE: f"Adobe Photoshop test {i}"})


def drain_queue() -> int:
    n = 0
    while worker.process_next_job():
        n += 1
    return n


# --- schema ---------------------------------------------------------------------------------

def test_migrations_create_tables_and_pgvector():
    with engine.connect() as conn:
        tables = set(conn.execute(text(
            "select tablename from pg_tables where schemaname = 'public'")).scalars())
        vector = conn.execute(text("select extversion from pg_extension where extname='vector'")).scalar()
    assert {"media_files", "analysis_jobs", "analyzer_runs", "findings", "verdicts",
            "media_embeddings"} <= tables
    assert vector is not None


def test_upload_filenames_are_not_stored():
    with engine.connect() as conn:
        columns = set(conn.execute(text(
            "select column_name from information_schema.columns "
            "where table_name = 'analysis_jobs'")).scalars())
    assert "original_filename" not in columns


# --- upload → queue → worker → report ---------------------------------------------------------

def test_upload_is_queued_then_analyzed(client):
    r = upload(client, unique_jpeg(1))
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued" and body["duplicate"] is False

    assert drain_queue() == 1

    job = client.get(f"/api/analyses/{body['job_id']}").json()
    assert job["status"] == "done"
    assert job["verdict"]["label"] == "edited"
    assert {a["analyzer"] for a in job["analyzers"]} == {"metadata", "c2pa"}
    assert any(f["code"] == "meta.editor_tag" for a in job["analyzers"] for f in a["findings"])

    with SessionLocal() as s:
        row = s.get(models.AnalysisJob, job["job_id"])
        assert row.temp_path is None  # the uploaded file was deleted

    report = client.get(f"/api/media/{body['sha256']}/report")
    assert report.status_code == 200 and report.json()["job_id"] == body["job_id"]
    thumb = client.get(f"/api/media/{body['sha256']}/thumbnail")
    assert thumb.headers["content-type"] == "image/webp"


def test_running_job_reports_its_current_step(client, monkeypatch):
    body = upload(client, unique_jpeg(3)).json()
    seen: list[tuple[str, str | None]] = []

    class Spy:
        """Polls the API from inside the worker, the way the progress screen does."""
        version = "test"

        def __init__(self, name):
            self.name = name

        def run(self, media):
            job = client.get(f"/api/analyses/{body['job_id']}").json()
            seen.append((job["status"], job["current_step"]))
            return AnalyzerResult()

    monkeypatch.setattr(worker, "ANALYZERS", [Spy("metadata"), Spy("c2pa")])
    assert client.get(f"/api/analyses/{body['job_id']}").json()["current_step"] is None  # queued
    drain_queue()

    assert seen == [("running", "metadata"), ("running", "c2pa")]
    assert client.get(f"/api/analyses/{body['job_id']}").json()["current_step"] is None
    with SessionLocal() as s:
        assert s.get(models.AnalysisJob, body["job_id"]).current_step is None  # cleared, not hidden


def test_duplicate_upload_reuses_the_existing_job(client):
    data = unique_jpeg(2)
    first = upload(client, data).json()
    second = upload(client, data)
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["job_id"] == first["job_id"]
    with SessionLocal() as s:
        assert s.scalar(select(func.count()).select_from(models.AnalysisJob)) == 1


def test_rejected_upload_creates_no_rows(client):
    r = upload(client, b"%PDF-1.7 not an image", "x.pdf", "application/pdf")
    assert r.status_code == 422
    with SessionLocal() as s:
        assert s.scalar(select(func.count()).select_from(models.MediaFile)) == 0


def test_history_summaries_return_only_known_ids(client):
    a = upload(client, unique_jpeg(3)).json()
    b = upload(client, unique_jpeg(4)).json()
    drain_queue()
    rows = client.get("/api/analyses", params={
        "ids": [a["job_id"], b["job_id"], "00000000-0000-0000-0000-000000000000"]}).json()
    assert {r["job_id"] for r in rows} == {a["job_id"], b["job_id"]}
    assert all(r["label"] == "edited" for r in rows)


# --- the queue under concurrency --------------------------------------------------------------

def test_concurrent_workers_process_each_job_exactly_once(client):
    jobs = [upload(client, unique_jpeg(100 + i)).json()["job_id"] for i in range(12)]
    processed: list[int] = []
    threads = [threading.Thread(target=lambda: processed.append(drain_queue())) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sum(processed) == len(jobs)  # FOR UPDATE SKIP LOCKED: no job claimed twice
    with SessionLocal() as s:
        rows = s.scalars(select(models.AnalysisJob)).all()
        assert all(j.status == models.JobStatus.done and j.attempts == 1 for j in rows)
        assert s.scalar(select(func.count()).select_from(models.Verdict)) == len(jobs)


def test_job_fails_cleanly_when_its_file_is_gone(client):
    body = upload(client, unique_jpeg(5)).json()
    with SessionLocal() as s:
        Path(s.get(models.AnalysisJob, body["job_id"]).temp_path).unlink()
    drain_queue()
    job = client.get(f"/api/analyses/{body['job_id']}").json()
    assert job["status"] == "failed" and job["verdict"] is None and job["current_step"] is None


def test_restart_recovery_requeues_or_fails_interrupted_jobs(client):
    kept = upload(client, unique_jpeg(6)).json()["job_id"]
    lost = upload(client, unique_jpeg(7)).json()["job_id"]
    with SessionLocal() as s:
        for job_id in (kept, lost):
            s.get(models.AnalysisJob, job_id).status = models.JobStatus.running
        Path(s.get(models.AnalysisJob, lost).temp_path).unlink()
        s.commit()

    worker.recover_interrupted_jobs()

    with SessionLocal() as s:
        assert s.get(models.AnalysisJob, kept).status == models.JobStatus.queued
        assert s.get(models.AnalysisJob, lost).status == models.JobStatus.failed


# --- limits -----------------------------------------------------------------------------------

def test_per_ip_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(routes, "upload_limiter", SlidingWindowLimiter(2))
    assert upload(client, unique_jpeg(8)).status_code == 202
    assert upload(client, unique_jpeg(9)).status_code == 202
    r = upload(client, unique_jpeg(10))
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_per_ip_limit_ignores_a_forged_forwarded_for(client, monkeypatch):
    """Render's proxy passes X-Forwarded-For through, so changing it must not reset the limit."""
    monkeypatch.setattr(routes, "upload_limiter", SlidingWindowLimiter(2))
    for i, forged in enumerate(("1.1.1.1", "2.2.2.2")):
        r = client.post("/api/analyses", files={"file": ("a.jpg", unique_jpeg(40 + i), "image/jpeg")},
                        headers={"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": forged})
        assert r.status_code == 202
    r = client.post("/api/analyses", files={"file": ("a.jpg", unique_jpeg(42), "image/jpeg")},
                    headers={"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "3.3.3.3"})
    assert r.status_code == 429
    other = client.post("/api/analyses", files={"file": ("a.jpg", unique_jpeg(43), "image/jpeg")},
                        headers={"CF-Connecting-IP": "198.51.100.9"})
    assert other.status_code == 202  # a different visitor has their own allowance


def test_daily_cap_returns_429(client):
    app.dependency_overrides[get_settings] = lambda: Settings(daily_upload_cap=1)
    assert upload(client, unique_jpeg(11)).status_code == 202
    r = upload(client, unique_jpeg(12))
    assert r.status_code == 429 and "daily" in r.json()["detail"]


# --- near-duplicate search (pgvector) ---------------------------------------------------------

def test_similar_finds_near_duplicates_only(client):
    shas = []
    for i, data in enumerate((unique_jpeg(20), unique_jpeg(21), png_bytes({"k": "far"}))):
        shas.append(upload(client, data, f"{i}.img", "image/jpeg").json()["sha256"])
    drain_queue()

    base = [1.0] + [0.0] * 511
    near = [0.99, 0.14] + [0.0] * 510   # cosine ~0.99 with base
    far = [0.0, 1.0] + [0.0] * 510      # orthogonal
    with SessionLocal() as s:
        ids = {m.sha256: m.id for m in s.scalars(select(models.MediaFile))}
        for sha, vec in zip(shas, (base, near, far)):
            worker.save_embedding(s, ids[sha], "test", vec)
        s.commit()

    found = client.get(f"/api/media/{shas[0]}/similar").json()
    assert [m["sha256"] for m in found] == [shas[1]]
    assert found[0]["similarity"] > 0.98 and found[0]["label"] == "edited"
    # Files without an embedding simply have no matches.
    assert client.get("/api/media/" + "0" * 64 + "/similar").json() == []


# --- retention --------------------------------------------------------------------------------

def age(job_id: str, days: int) -> None:
    """Pretend a job (and its image, if older) was created `days` ago."""
    when = datetime.now(UTC) - timedelta(days=days)
    with SessionLocal() as s:
        job = s.get(models.AnalysisJob, job_id)
        job.created_at = job.finished_at = when
        job.media.first_seen_at = min(job.media.first_seen_at, when)
        s.commit()


def purge(days: int = 90) -> "retention.PurgeResult":
    with SessionLocal() as s:
        result = retention.purge_expired(s, datetime.now(UTC) - timedelta(days=days))
        s.commit()
    return result


def counts() -> tuple[int, int, int]:
    with SessionLocal() as s:
        return tuple(s.scalar(select(func.count()).select_from(t)) for t in
                     (models.MediaFile, models.AnalysisJob, models.Finding))


def test_retention_deletes_expired_images_and_everything_derived(client):
    old = upload(client, unique_jpeg(30)).json()
    fresh = upload(client, unique_jpeg(31)).json()
    drain_queue()
    with SessionLocal() as s:
        media_id = s.get(models.AnalysisJob, old["job_id"]).media_id
        worker.save_embedding(s, media_id, "test", [1.0] + [0.0] * 511)
        s.commit()
    age(old["job_id"], 91)

    assert purge() == retention.PurgeResult(media_deleted=1, jobs_deleted=0)

    assert client.get(f"/api/media/{old['sha256']}/report").status_code == 404
    assert client.get(f"/api/media/{old['sha256']}/thumbnail").status_code == 404
    assert client.get(f"/api/analyses/{old['job_id']}").status_code == 404
    assert client.get(f"/api/media/{fresh['sha256']}/report").status_code == 200
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from media_embeddings")).scalar() == 0
    assert counts()[:2] == (1, 1)


def test_retention_keeps_the_report_job_and_trims_older_ones(client):
    app.dependency_overrides[get_settings] = lambda: Settings(pipeline_version="old")
    first = upload(client, unique_jpeg(32)).json()
    drain_queue()
    app.dependency_overrides[get_settings] = lambda: Settings(pipeline_version="new")
    second = upload(client, unique_jpeg(32)).json()  # re-analyzed under a newer pipeline
    drain_queue()
    age(first["job_id"], 200)
    age(second["job_id"], 100)
    third = upload(client, unique_jpeg(32)).json()  # expired, so analyzed again
    assert third["duplicate"] is False
    drain_queue()

    assert purge() == retention.PurgeResult(media_deleted=0, jobs_deleted=2)
    report = client.get(f"/api/media/{first['sha256']}/report").json()
    assert report["job_id"] == third["job_id"]


def test_retention_never_touches_queued_jobs(client):
    body = upload(client, unique_jpeg(33)).json()
    age(body["job_id"], 365)  # e.g. the worker was down for a long time

    assert purge() == retention.PurgeResult(media_deleted=0, jobs_deleted=0)
    assert drain_queue() == 1


def test_reupload_of_an_expired_image_is_analyzed_again(client):
    data = unique_jpeg(34)
    first = upload(client, data).json()
    drain_queue()
    assert upload(client, data).json()["duplicate"] is True
    age(first["job_id"], 91)

    again = upload(client, data)
    assert again.status_code == 202
    assert again.json()["duplicate"] is False and again.json()["job_id"] != first["job_id"]


def test_retention_can_be_turned_off(client):
    body = upload(client, unique_jpeg(35)).json()
    drain_queue()
    age(body["job_id"], 3650)
    app.dependency_overrides[get_settings] = lambda: Settings(retention_days=0)
    assert upload(client, unique_jpeg(35)).json()["duplicate"] is True
    assert retention.retention_cutoff(Settings(retention_days=0)) is None


def test_maintenance_purges_and_warns_near_the_storage_limit(client, monkeypatch, caplog):
    body = upload(client, unique_jpeg(36)).json()
    drain_queue()
    age(body["job_id"], 91)
    monkeypatch.setattr(retention, "get_settings", lambda: Settings(storage_warn_mb=0))

    with caplog.at_level(logging.INFO, logger="metaproof.retention"):
        retention.run_maintenance()

    assert counts() == (0, 0, 0)
    assert any(r.levelno == logging.WARNING and "warning threshold" in r.getMessage()
               for r in caplog.records)


def test_worker_runs_maintenance_at_most_once_a_day(monkeypatch):
    calls = []
    monkeypatch.setattr(retention, "run_maintenance", lambda: calls.append(1))
    clock = [1000.0]
    monkeypatch.setattr(worker.time, "monotonic", lambda: clock[0])
    w = worker.Worker()

    w._maybe_run_maintenance()  # startup
    clock[0] += 3600
    w._maybe_run_maintenance()  # an upload an hour later
    clock[0] += worker.MAINTENANCE_INTERVAL_S
    w._maybe_run_maintenance()  # an upload the next day
    assert len(calls) == 2


# --- status -----------------------------------------------------------------------------------

def test_status_reports_storage_and_the_last_day(client):
    upload(client, unique_jpeg(50))
    gone = upload(client, unique_jpeg(51)).json()
    with SessionLocal() as s:
        Path(s.get(models.AnalysisJob, gone["job_id"]).temp_path).unlink()
    drain_queue()  # one done, one failed (its file vanished)

    body = client.get("/api/status").json()
    assert body["analyses_24h"] == 2 and body["failed_24h"] == 1
    assert 0 < body["database_mb"] < body["storage_limit_mb"] == 512
    assert body["storage_warn_mb"] == 400 and body["retention_days"] == 90
    assert body["daily_cap"] == 500 and body["last_analysis_at"]


def test_status_is_cached_for_a_minute(client):
    first = client.get("/api/status").json()
    upload(client, unique_jpeg(52))
    assert client.get("/api/status").json() == first  # served from the cache
    routes._status_cache = None
    assert client.get("/api/status").json()["analyses_24h"] == first["analyses_24h"] + 1
