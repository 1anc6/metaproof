# MetaProof

[![Backend](https://github.com/1anc6/metaproof/actions/workflows/backend.yml/badge.svg)](https://github.com/1anc6/metaproof/actions/workflows/backend.yml)
[![Frontend](https://github.com/1anc6/metaproof/actions/workflows/frontend.yml/badge.svg)](https://github.com/1anc6/metaproof/actions/workflows/frontend.yml)

**Evidence-based authenticity analysis for images.** Upload an image and MetaProof checks its
metadata, its C2PA Content Credentials and its pixels, then combines the evidence into one
explainable verdict: *likely authentic*, *edited*, *likely AI-generated* or *inconclusive*.

**Live app:** [metaproof.vercel.app](https://metaproof.vercel.app) ·
**API docs:** [metaproof.onrender.com/docs](https://metaproof.onrender.com/docs) ·
**Model:** [huggingface.co/1anc6/metaproof-detector](https://huggingface.co/1anc6/metaproof-detector)

> MetaProof does not claim absolute truth. Every verdict lists the evidence behind it, and the
> system answers "inconclusive" rather than guess.

![MetaProof demo: overview, upload, live analysis steps, report and detector accuracy](docs/images/demo.gif)

<details>
<summary>More screenshots</summary>

**Report:** verdict, checks completed, detector score and key findings

![Report page](docs/images/report.jpg)

**Detector accuracy:** detection rate per unseen generator, the newest generators it still
misses, and how the score is used in a verdict

![Detector accuracy](docs/images/detector-results.jpg)

**Mobile:** overview and report, with a floating tab bar

![Mobile screens](docs/images/mobile.jpg)

</details>

<sub>Captured from the live app. The sample image is a FLUX dev output ("a pair of roller
skates") from the Community Forensics evaluation set (CC BY-NC-SA 4.0), which the detector
never saw during training.</sub>

## Highlights

- **AI-image detector that generalizes:** CLIP ViT-B/16 features plus a calibrated classifier,
  trained on 30 generators up to 2025 and tested on **9 generators never seen in training**
  (FLUX, Midjourney 6.1, DALL·E 3, Firefly 3, Imagen 3, …): **AUC 0.972**, 0.967 after
  social-media recompression. Honest about its gap: the newest models (GPT Image 2, Nano
  Banana 2) are mostly missed.
  [Method and results →](ml/README.md)
- **Signed provenance:** validates C2PA Content Credentials with the official SDK.
- **Invisible watermarks:** reads the marks Stable Diffusion 1.x/2.x and SDXL hide in their
  output, with a numpy port of the open-source decoder that matches it bit for bit.
- **"Seen before" search:** CLIP embeddings in Postgres with a pgvector HNSW index find
  resized or recompressed copies that a file hash misses, in under 1 ms at 30K images.
  [Benchmarks →](docs/benchmarks.md)
- **Postgres is the job queue:** `FOR UPDATE SKIP LOCKED`, tested with concurrent workers;
  no Redis.
- **Privacy by design:** uploads are deleted after analysis; only a hash, a thumbnail and the
  findings are kept, for 1 day after the image was last analyzed. GPS coordinates are never
  stored.
- **Installable, with share-to-analyze:** a web app manifest and a small service worker put
  MetaProof in Android's share menu, so a photo can be sent straight from the gallery.
- **Runs on free tiers:** Vercel + Render + Neon + Hugging Face Hub, with CI on GitHub Actions.

## Architecture

```mermaid
flowchart LR
    U[Browser] -->|upload| W[React app<br/>Vercel]
    W -->|HTTPS| A[FastAPI<br/>Render, Docker]
    A -->|stream, hash, validate| T[(temp file)]
    A -->|enqueue| Q[(Postgres job queue<br/>Neon)]
    Q -->|SKIP LOCKED| K[worker]
    K --> M[Metadata<br/>EXIF / XMP / ExifTool]
    K --> C[C2PA<br/>Content Credentials]
    K --> D[AI detector<br/>CLIP + MLP, ONNX]
    M & C & D --> E[Evidence engine]
    E -->|verdict, findings| DB[(Neon Postgres<br/>+ pgvector)]
    D -->|embedding| DB
    HF[(Hugging Face Hub<br/>model weights)] -.->|build time| A
```

1. The API streams the upload to a private temp file, computing SHA-256 on the way, checks the
   real file type from its bytes and decodes it once under size and pixel limits. A file seen
   before returns its existing report.
2. A job row is queued in Postgres; the worker claims it with `FOR UPDATE SKIP LOCKED` and is
   woken by new uploads instead of polling, so the serverless database can sleep.
3. Each analyzer turns the file into typed findings (`signal`, `strength`, `message`).
4. The evidence engine weighs them: signed proof decides on its own, missing data is neutral,
   and a verdict needs enough weight and a clear lead, otherwise it is **inconclusive**.
5. The file is deleted; the report is shareable at `/report/<sha256>`.

## The detector, in short

| Unseen generator | Detected | | Unseen generator | Detected |
| --- | --- | --- | --- | --- |
| Stable Cascade | 98% | | Imagen 3 | 92% |
| Firefly Image 3 | 97% | | FLUX schnell | 89% |
| DALL·E 3 | 96% | | Ideogram 2 | 86% |
| Midjourney 6.1 | 94% | | SDXL-LCM | 85% |
| FLUX dev | 92% | | **AUC (all)** | **0.972** |

Detector v3 adds 18 generators from 2025 (Imagen 4, GPT-4o image, Seedream, Recraft, …).
About 9% of real images score above 0.5, so the score only decides a verdict on its own at
≥ 0.91, where 70% of AI images and 1.3% of real images land (v1: 60% and 1.8% at 0.95).
The newest generators (2026), tested on an independent benchmark, are still mostly missed:
21–38% of FLUX.2, Qwen Image 2.1, Nano Banana 2 and GPT Image 2 images score above 0.5.
Every image is resized and re-encoded as JPEG before the model sees it, so file format can't
give the answer away. Full details, including why the 8-bit weight-only export was chosen
over int8, are in [`ml/README.md`](ml/README.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| API | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Database | PostgreSQL (Neon) with pgvector; Postgres-backed job queue |
| Provenance | `c2pa-python` (official C2PA SDK) |
| Metadata | Pillow, ExifTool |
| ML | PyTorch + open_clip (training on an RTX 4050), ONNX Runtime (serving) |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Infrastructure | Docker, Render, Vercel, Hugging Face Hub, GitHub Actions |

## Run locally

Requirements: Python 3.11+, Node 20+, a Postgres database ([Neon](https://neon.tech) free tier
works). Optional: [ExifTool](https://exiftool.org).

Backend dependencies are pinned in `backend/uv.lock`; CI and the Docker image install exactly
those versions, and Dependabot proposes updates weekly. After editing `pyproject.toml`'s
dependencies, run `uv lock` and commit the lockfile (CI fails if it is out of date).

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install uv && uv sync --extra dev --inexact     # the locked versions
cp .env.example .env                                # paste your database URL
alembic upgrade head
# optional: the detector model (121 MB)
curl -L -o models/detector.onnx https://huggingface.co/1anc6/metaproof-detector/resolve/main/detector.onnx
uvicorn app.main:app --reload                       # http://localhost:8000/docs
```

```bash
cd frontend
npm install
npm run dev                                         # http://localhost:5173
```

Tests (integration tests need a throwaway Postgres with pgvector):

```bash
docker run -d -p 54329:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=metaproof_test pgvector/pgvector:pg17
TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/metaproof_test pytest
```

Browser tests for the frontend (Playwright against the production build, API faked):

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyses` | Upload an image (multipart `file`); returns a job id. 429 when rate-limited |
| `GET` | `/api/analyses/{job_id}` | Job status, verdict, findings per analyzer |
| `GET` | `/api/analyses?ids=…` | Summaries for a list of jobs (browser history) |
| `GET` | `/api/media/{sha256}/report` | Shareable latest report for a file |
| `GET` | `/api/media/{sha256}/similar` | Near-duplicates analyzed before |
| `GET` | `/api/media/{sha256}/thumbnail` | Small WebP preview |
| `GET` | `/api/status` | Database size against the plan limit and the last day's analyses and failures (cached 10 s); the API's memory against the instance's, and whether the detector model is loaded |

## Repository layout

```
backend/    FastAPI app, analyzers, evidence engine, worker, migrations, tests, benchmarks
frontend/   React web app (Vite, Tailwind, liquid-glass UI)
ml/         dataset sampling, feature extraction, training, calibration, ONNX export
docs/       benchmarks
```

## License

Code: MIT. Detector weights: CC BY-NC-SA 4.0 (derived from the Community Forensics dataset),
non-commercial use only.
