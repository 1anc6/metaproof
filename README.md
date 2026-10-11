# MetaProof

**Evidence-based authenticity analysis for images.** Upload an image and MetaProof checks
its metadata, its C2PA Content Credentials, invisible watermarks and its pixels, then
combines them into one explainable verdict: *likely authentic*, *edited*,
*likely AI-generated* or *inconclusive*.

> MetaProof does not claim absolute truth. Every verdict lists the evidence behind it, and
> the system says "inconclusive" rather than guess.

🚧 **Status:** in development (week 1 of 4).
**Live app:** [metaproof.vercel.app](https://metaproof.vercel.app) · **API docs:** [metaproof.onrender.com/docs](https://metaproof.onrender.com/docs) (free tier: the first request after 15 idle minutes takes about a minute to wake the server).

## How it works

```
Upload ─► FastAPI ─► hash + validate ─► Postgres job queue ─► analyzers ─► evidence engine ─► report
                                         (SKIP LOCKED)        │
                                                              ├─ metadata  (EXIF, XMP, PNG text)
                                                              ├─ C2PA      (Content Credentials)
                                                              ├─ watermark (TrustMark)        [week 2]
                                                              └─ AI detector (CLIP + MLP, ONNX) [week 2]
```

Design choices worth noting:

- **No original files are stored.** Uploads are analyzed and deleted; only the hash,
  findings, a small thumbnail and the verdict are kept. GPS coordinates are never stored.
- **Postgres is the queue.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so no Redis is
  needed. The worker wakes on new uploads instead of polling, so Neon can scale to zero.
- **Duplicate files are free.** The SHA-256 is computed while streaming; a known file
  returns its existing report.
- **Absence is not evidence.** Missing metadata or credentials never count against a file.
- **Every result is versioned.** Analyzer, model and engine versions are stored with each
  analysis, so old reports stay reproducible.

## Tech stack

| Layer | Technology |
| --- | --- |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Database | Neon (serverless PostgreSQL) |
| Provenance | `c2pa-python` (official C2PA SDK) |
| Metadata | Pillow, ExifTool (when installed) |
| ML | PyTorch (training, local GPU), ONNX Runtime (serving); weights on Hugging Face Hub |
| Frontend | React, TypeScript, Vite, Tailwind |
| Hosting | Render (API, Docker), Vercel (frontend), GitHub Actions (CI) |

## Run locally

Requirements: Python 3.11+, a [Neon](https://neon.tech) database (free tier).
Optional: [ExifTool](https://exiftool.org) for the full tag dump.

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # then paste your Neon connection string
alembic upgrade head            # create the tables
uvicorn app.main:app --reload   # API docs at http://localhost:8000/docs
```

Run the tests:

```bash
pytest
```

Run the web app (in a second terminal):

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyses` | Upload an image (multipart `file`); returns a job id |
| `GET` | `/api/analyses/{job_id}` | Job status, verdict, findings per analyzer |
| `GET` | `/api/media/{sha256}/report` | Shareable latest report for a file |
| `GET` | `/api/media/{sha256}/thumbnail` | Small WebP preview |

## Repository layout

```
backend/    FastAPI app, analyzers, evidence engine, worker, migrations, tests
frontend/   React web app (Vite, Tailwind, liquid-glass UI)
ml/         detector training and ONNX export       (week 2)
docs/       architecture and benchmark results
```

## License

MIT
