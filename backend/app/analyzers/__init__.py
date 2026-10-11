from app.analyzers.base import Analyzer
from app.analyzers.c2pa_check import C2paAnalyzer
from app.analyzers.metadata import MetadataAnalyzer

# Order is the order they run in and appear in the report.
ANALYZERS: list[Analyzer] = [MetadataAnalyzer(), C2paAnalyzer()]
