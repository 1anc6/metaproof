"""Relational schema. Every analysis is append-only so old reports stay reproducible."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class MediaFile(Base):
    """One row per unique file content (by SHA-256). The original file is never stored."""

    __tablename__ = "media_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    mime_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    thumbnail: Mapped[bytes] = mapped_column(LargeBinary)  # small WebP, ~10 KB
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    jobs: Mapped[list["AnalysisJob"]] = relationship(back_populates="media")


class AnalysisJob(Base):
    """A unit of work in the Postgres-backed queue (claimed with FOR UPDATE SKIP LOCKED)."""

    __tablename__ = "analysis_jobs"
    __table_args__ = (
        Index("ix_jobs_status_created", "status", "created_at"),
        Index("ix_jobs_media", "media_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"))
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status"), default=JobStatus.queued
    )
    pipeline_version: Mapped[str] = mapped_column(String(32))
    temp_path: Mapped[str | None] = mapped_column(Text)  # cleared once the file is deleted
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    media: Mapped[MediaFile] = relationship(back_populates="jobs")
    runs: Mapped[list["AnalyzerRun"]] = relationship(back_populates="job", order_by="AnalyzerRun.id")
    verdict: Mapped["Verdict | None"] = relationship(back_populates="job")


class AnalyzerRun(Base):
    """One analyzer's execution for one job: raw output, timing and version."""

    __tablename__ = "analyzer_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True
    )
    analyzer: Mapped[str] = mapped_column(String(32))
    analyzer_version: Mapped[str] = mapped_column(String(32))
    ok: Mapped[bool]
    duration_ms: Mapped[int] = mapped_column(Integer)
    raw_output: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text)

    job: Mapped[AnalysisJob] = relationship(back_populates="runs")
    findings: Mapped[list["Finding"]] = relationship(back_populates="run", order_by="Finding.id")


class Finding(Base):
    """A typed, queryable piece of evidence produced by an analyzer."""

    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("analyzer_runs.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(64), index=True)
    signal: Mapped[str] = mapped_column(String(16))  # authentic / edited / ai / neutral
    strength: Mapped[str] = mapped_column(String(16))  # weak / moderate / strong / conclusive
    message: Mapped[str] = mapped_column(Text)

    run: Mapped[AnalyzerRun] = relationship(back_populates="findings")


class Verdict(Base):
    """The evidence engine's decision for a job. Re-analysis creates a new job, never an update."""

    __tablename__ = "verdicts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), unique=True
    )
    label: Mapped[str] = mapped_column(String(32), index=True)
    confidence: Mapped[float | None] = mapped_column(Float)
    engine_version: Mapped[str] = mapped_column(String(32))
    scores: Mapped[dict] = mapped_column(JSONB, default=dict)
    top_reasons: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    job: Mapped[AnalysisJob] = relationship(back_populates="verdict")
