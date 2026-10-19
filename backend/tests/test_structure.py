import io
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageCms

from app.analyzers.base import MediaInfo, Signal
from app.analyzers.structure import StructureAnalyzer
from app.ingest import ingest
from tests.helpers import png_bytes

FIXTURES = Path(__file__).parent / "fixtures"
MB = 1024 * 1024


def _run(tmp_path: Path, data: bytes, name: str, mime: str):
    path = tmp_path / name
    path.write_bytes(data)
    return StructureAnalyzer().run(MediaInfo(path, mime, 64, 48))


def _photo(**save) -> bytes:
    """A small gradient: flat images can make encoders take shortcuts."""
    img = Image.linear_gradient("L").resize((64, 48)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", **save)
    return buf.getvalue()


def _codes(result) -> set[str]:
    return {f.code for f in result.findings}


def _png_chunk(ctype: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))


def test_pillow_quality_75_is_estimated_as_75(tmp_path):
    result = _run(tmp_path, _photo(quality=75), "a.jpg", "image/jpeg")
    jpeg = result.raw["jpeg"]
    assert jpeg["quality"] == {"estimate": 75, "exact": True, "fit_error": 0.0}
    assert jpeg["coding"] == "baseline" and jpeg["subsampling"] == "4:2:0"
    assert [s["name"] for s in result.raw["segments"]][:2] == ["SOI", "APP0"]
    assert result.raw["trailing_bytes"] == 0
    finding = next(f for f in result.findings if f.code == "structure.jpeg_standard_tables")
    assert finding.signal == Signal.neutral and "quality 75" in finding.message


def test_progressive_444_and_custom_tables(tmp_path):
    # Hand-made tables: not IJG's at any quality, so only a rough estimate.
    table = list(range(2, 66))
    data = _photo(progressive=True, subsampling=0, qtables=[table, table])
    result = _run(tmp_path, data, "a.jpg", "image/jpeg")
    jpeg = result.raw["jpeg"]
    assert jpeg["coding"] == "progressive" and jpeg["subsampling"] == "4:4:4"
    assert jpeg["scans"] > 1
    assert jpeg["quality"]["exact"] is False and jpeg["quality"]["estimate"] is not None
    assert "structure.jpeg_standard_tables" not in _codes(result)


def test_jpeg_with_appended_bytes_shows_trailing_data(tmp_path):
    data = _photo(quality=90) + b"PK\x03\x04" + b"\x00" * 96
    result = _run(tmp_path, data, "a.jpg", "image/jpeg")
    assert result.raw["trailing_bytes"] == 100
    assert result.raw["trailing_signature"] == "ZIP archive"
    finding = next(f for f in result.findings if f.code == "structure.trailing_data")
    assert finding.signal == Signal.neutral and "100 bytes" in finding.message


def test_png_private_chunk_is_listed(tmp_path):
    data = png_bytes()
    iend = data.rindex(b"IEND") - 4
    data = data[:iend] + _png_chunk(b"prIv", b"hello") + data[iend:]
    result = _run(tmp_path, data, "a.png", "image/png")
    names = [s["name"] for s in result.raw["segments"]]
    assert names[0] == "IHDR" and names[-1] == "IEND" and "prIv" in names
    chunk = next(s for s in result.raw["segments"] if s["name"] == "prIv")
    assert chunk["kind"] == "private" and chunk["length"] == 5 + 12
    assert result.raw["private_chunks"] == ["prIv"]
    finding = next(f for f in result.findings if f.code == "structure.png_private_chunks")
    assert finding.signal == Signal.neutral


def test_plain_png_has_no_findings(tmp_path):
    result = _run(tmp_path, png_bytes(), "a.png", "image/png")
    assert result.findings == []
    assert result.raw["trailing_bytes"] == 0 and result.raw["icc"] is None


def test_icc_profile_is_named(tmp_path):
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    result = _run(tmp_path, _photo(quality=80, icc_profile=icc), "a.jpg", "image/jpeg")
    assert result.raw["icc"]["size"] == len(icc)
    assert result.raw["icc"]["color_space"] == "RGB"
    assert "ICC profile" in {s["note"] for s in result.raw["segments"]}


def test_all_findings_are_neutral(tmp_path):
    data = _photo(quality=75) + b"\xff\xd8" + b"\x00" * 30
    result = _run(tmp_path, data, "a.jpg", "image/jpeg")
    assert result.findings and all(f.signal == Signal.neutral for f in result.findings)


def test_heic_is_accepted_and_its_boxes_listed(tmp_path):
    data = (FIXTURES / "small.heic").read_bytes()
    ingested = ingest(io.BytesIO(data), tmp_path / "in", 5 * MB, 10_000_000)
    assert ingested.mime_type == "image/heic" and (ingested.width, ingested.height) == (64, 48)
    result = _run(tmp_path, data, "a.heic", "image/heic")
    assert result.raw["format"] == "heif" and result.raw["brand"] in {"heic", "mif1"}
    assert {"ftyp", "meta", "mdat"} <= {s["name"] for s in result.raw["segments"]}
