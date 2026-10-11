"""Invisible watermarks that open-source image generators embed in their output.

Stable Diffusion's reference scripts (1.x/2.x) and the SDXL pipelines (Stability's and
diffusers) hide a fixed message with the `invisible-watermark` library's DWT-DCT method.
That library imports PyTorch, far too heavy for the API's 512 MB instance, so its decoder is
reimplemented here in numpy and checked against the library in tests/test_watermark.py.

The mark survives saving as PNG or high-quality JPEG but usually not resizing or heavy
recompression, so finding none says nothing; finding one is strong evidence.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

STEP = 36  # the library's default quantization scale for the U channel
BLOCK = 4  # block size in the Haar band (8x8 image pixels)
MAX_ROWS = 2048  # bits repeat every few rows; the top of the image is plenty and keeps memory low
MIN_PIXELS = 256 * 256  # the library refuses smaller images


@dataclass(frozen=True)
class Mark:
    name: str
    bits: tuple[int, ...]
    # Unmarked images match about half the bits. These thresholds put a chance match below
    # 1 in a billion (104/136) and 1 in 30 million (43/48) per image, across both channel orders.
    min_match: int


def _bits_of(data: bytes) -> tuple[int, ...]:
    return tuple(int(b) for byte in data for b in f"{byte:08b}")


MARKS = (
    # scripts/txt2img.py in the Stable Diffusion 1.x and 2.x repositories.
    Mark("Stable Diffusion 1.x/2.x", _bits_of(b"StableDiffusionV1"), min_match=104),  # of 136
    # WATERMARK_MESSAGE in Stability's generative-models (SDXL) and diffusers.
    Mark("Stable Diffusion XL",
         tuple(int(b) for b in bin(0b101100111110110010010000011110111011000110011110)[2:]),
         min_match=43),  # of 48
)


HAAR = 0.7071067811865476  # pywt's Haar filter tap, 1/sqrt(2)
STRIP = 256  # image rows per pass; a multiple of 8 keeps the block grid aligned


def _u_channel(bgr: np.ndarray) -> np.ndarray:
    """OpenCV's 8-bit BGR->YUV U channel, in its 14-bit fixed-point arithmetic so every value,
    rounding included, matches what the encoder saw."""
    b, g, r = (bgr[..., i].astype(np.int32) for i in range(3))
    y = (r * 4899 + g * 9617 + b * 1868 + (1 << 13)) >> 14
    u = ((b - y) * 8061 + (128 << 14) + (1 << 13)) >> 14
    return np.clip(u, 0, 255).astype(np.float64)


def _strip_bits(bgr: np.ndarray) -> np.ndarray:
    u = _u_channel(bgr)
    # Haar approximation band exactly as pywt.dwt2 computes it: rows first, then columns,
    # in float64. Values that land on a bit boundary depend on this rounding.
    rows = HAAR * u[0::2] + HAAR * u[1::2]
    ll = HAAR * rows[:, 0::2] + HAAR * rows[:, 1::2]
    br, bc = ll.shape[0] // BLOCK, ll.shape[1] // BLOCK
    blocks = (ll[: br * BLOCK, : bc * BLOCK]
              .reshape(br, BLOCK, bc, BLOCK).swapaxes(1, 2).reshape(br * bc, BLOCK * BLOCK))
    # The largest coefficient after the first carries the bit, as an offset within a 36 step.
    ac = np.abs(blocks[:, 1:])
    val = ac[np.arange(len(ac)), ac.argmax(axis=1)]
    return ((val % STEP) > 0.5 * STEP).astype(np.float64)


def _block_bits(strips: Iterable[np.ndarray]) -> np.ndarray:
    """One bit per 4x4 block of the Haar band, in the library's row-major block order.
    Strips are consecutive horizontal bands of the image, each a multiple of 8 rows."""
    return np.concatenate([_strip_bits(s) for s in strips])


def _votes(bits: np.ndarray, length: int) -> tuple[int, ...]:
    if len(bits) < length:
        return ()
    # Block n votes for bit n % length; each bit is the average of its votes.
    slot = np.arange(len(bits)) % length
    votes = np.bincount(slot, weights=bits, minlength=length) / np.bincount(slot, minlength=length)
    return tuple(int(v * 255 > 127) for v in votes)


def _array_strips(bgr: np.ndarray) -> Iterator[np.ndarray]:
    rows, cols = bgr.shape[0] // 4 * 4, bgr.shape[1] // 4 * 4
    for top in range(0, rows, STRIP):
        yield bgr[top: min(top + STRIP, rows), :cols]


def decode(bgr: np.ndarray, length: int) -> tuple[int, ...]:
    """The library's WatermarkDecoder(..., length).decode(bgr, 'dwtDct') as a bit tuple."""
    return _votes(_block_bits(_array_strips(bgr)), length)


def _image_strips(img: Image.Image, bgr: bool) -> Iterator[np.ndarray]:
    """Strips straight from the decoded image, so the pixels are never copied as a whole."""
    rows, cols = min(img.height, MAX_ROWS) // 4 * 4, img.width // 4 * 4
    for top in range(0, rows, STRIP):
        strip = img.crop((0, top, cols, min(top + STRIP, rows)))
        arr = np.asarray(strip if strip.mode == "RGB" else strip.convert("RGB"))
        yield arr[..., ::-1] if bgr else arr


class WatermarkAnalyzer:
    name = "watermark"
    version = "1.0.0"

    def run(self, media: MediaInfo) -> AnalyzerResult:
        if media.width * media.height < MIN_PIXELS:
            return AnalyzerResult(raw={"checked": False, "reason": "too small"}, findings=[
                Finding("watermark.too_small", Signal.neutral, Strength.weak,
                        "Too small to check for invisible generator watermarks.")])

        raw: dict = {"checked": True, "marks": {}}
        found: tuple[str, int, int] | None = None
        with Image.open(media.path) as img:
            # Reference scripts pass BGR to the encoder; diffusers passes RGB arrays unchanged.
            for bgr in (True, False):
                bits = _block_bits(_image_strips(img, bgr))
                for mark in MARKS:
                    match = sum(a == b for a, b in zip(_votes(bits, len(mark.bits)), mark.bits))
                    raw["marks"][mark.name] = max(raw["marks"].get(mark.name, 0), match)
                    if match >= mark.min_match and (found is None or match > found[1]):
                        found = (mark.name, match, len(mark.bits))

        if found is None:
            return AnalyzerResult(raw=raw, findings=[
                Finding("watermark.none", Signal.neutral, Strength.weak,
                        "No known invisible generator watermark found. Most images have none, "
                        "and resizing or recompressing removes it.")])
        name, match, total = found
        raw["found"] = {"generator": name, "bits_matched": match, "bits_total": total}
        return AnalyzerResult(raw=raw, findings=[
            Finding("watermark.generator", Signal.ai, Strength.strong,
                    f"Contains the invisible watermark that {name} adds to generated images "
                    f"({match} of {total} bits match).")])
