from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.analyzers.base import MediaInfo, Signal, Strength
from app.analyzers.detector import DetectorAnalyzer, findings_for, preprocess, trim_borders


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
    (0.91, Signal.ai, Strength.strong),
    (0.90, Signal.ai, Strength.weak),
    (0.79, Signal.ai, Strength.weak),
    (0.78, Signal.neutral, Strength.weak),
    (0.40, Signal.neutral, Strength.weak),
    (0.06, Signal.neutral, Strength.weak),
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


def _photo(w: int, h: int) -> Image.Image:
    """Smooth colour waves plus sensor-like noise: no flat rows or columns anywhere."""
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.stack([128 + 60 * np.sin(xx / 80), 100 + 50 * np.cos(yy / 60),
                     90 + 40 * np.sin((xx + yy) / 120)], -1)
    return Image.fromarray(np.clip(base + rng.normal(0, 12, base.shape), 0, 255).astype(np.uint8))


def test_trim_removes_caption_band_with_text():
    photo = _photo(800, 600)
    canvas = Image.new("RGB", (800, 720), (255, 255, 255))
    canvas.paste(photo, (0, 120))
    draw = ImageDraw.Draw(canvas)
    for x0 in (80, 280, 480):  # caption text blocks inside the band
        draw.rectangle((x0, 40, x0 + 160, 80), fill=(20, 20, 20))
    out, trimmed = trim_borders(canvas)
    assert 110 <= trimmed["top"] <= 120
    assert trimmed["bottom"] == trimmed["left"] == trimmed["right"] == 0
    assert out.size == (800, 720 - trimmed["top"])


def test_trim_removes_dark_app_bars():
    canvas = Image.new("RGB", (1080, 1500), (18, 18, 18))
    canvas.paste(_photo(1080, 1080), (0, 220))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((40, 60, 600, 120), fill=(60, 60, 60))
    draw.rectangle((40, 1340, 900, 1380), fill=(60, 60, 60))
    _, trimmed = trim_borders(canvas)
    assert 205 <= trimmed["top"] <= 220 and 185 <= trimmed["bottom"] <= 200


def test_trim_leaves_photos_and_plain_images_alone():
    photo = _photo(640, 480)
    out, trimmed = trim_borders(photo)
    assert out.size == photo.size and not any(trimmed.values())
    for colour in [(255, 255, 255), (0, 0, 0), (120, 160, 200)]:
        plain = Image.new("RGB", (500, 300), colour)
        out, trimmed = trim_borders(plain)
        assert out.size == (500, 300) and not any(trimmed.values())


def test_trim_keeps_plain_image_with_small_subject():
    # Mostly white, like a product shot: the background is over half of each side, so the
    # image is treated as plain and nothing is cut.
    img = Image.new("RGB", (600, 600), (250, 250, 250))
    img.paste(_photo(200, 200), (200, 200))
    out, trimmed = trim_borders(img)
    assert out.size == (600, 600) and not any(trimmed.values())


def test_trim_keeps_margin_without_text():
    # A plain margin with no caption looks the same as a studio or night background, so it
    # stays: cutting those changed scores on unedited images.
    canvas = Image.new("RGB", (800, 720), (255, 255, 255))
    canvas.paste(_photo(800, 600), (0, 120))
    out, trimmed = trim_borders(canvas)
    assert out.size == canvas.size and not any(trimmed.values())
