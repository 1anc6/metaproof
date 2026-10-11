# MetaProof API image, built and run by Hugging Face Spaces (Docker SDK).
FROM python:3.12-slim

# ExifTool gives the metadata analyzer a full tag dump.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# Spaces run containers as user 1000; never run the API as root.
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

# Spaces route traffic to port 7860. Migrations run first so a deploy brings the schema
# up to date; Alembic does nothing when there is nothing new.
EXPOSE 7860
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 7860 --proxy-headers --forwarded-allow-ips='*'"]
