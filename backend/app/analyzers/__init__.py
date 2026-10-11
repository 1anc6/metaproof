from app.analyzers.base import Analyzer
from app.analyzers.c2pa_check import C2paAnalyzer
from app.analyzers.detector import DetectorAnalyzer
from app.analyzers.metadata import MetadataAnalyzer
from app.analyzers.watermark import WatermarkAnalyzer
from app.config import get_settings

# Order is the order they run in and appear in the report.
ANALYZERS: list[Analyzer] = [
    MetadataAnalyzer(),
    C2paAnalyzer(),
    WatermarkAnalyzer(),
    DetectorAnalyzer(get_settings().detector_model_path),
]
