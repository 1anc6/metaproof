"""Initial schema: media, job queue, analyzer runs, findings, verdicts.

Revision ID: 0001
Revises:
Create Date: 2026-10-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("mime_type", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("thumbnail", sa.LargeBinary, nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )

    job_status = postgresql.ENUM("queued", "running", "done", "failed", name="job_status")
    op.create_table(
        "analysis_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("media_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", job_status, nullable=False),
        sa.Column("pipeline_version", sa.String(32), nullable=False),
        sa.Column("original_filename", sa.String(255)),
        sa.Column("temp_path", sa.Text),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
    )
    # Serves the queue's claim query: oldest queued job first.
    op.create_index("ix_jobs_status_created", "analysis_jobs", ["status", "created_at"])
    op.create_index("ix_jobs_media", "analysis_jobs", ["media_id"])

    op.create_table(
        "analyzer_runs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("analyzer", sa.String(32), nullable=False),
        sa.Column("analyzer_version", sa.String(32), nullable=False),
        sa.Column("ok", sa.Boolean, nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column("raw_output", postgresql.JSONB, nullable=False),
        sa.Column("error", sa.Text),
    )
    op.create_index("ix_analyzer_runs_job_id", "analyzer_runs", ["job_id"])

    op.create_table(
        "findings",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.BigInteger,
                  sa.ForeignKey("analyzer_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("signal", sa.String(16), nullable=False),
        sa.Column("strength", sa.String(16), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
    )
    op.create_index("ix_findings_run_id", "findings", ["run_id"])
    op.create_index("ix_findings_code", "findings", ["code"])

    op.create_table(
        "verdicts",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False,
                  unique=True),
        sa.Column("label", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float),
        sa.Column("engine_version", sa.String(32), nullable=False),
        sa.Column("scores", postgresql.JSONB, nullable=False),
        sa.Column("top_reasons", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    )
    op.create_index("ix_verdicts_label", "verdicts", ["label"])


def downgrade() -> None:
    op.drop_table("verdicts")
    op.drop_table("findings")
    op.drop_table("analyzer_runs")
    op.drop_table("analysis_jobs")
    op.drop_table("media_files")
    postgresql.ENUM(name="job_status").drop(op.get_bind(), checkfirst=True)
