import uuid
from datetime import datetime

from pydantic import BaseModel


class JobCreated(BaseModel):
    job_id: uuid.UUID
    sha256: str
    status: str
    duplicate: bool  # True when this exact file was already analyzed by the current pipeline


class FindingOut(BaseModel):
    code: str
    signal: str
    strength: str
    message: str


class AnalyzerOut(BaseModel):
    analyzer: str
    version: str
    ok: bool
    duration_ms: int
    error: str | None
    findings: list[FindingOut]
    raw: dict


class VerdictOut(BaseModel):
    label: str
    confidence: float | None
    engine_version: str
    scores: dict[str, float]
    top_reasons: list[FindingOut]


class MediaOut(BaseModel):
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    first_seen_at: datetime


class JobSummary(BaseModel):
    """Light row for history lists: no findings or raw analyzer output."""

    job_id: uuid.UUID
    status: str
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    label: str | None
    confidence: float | None
    created_at: datetime
    finished_at: datetime | None


class SimilarMedia(BaseModel):
    sha256: str
    similarity: float
    label: str | None
    first_seen_at: datetime


class JobOut(BaseModel):
    job_id: uuid.UUID
    status: str
    error: str | None
    pipeline_version: str
    created_at: datetime
    finished_at: datetime | None
    media: MediaOut
    verdict: VerdictOut | None
    analyzers: list[AnalyzerOut]
