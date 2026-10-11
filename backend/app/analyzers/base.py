"""Shared types for analyzers. Each analyzer turns a file into raw output plus typed findings."""

import enum
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


class Signal(str, enum.Enum):
    """Which verdict a finding points towards."""

    authentic = "authentic"
    edited = "edited"
    ai = "ai"
    neutral = "neutral"


class Strength(str, enum.Enum):
    weak = "weak"
    moderate = "moderate"
    strong = "strong"
    conclusive = "conclusive"  # signed or embedded proof, e.g. a C2PA AI-generation assertion


@dataclass(frozen=True)
class Finding:
    code: str
    signal: Signal
    strength: Strength
    message: str


@dataclass
class AnalyzerResult:
    raw: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)


@dataclass(frozen=True)
class MediaInfo:
    path: Path
    mime_type: str
    width: int
    height: int


class Analyzer(Protocol):
    name: str
    version: str

    def run(self, media: MediaInfo) -> AnalyzerResult: ...
