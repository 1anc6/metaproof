"""End-to-end timing of one analysis: upload, each analyzer, and the finished report.

Starts the real API (FastAPI TestClient with the in-process worker) against a THROWAWAY
database, uploads distinct images of three sizes and reads the timings back:

  upload    time for POST /api/analyses to return (ingest, hashing, thumbnail, DB insert)
  analyzer  per-analyzer duration the worker records in analyzer_runs (whole milliseconds)
  report    POST until GET /api/analyses/{id} reports "done" (upload + queue + all analyzers
            + verdict), polled every 5 ms

The first upload of the run pays for loading the detector model and is reported separately.
Never point this at the production database: it truncates the tables.

    TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/metaproof_e2e \
    DETECTOR_MODEL_PATH=D:/metaproof/data/export/detector_vitb16_w8.onnx \
        python scripts/benchmark_pipeline.py --source <a real photo>.jpg --runs 15
"""

import argparse
import io
import json
import os
import random
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get("BACKEND_ROOT") or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT))

url = os.environ.get("TEST_DATABASE_URL")
if not url or "neon" in url:
    sys.exit("Set TEST_DATABASE_URL to a throwaway local database; this script deletes all rows.")
os.environ["DATABASE_URL"] = url
os.environ["UPLOADS_PER_IP_PER_HOUR"] = "100000"
os.environ["DAILY_UPLOAD_CAP"] = "1000000"
os.environ["RUN_WORKER"] = "true"

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.db import engine
from app.main import app

SIZES = {"1 MP": 1_000_000, "4 MP": 4_000_000, "12 MP": 12_000_000}


def make_image(source: Image.Image, pixels: int, seed: int) -> bytes:
    """Resize the photo to about `pixels` and paint a few random patches so every upload is
    a different file (identical files are deduplicated and would skip the pipeline)."""
    w, h = source.size
    scale = (pixels / (w * h)) ** 0.5
    img = source.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    rng = random.Random(seed)
    for _ in range(5):
        x, y = rng.randrange(img.width - 8), rng.randrange(img.height - 8)
        img.paste(tuple(rng.randrange(256) for _ in range(3)), (x, y, x + 8, y + 8))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


def summarize(values: list[float]) -> dict:
    return {"p50": round(statistics.median(values), 1), "p95": round(pct(values, 0.95), 1)}


def one(client: TestClient, data: bytes) -> dict:
    t0 = time.perf_counter()
    r = client.post("/api/analyses", files={"file": ("photo.jpg", data, "image/jpeg")})
    upload_ms = (time.perf_counter() - t0) * 1000
    r.raise_for_status()
    job = r.json()["job_id"]
    while True:
        body = client.get(f"/api/analyses/{job}").json()
        if body["status"] in ("done", "failed"):
            break
        time.sleep(0.005)
    total_ms = (time.perf_counter() - t0) * 1000
    assert body["status"] == "done", body.get("error")
    return {"upload": upload_ms, "report": total_ms,
            "analyzers": {a["analyzer"]: a["duration_ms"] for a in body["analyzers"]},
            "ok": all(a.get("ok", True) for a in body["analyzers"])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="a real photo to resize into test images")
    ap.add_argument("--runs", type=int, default=15)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "results_pipeline.json"))
    args = ap.parse_args()

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE media_files CASCADE"))

    source = Image.open(args.source).convert("RGB")
    results: dict = {"runs": args.runs, "source_mp": round(source.width * source.height / 1e6, 2),
                     "sizes": {}}
    seed = 0
    with TestClient(app) as client:
        first = one(client, make_image(source, 1_000_000, seed))
        results["first_upload"] = {"report_ms": round(first["report"], 1),
                                   "analyzers": first["analyzers"]}
        for label, pixels in SIZES.items():
            rows = []
            for _ in range(args.runs):
                seed += 1
                data = make_image(source, pixels, seed)
                row = one(client, data)
                row["kb"] = len(data) / 1024
                rows.append(row)
            names = list(rows[0]["analyzers"])
            results["sizes"][label] = {
                "file_kb": round(statistics.mean(r["kb"] for r in rows)),
                "upload_ms": summarize([r["upload"] for r in rows]),
                "report_ms": summarize([r["report"] for r in rows]),
                "analyzer_ms": {n: summarize([r["analyzers"][n] for r in rows]) for n in names},
            }
            print(label, json.dumps(results["sizes"][label]))
    Path(args.out).write_text(json.dumps(results, indent=2))
    print("first upload:", results["first_upload"])
    print("wrote", args.out)


if __name__ == "__main__":
    main()
