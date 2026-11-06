from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.analyzers.base import MediaInfo, Signal, Strength
from app.analyzers.detector import (
    STABILITY_COPIES,
    STABILITY_WORK_SIDE,
    DetectorAnalyzer,
    findings_for,
    prepare,
    preprocess,
    trim_borders,
    working_copy,
)


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


def test_worker_unloads_the_model_when_idle(monkeypatch, tmp_path: Path):
    from app import worker

    detector = DetectorAnalyzer(tmp_path / "detector.onnx")
    detector._session = object()  # stands in for a loaded ONNX session
    monkeypatch.setattr(worker, "ANALYZERS", [detector])
    monkeypatch.setattr(worker, "MODEL_IDLE_S", 0.01)
    w = worker.Worker()

    w._wake.set()  # an upload arrives in time: the model stays
    assert w._wait_for_work() and detector.loaded
    w._wake.clear()  # nothing arrives: the model is freed
    assert not w._wait_for_work() and not detector.loaded


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


@pytest.mark.parametrize("captioned", [False, True], ids=["margin", "captioned"])
@pytest.mark.parametrize("mode, fmt", [("RGB", None), ("RGBA", None), ("L", None), ("P", None),
                                       ("RGB", "JPEG"), ("L", "JPEG"), ("RGBA", "PNG"),
                                       ("P", "PNG")])
def test_prepare_matches_converting_to_rgb_first(tmp_path, captioned, mode, fmt):
    # trim_borders and standardize skip convert("RGB") on RGB images to save a full-size copy.
    # The thresholds were calibrated on converting first, so every value must stay the same,
    # for images in memory and for files opened lazily, the way the analyzer opens uploads.
    img = Image.new("RGB", (800, 720), (255, 255, 255))
    img.paste(_photo(800, 600), (0, 120))
    if captioned:  # text in the band, so the border is cut and the crop path runs
        draw = ImageDraw.Draw(img)
        for x0 in (80, 280, 480):
            draw.rectangle((x0, 40, x0 + 160, 80), fill=(20, 20, 20))
    img = img.convert(mode)
    if fmt is None:
        got, want = prepare(img), prepare(img.convert("RGB"))
    else:
        path = tmp_path / f"upload.{fmt.lower()}"
        img.save(path, fmt)
        with Image.open(path) as a, Image.open(path) as b:
            got, want = prepare(a), prepare(b.convert("RGB"))
    assert np.array_equal(got[0], want[0]) and got[1] == want[1]


# --- stability check -----------------------------------------------------------------------

class FakeSession:
    """Stands in for the ONNX session: returns the given scores in order, one per run."""

    def __init__(self, scores: list[float]):
        self.scores = list(scores)
        self.shapes: list[tuple] = []

    def run(self, _outputs, feeds):
        self.shapes.append(feeds["pixels"].shape)
        return [np.array([self.scores.pop(0)], dtype=np.float32), np.zeros((1, 512), np.float32)]


def _analyzer(tmp_path: Path, scores: list[float]) -> tuple[DetectorAnalyzer, FakeSession, MediaInfo]:
    model = tmp_path / "detector.onnx"
    model.write_bytes(b"")
    detector = DetectorAnalyzer(model)
    detector._session = session = FakeSession(scores)
    path = tmp_path / "photo.jpg"
    _photo(3000, 2000).save(path, quality=92)
    return detector, session, MediaInfo(path, "image/jpeg", 3000, 2000)


def test_unflagged_image_is_scored_once(tmp_path: Path):
    detector, session, media = _analyzer(tmp_path, [0.5])
    result = detector.run(media)
    assert len(session.shapes) == 1 and "stability" not in result.raw
    assert result.findings[0].code == "detector.uncertain"


def test_flagged_image_is_scored_on_every_copy(tmp_path: Path):
    copies = [0.95, 0.33, 0.41, 0.9, 0.9, 0.9, 0.9][: len(STABILITY_COPIES)]
    copies[-1] = 0.33  # the lowest copy, whichever copies ship
    detector, session, media = _analyzer(tmp_path, [0.96, *copies])
    result = detector.run(media)
    assert len(session.shapes) == 1 + len(STABILITY_COPIES)
    assert all(s == (1, 3, 224, 224) for s in session.shapes)
    assert result.raw["p_ai"] == 0.96
    assert result.raw["stability"] == {"copies": dict(zip(STABILITY_COPIES, copies)), "lowest": 0.33}
    assert result.findings[0].code == "detector.unstable"
    assert result.findings[0].signal == Signal.neutral


@pytest.mark.parametrize("p, low, code, signal, strength", [
    (0.96, 0.93, "detector.ai_pixels", Signal.ai, Strength.strong),  # holds
    (0.96, 0.85, "detector.ai_pixels", Signal.ai, Strength.weak),    # strong -> weak
    (0.85, 0.80, "detector.ai_pixels", Signal.ai, Strength.weak),    # holds at weak
    (0.96, 0.33, "detector.unstable", Signal.neutral, Strength.weak),
    (0.85, 0.60, "detector.unstable", Signal.neutral, Strength.weak),
])
def test_flag_counts_only_as_far_as_its_lowest_copy(p, low, code, signal, strength):
    name = next(iter(STABILITY_COPIES))
    (finding,) = findings_for(p, {name: low})
    assert (finding.code, finding.signal, finding.strength) == (code, signal, strength)
    assert f"{round(p * 100)}%" in finding.message and f"{round(low * 100)}%" in finding.message


def test_a_copy_scoring_higher_never_raises_the_evidence():
    (finding,) = findings_for(0.85, {name: 0.99 for name in STABILITY_COPIES})
    assert finding.strength == Strength.weak


def test_working_copy_is_small_and_outlives_the_file(tmp_path: Path):
    path = tmp_path / "big.png"
    _photo(5000, 1000).convert("L").save(path)
    with Image.open(path) as img:
        work = working_copy(img)
    assert work.size == (STABILITY_WORK_SIDE, round(1000 * STABILITY_WORK_SIDE / 5000))
    assert work.mode == "RGB"
    for _, make in STABILITY_COPIES.values():
        assert preprocess(make(work)).shape == (1, 3, 224, 224)
