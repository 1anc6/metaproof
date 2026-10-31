# MetaProof API image. Built and run by Render (free web service, 512 MB RAM).
FROM python:3.12-slim

# ExifTool gives the metadata analyzer a full tag dump.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# Never run the API as root.
RUN useradd --create-home --uid 1000 app
WORKDIR /home/app/backend

# Detector weights live on Hugging Face Hub (too big for git). Downloaded in their own layer
# so code changes don't re-download them. If the download is skipped or fails, the API still
# runs and the detector analyzer reports itself unavailable. Pinned to a Hub revision so the
# model always matches the thresholds in app/analyzers/detector.py (detector v3; ml/export_onnx.py
# prints the revision on upload). v1 was revision 9a5d04b2dba2ab41d97e4ce23d2439b9acd89c81.
ARG DETECTOR_URL=https://huggingface.co/1anc6/metaproof-detector/resolve/a37a3e7f3169089fa42ccb2d8a1a660b4cdceee6/detector.onnx
RUN mkdir -p models && python -c "import os, urllib.request; urllib.request.urlretrieve(os.environ['DETECTOR_URL'], 'models/detector.onnx')"     || echo "detector model not downloaded; continuing without it"

# Environment variables also reach pip's isolated build step, unlike command-line flags.
ENV PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10 PIP_ROOT_USER_ACTION=ignore
# Dependencies come from uv.lock, exact versions checked against their hashes, so a deploy
# installs what CI tested and never whatever was released that morning. Their own layer, so
# code changes don't reinstall them.
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv
COPY --chown=app pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project --no-header -o /tmp/requirements.txt \
    && pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt
COPY --chown=app app ./app
RUN pip install --no-cache-dir --no-deps .

COPY --chown=app alembic.ini ./
COPY --chown=app migrations ./migrations

USER app
# By default glibc gives each thread that allocates its own memory pool and keeps what is freed
# there, so uploads and the worker would hold several images' worth between them. Two pools
# keep that in check. glibc also raises its mmap threshold to the size of each big block it
# frees, so after the first upload Pillow's 16 MB image blocks come from the pools and stay
# there (two 30 MP RGBA PNGs in a row peaked at 745 MB). A fixed 8 MB keeps image buffers on
# mmap, returned to the OS as soon as they are freed, and numpy's smaller temporaries in the
# pools, where reusing them is fast. app/memory.py hands back the rest after each analyzer.
ENV PYTHONUNBUFFERED=1 \
    TEMP_DIR=/tmp/metaproof \
    MALLOC_ARENA_MAX=2 \
    MALLOC_MMAP_THRESHOLD_=8388608

# Render passes the port in $PORT. Migrations run first so a deploy brings the schema up
# to date; Alembic does nothing when there is nothing new. One uvicorn process keeps memory
# low, and the analysis worker runs as a thread inside it.
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
