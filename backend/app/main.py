import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.api.routes import router
from app.config import get_settings
from app.worker import Worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    worker = Worker() if settings.run_worker else None
    if worker:
        worker.start()
    app.state.worker = worker
    yield
    if worker:
        worker.stop()


app = FastAPI(
    title="MetaProof API",
    description=(
        "Evidence-based authenticity analysis for images. Each upload is checked for "
        "metadata traces, C2PA Content Credentials and (soon) watermarks and AI-generation "
        "artifacts, then given one explainable verdict: likely authentic, edited, likely "
        "AI-generated or inconclusive.\n\n"
        "**Typical flow:** `POST /api/analyses` → poll `GET /api/analyses/{job_id}` → share "
        "`/api/media/{sha256}/report`.\n\n"
        "Source: [github.com/1anc6/metaproof](https://github.com/1anc6/metaproof)"
    ),
    version="0.1.0",
    openapi_tags=[
        {"name": "Analyses", "description": "Upload images and follow their analysis."},
        {"name": "Reports", "description": "Finished reports, addressed by file hash."},
        {"name": "System", "description": "Service status."},
    ],
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # The API has no home page; send visitors to the interactive docs.
    return RedirectResponse("/docs")
