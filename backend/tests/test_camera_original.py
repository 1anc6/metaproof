"""The camera-original signal: camera traces that editors and naive EXIF copying tend to break."""

import io
from pathlib import Path

import numpy as np
from PIL import Image

from app import engine
from app.analyzers.base import MediaInfo
from app.analyzers.metadata import MetadataAnalyzer
from tests.helpers import camera_exif

CAPTURED = "2024:05:01 10:00:00"


def scene(w: int = 640, h: int = 480, shift: int = 0) -> Image.Image:
    """A smooth, photo-like picture: gradients and soft shapes."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    x = (x + shift) % w
    r = 120 + 80 * np.sin(x / 90) + 40 * np.cos(y / 70)
    g = 110 + 60 * np.cos((x + y) / 120)
    b = 140 + 70 * np.sin(y / 60) * np.cos(x / 150)
    return Image.fromarray(np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8))


def preview(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.resize((160, 120)).save(buf, "JPEG", quality=85)
    return buf.getvalue()


def analyze(tmp_path: Path, img: Image.Image, exif: bytes):
    path = tmp_path / "photo.jpg"
    img.save(path, quality=92, exif=exif)
    result = MetadataAnalyzer().run(MediaInfo(path, "image/jpeg", *img.size))
    return {f.code for f in result.findings}, result.raw["fields"]


def test_untouched_camera_file_counts_as_camera_original(tmp_path):
    img = scene()
    codes, fields = analyze(tmp_path, img, camera_exif("Canon", "EOS R6", CAPTURED, img.size, preview(img)))
    assert {"meta.camera_capture", "meta.camera_original"} <= codes
    assert fields["has_makernote"] and fields["exif_size_matches"]
    assert fields["thumbnail_similarity"] > 0.95


def test_exif_copied_onto_another_picture_does_not(tmp_path):
    original = scene()
    exif = camera_exif("Canon", "EOS R6", CAPTURED, original.size, preview(original))
    codes, fields = analyze(tmp_path, scene(shift=250).transpose(Image.FLIP_TOP_BOTTOM), exif)
    assert "meta.camera_capture" in codes  # the tags alone still look like a camera...
    assert "meta.camera_original" not in codes  # ...but the preview shows another picture
    assert fields["thumbnail_similarity"] < 0.9


def test_cropped_photo_with_kept_exif_does_not(tmp_path):
    original = scene()
    exif = camera_exif("Canon", "EOS R6", CAPTURED, original.size, preview(original))
    codes, fields = analyze(tmp_path, original.crop((80, 60, 560, 420)), exif)
    assert "meta.camera_original" not in codes
    assert fields["exif_size_matches"] is False


def test_editor_tag_or_missing_maker_data_withholds_it(tmp_path):
    img = scene()
    edited = camera_exif("Canon", "EOS R6", CAPTURED, img.size, preview(img), software="GIMP 2.10")
    assert "meta.camera_original" not in analyze(tmp_path, img, edited)[0]
    no_makernote = camera_exif("Canon", "EOS R6", CAPTURED, img.size, preview(img), makernote=False)
    assert "meta.camera_original" not in analyze(tmp_path, img, no_makernote)[0]
    no_preview = camera_exif("Canon", "EOS R6", CAPTURED, img.size, None)
    codes, fields = analyze(tmp_path, img, no_preview)
    assert "meta.camera_original" not in codes and fields["thumbnail_similarity"] is None


def test_camera_original_alone_never_claims_authentic(tmp_path):
    # Weak on purpose: the phone's own editor keeps these traces, so it cannot prove "unedited".
    img = scene()
    result = MetadataAnalyzer()
    path = tmp_path / "photo.jpg"
    img.save(path, quality=92, exif=camera_exif("Canon", "EOS R6", CAPTURED, img.size, preview(img)))
    findings = result.run(MediaInfo(path, "image/jpeg", *img.size)).findings
    decision = engine.decide(findings)
    assert decision.label == "inconclusive"
    assert decision.scores["authentic"] == 1.0  # camera tags + camera original, both weak


def test_broken_preview_is_ignored(tmp_path):
    img = scene()
    exif = camera_exif("Canon", "EOS R6", CAPTURED, img.size, b"\xff\xd8not a jpeg")
    codes, fields = analyze(tmp_path, img, exif)
    assert fields["thumbnail_similarity"] is None
    assert "meta.camera_capture" in codes and "meta.camera_original" not in codes
