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

COPY --chown=app pyproject.toml ./
COPY --chown=app app ./app
# Environment variables also reach pip's isolated build step, unlike command-line flags.
ENV PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10 PIP_ROOT_USER_ACTION=ignore
RUN pip install --no-cache-dir .

COPY --chown=app alembic.ini ./
COPY --chown=app migrations ./migrations

USER app
ENV PYTHONUNBUFFERED=1 \
    TEMP_DIR=/tmp/metaproof

# Render passes the port in $PORT. Migrations run first so a deploy brings the schema up
# to date; Alembic does nothing when there is nothing new. One uvicorn process keeps memory
# low, and the analysis worker runs as a thread inside it.
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
