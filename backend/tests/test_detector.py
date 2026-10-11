from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.analyzers.base import MediaInfo, Signal, Strength
from app.analyzers.detector import DetectorAnalyzer, findings_for, preprocess


@pytest.mark.parametrize("size", [(1024, 1024), (1920, 1080), (257, 999), (100, 60)])
def test_preprocess_shape_and_normalization(size):
    img = Image.new("RGB", size, (128, 128, 128))
    x = preprocess(img)
    assert x.shape == (1, 3, 224, 224) and x.dtype == np.float32
    assert np.abs(x).max() < 3  # mean/std normalized, not raw 0-255


def test_preprocess_ignores_alpha_and_mode():
    rgba = Image.new("RGBA", (300, 300), (10, 200, 30, 0))
    gray = Image.new("L", (300, 300), 90)
    assert preprocess(rgba).shape == preprocess(gray).shape == (1, 3, 224, 224)


@pytest.mark.parametrize("p, signal, strength", [
    (0.97, Signal.ai, Strength.strong),
    (0.90, Signal.ai, Strength.weak),
    (0.80, Signal.neutral, Strength.weak),
    (0.40, Signal.neutral, Strength.weak),
    (0.03, Signal.authentic, Strength.weak),
])
def test_probability_bands(p, signal, strength):
    (finding,) = findings_for(p)
    assert (finding.signal, finding.strength) == (signal, strength)
    assert f"{round(p * 100)}%" in finding.message


def test_detector_never_claims_conclusive():
    assert findings_for(1.0)[0].strength != Strength.conclusive


def test_missing_model_is_skipped(tmp_path: Path):
    path = tmp_path / "a.jpg"
    Image.new("RGB", (64, 64)).save(path)
    result = DetectorAnalyzer(tmp_path / "missing.onnx").run(MediaInfo(path, "image/jpeg", 64, 64))
    assert result.raw == {"available": False} and result.findings == []
