"""Safe upload handling: stream to a private temp file, hash on the fly, enforce limits."""

import hashlib
import io
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import filetype
from PIL import Image

from app.memory import big_image_lock

CHUNK_BYTES = 1024 * 1024
ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/tiff": ".tif",
    "image/heic": ".heic",
}
THUMBNAIL_SIZE = (320, 320)


class UploadRejected(Exception):
    """The upload is invalid; the message is safe to show the user."""


@dataclass(frozen=True)
class IngestedFile:
    path: Path
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    thumbnail: bytes


def ingest(source: BinaryIO, temp_dir: Path, max_bytes: int, max_pixels: int) -> IngestedFile:
    temp_dir.mkdir(parents=True, exist_ok=True)
    # Random name: the user's filename never touches the filesystem (no path traversal).
    path = temp_dir / f"{uuid.uuid4().hex}.upload"
    try:
        sha256, size = _stream_to_disk(source, path, max_bytes)
        mime = _detect_type(path)
        final = path.with_suffix(ALLOWED_TYPES[mime])
        path.rename(final)
        path = final
        width, height, thumb = _decode(path, max_pixels)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return IngestedFile(path, sha256, mime, size, width, height, thumb)


def _stream_to_disk(source: BinaryIO, path: Path, max_bytes: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    # O_EXCL + 0o600: fail if the name exists, readable only by this process's user.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as out:
        while chunk := source.read(CHUNK_BYTES):
            size += len(chunk)
            if size > max_bytes:
                raise UploadRejected(f"File is larger than {max_bytes // (1024 * 1024)} MB.")
            digest.update(chunk)
            out.write(chunk)
    if size == 0:
        raise UploadRejected("File is empty.")
    return digest.hexdigest(), size


def _detect_type(path: Path) -> str:
    # Magic bytes, not the extension or the client's Content-Type header.
    kind = filetype.guess(str(path))
    if kind is None or kind.mime not in ALLOWED_TYPES:
        raise UploadRejected("Unsupported file type. Upload a JPEG, PNG, WebP, TIFF or HEIC image.")
    return kind.mime


def _decode(path: Path, max_pixels: int) -> tuple[int, int, bytes]:
    """Fully decode once, so a broken or hostile file fails here and not inside an analyzer."""
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with big_image_lock, Image.open(path) as img:
            width, height = img.size
            if width * height > max_pixels:
                raise UploadRejected("Image dimensions are too large.")
            img.load()
            # thumbnail() shrinks the image in place, so an RGB one needs no full-size copy.
            thumb = img if img.mode == "RGB" else img.convert("RGB")
            thumb.thumbnail(THUMBNAIL_SIZE)
            buf = io.BytesIO()
            thumb.save(buf, format="WEBP", quality=75)
    except UploadRejected:
        raise
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as exc:
        raise UploadRejected("The image could not be decoded.") from exc
    return width, height, buf.getvalue()
