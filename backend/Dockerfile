# MetaProof API image. Built and run by Render (free web service, 512 MB RAM).
FROM python:3.12-slim

# ExifTool gives the metadata analyzer a full tag dump.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# Never run the API as root.
RUN useradd --create-home --uid 1000 app
WORKDIR /home/app/backend

COPY --chown=app pyproject.toml ./
COPY --chown=app app ./app
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
