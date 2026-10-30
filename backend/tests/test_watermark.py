"""The numpy watermark decoder against fixtures made with the real invisible-watermark library.

Fixtures (tests/fixtures): a 256x256 crop of NASA's public-domain astronaut photo, clean and
watermarked the way Stable Diffusion 1.x scripts (BGR) and diffusers SDXL (RGB) do it.
watermark_library_bits.json holds what the library itself decodes from each file; the library
needs PyTorch, so it is not a test dependency.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app import engine
from app.analyzers.base import MediaInfo, Signal, Strength
from app.analyzers.watermark import MARKS, WatermarkAnalyzer, decode

FIXTURES = Path(__file__).parent / "fixtures"


def media(path: Path) -> MediaInfo:
    with Image.open(path) as img:
        return MediaInfo(path, "image/png", img.width, img.height)


@pytest.mark.parametrize("name", ["clean", "sd1_watermark", "sdxl_watermark"])
def test_decoder_matches_the_library_bit_for_bit(name):
    expected = json.loads((FIXTURES / "watermark_library_bits.json").read_text())[name]
    rgb = np.asarray(Image.open(FIXTURES / f"{name}.png").convert("RGB"))
    for order, arr in (("bgr", rgb[..., ::-1]), ("rgb", rgb)):
        for length in (136, 48):
            got = "".join(map(str, decode(arr, length)))
            assert got == expected[f"{order}_{length}"], f"{order} {length}"


@pytest.mark.parametrize("name, generator", [
    ("sd1_watermark", "Stable Diffusion 1.x/2.x"),
    ("sdxl_watermark", "Stable Diffusion XL"),
])
def test_finds_generator_watermarks(name, generator):
    result = WatermarkAnalyzer().run(media(FIXTURES / f"{name}.png"))
    [finding] = result.findings
    assert finding.code == "watermark.generator"
    assert (finding.signal, finding.strength) == (Signal.ai, Strength.strong)
    assert generator in finding.message
    assert result.raw["found"]["generator"] == generator


def test_a_watermark_alone_makes_the_verdict_likely_ai():
    result = WatermarkAnalyzer().run(media(FIXTURES / "sdxl_watermark.png"))
    assert engine.decide(result.findings).label == "likely_ai_generated"


def test_clean_image_has_no_watermark_and_stays_far_from_the_thresholds():
    result = WatermarkAnalyzer().run(media(FIXTURES / "clean.png"))
    assert [f.code for f in result.findings] == ["watermark.none"]
    for mark in MARKS:
        assert result.raw["marks"][mark.name] < mark.min_match - 15


def test_recompressed_watermark_is_simply_not_found(tmp_path):
    # Heavy JPEG compression destroys the mark; that must read as "none", never as evidence.
    path = tmp_path / "recompressed.jpg"
    Image.open(FIXTURES / "sd1_watermark.png").convert("RGB").save(path, quality=60)
    result = WatermarkAnalyzer().run(MediaInfo(path, "image/jpeg", 256, 256))
    assert [f.code for f in result.findings] == ["watermark.none"]


def test_small_images_are_skipped(tmp_path):
    path = tmp_path / "small.png"
    Image.new("RGB", (200, 200), "gray").save(path)
    result = WatermarkAnalyzer().run(MediaInfo(path, "image/png", 200, 200))
    assert [f.code for f in result.findings] == ["watermark.too_small"]
    assert result.raw["checked"] is False


def test_decoding_in_strips_matches_one_pass(monkeypatch):
    # Big photos are decoded 64 rows at a time to save memory; the bits must not change.
    from app.analyzers import watermark

    rgb = np.random.default_rng(7).integers(0, 256, (1000, 600, 3), dtype=np.uint8)
    strips = watermark._block_bits(watermark._array_strips(rgb))
    from_image = watermark._block_bits(watermark._image_strips(Image.fromarray(rgb), bgr=False))
    monkeypatch.setattr(watermark, "STRIP", 10_000)
    one_pass = watermark._block_bits(watermark._array_strips(rgb))
    assert np.array_equal(strips, one_pass) and np.array_equal(from_image, one_pass)
