import hashlib
import io

import pytest

from app.ingest import UploadRejected, ingest
from tests.helpers import jpeg_bytes, png_bytes

MB = 1024 * 1024


def test_jpeg_is_hashed_and_measured(tmp_path):
    data = jpeg_bytes()
    result = ingest(io.BytesIO(data), tmp_path, 5 * MB, 10_000_000)

    assert result.sha256 == hashlib.sha256(data).hexdigest()
    assert result.mime_type == "image/jpeg"
    assert (result.width, result.height) == (64, 48)
    assert result.path.suffix == ".jpg" and result.path.exists()
    assert result.thumbnail[:4] == b"RIFF"  # WebP container


def test_type_comes_from_magic_bytes_not_extension(tmp_path):
    result = ingest(io.BytesIO(png_bytes()), tmp_path, 5 * MB, 10_000_000)
    assert result.mime_type == "image/png"


@pytest.mark.parametrize("payload", [b"", b"not an image at all", b"%PDF-1.7 fake pdf"])
def test_rejects_non_images(tmp_path, payload):
    with pytest.raises(UploadRejected):
        ingest(io.BytesIO(payload), tmp_path, 5 * MB, 10_000_000)
    assert list(tmp_path.iterdir()) == []  # temp file cleaned up


def test_rejects_oversized_upload(tmp_path):
    with pytest.raises(UploadRejected, match="larger than"):
        ingest(io.BytesIO(b"\xff" * (MB + 1)), tmp_path, MB, 10_000_000)
    assert list(tmp_path.iterdir()) == []


# 64x48 = 3072 pixels: just over the limit, and more than twice it, where Pillow itself refuses.
@pytest.mark.parametrize("max_pixels", [2000, 1000])
def test_rejects_too_many_pixels(tmp_path, max_pixels):
    with pytest.raises(UploadRejected, match=r"larger than 0\.00[12] MP"):
        ingest(io.BytesIO(jpeg_bytes()), tmp_path, 5 * MB, max_pixels=max_pixels)
    assert list(tmp_path.iterdir()) == []


def test_rejects_truncated_image(tmp_path):
    data = jpeg_bytes()[:200]
    with pytest.raises(UploadRejected):
        ingest(io.BytesIO(data), tmp_path, 5 * MB, 10_000_000)
