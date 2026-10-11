"""Metadata analyzer: EXIF, XMP and PNG text chunks.

Pillow covers the signals we score on everywhere. When the ExifTool binary is installed
(it is in the Docker image), its full tag dump is added to the raw output for the report.
"""

import io
import json
import shutil
import subprocess

import numpy as np
from PIL import ExifTags, Image

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

# Tag ids from the EXIF spec (PIL.ExifTags has the same values).
TAG_MAKE, TAG_MODEL, TAG_SOFTWARE, TAG_DATETIME = 271, 272, 305, 306
TAG_DATETIME_ORIGINAL = 36867
TAG_MAKERNOTE, TAG_PIXEL_X, TAG_PIXEL_Y = 0x927C, 0xA002, 0xA003
TAG_THUMB_OFFSET, TAG_THUMB_LENGTH = 0x0201, 0x0202
EXIF_IFD, GPS_IFD = 0x8769, 0x8825

# The embedded preview must look like the picture. Genuine camera files mostly score 0.91-1.0;
# a few score far lower, so a poor match only withholds this support and is never held against
# the file. Editors such as GIMP and Photoshop write a fresh preview, so a match alone proves
# nothing: it counts only next to the other camera traces below.
MIN_THUMBNAIL_SIMILARITY = 0.9

AI_TOOL_HINTS = (
    "midjourney", "stable diffusion", "stablediffusion", "dall-e", "dall·e", "firefly",
    "comfyui", "automatic1111", "novelai", "imagen", "ideogram", "leonardo.ai", "flux",
)
EDITOR_HINTS = (
    "photoshop", "gimp", "lightroom", "snapseed", "canva", "pixelmator", "affinity",
    "picsart", "facetune", "paint.net", "luminar",
)
# PNG text keys written by popular local diffusion front-ends (A1111, ComfyUI, InvokeAI).
AI_PNG_KEYS = {"parameters", "prompt", "workflow", "dream", "sd-metadata", "invokeai_metadata"}

IPTC_AI_SOURCE = "trainedalgorithmicmedia"
IPTC_AI_COMPOSITE = "compositewithtrainedalgorithmicmedia"

EXIFTOOL_TIMEOUT_S = 15


class MetadataAnalyzer:
    name = "metadata"
    version = "0.2.0"

    def run(self, media: MediaInfo) -> AnalyzerResult:
        fields = _read_with_pillow(media)
        raw: dict = {"fields": fields}
        dump = _exiftool_dump(media)
        if dump is not None:
            raw["exiftool"] = dump
        return AnalyzerResult(raw=raw, findings=_findings(fields))


def _read_with_pillow(media: MediaInfo) -> dict:
    with Image.open(media.path) as img:
        exif = img.getexif()
        exif_ifd = exif.get_ifd(EXIF_IFD) if exif else {}
        xmp = img.info.get("xmp") or img.info.get("XML:com.adobe.xmp") or b""
        if isinstance(xmp, bytes):
            xmp = xmp.decode("utf-8", errors="replace")
        size_matches = _exif_size_matches(img, exif_ifd)
        png_text_keys = sorted(
            k for k, v in img.info.items() if isinstance(v, str) and k != "XML:com.adobe.xmp"
        )

        return {
            "has_exif": len(exif) > 0,
            "make": _clean(exif.get(TAG_MAKE)),
            "model": _clean(exif.get(TAG_MODEL)),
            "software": _clean(exif.get(TAG_SOFTWARE)),
            "datetime_original": _clean(exif_ifd.get(TAG_DATETIME_ORIGINAL)),
            "datetime_modified": _clean(exif.get(TAG_DATETIME)),
            # Only whether GPS exists: coordinates are personal data and are never stored.
            "has_gps": bool(exif.get_ifd(GPS_IFD)) if exif else False,
            "has_xmp": bool(xmp),
            "xmp_digital_source_type": _digital_source_type(xmp),
            "xmp_creator_tool": _xmp_attr(xmp, "xmp:CreatorTool"),
            "png_text_keys": png_text_keys,
            "has_makernote": TAG_MAKERNOTE in exif_ifd,
            "exif_size_matches": size_matches,
            # Last: it may switch a JPEG to reduced-size decoding.
            "thumbnail_similarity": _thumbnail_similarity(img, exif),
        }


def _exif_size_matches(img: Image.Image, exif_ifd) -> bool | None:
    """Whether the size the camera recorded is the size of the pixels; None if not recorded."""
    w, h = exif_ifd.get(TAG_PIXEL_X), exif_ifd.get(TAG_PIXEL_Y)
    if not w or not h:
        return None
    return (w, h) in (img.size, img.size[::-1])


def _thumbnail_similarity(img: Image.Image, exif) -> float | None:
    """Correlation between the EXIF preview and the image, scaled to the preview's size."""
    ifd1 = exif.get_ifd(ExifTags.IFD.IFD1) if exif else {}
    offset, length = ifd1.get(TAG_THUMB_OFFSET), ifd1.get(TAG_THUMB_LENGTH)
    raw = img.info.get("exif") or b""
    if not offset or not length or not raw:
        return None
    tiff = raw[6:] if raw.startswith(b"Exif\x00\x00") else raw
    try:
        with Image.open(io.BytesIO(tiff[offset: offset + length])) as thumb:
            t = np.asarray(thumb.convert("L"), dtype=np.float64)
    except (OSError, ValueError):  # missing or broken preview: no support either way
        return None
    # Previews are often letterboxed to 160x120; compare only the picture area.
    rows = np.nonzero(t.max(axis=1) > 12)[0]
    cols = np.nonzero(t.max(axis=0) > 12)[0]
    if len(rows) < 16 or len(cols) < 16:
        return None
    t = t[rows[0]: rows[-1] + 1, cols[0]: cols[-1] + 1]
    img.draft("L", (t.shape[1] * 2, t.shape[0] * 2))  # JPEG: decode at reduced size, cheaply
    m = np.asarray(img.convert("L").resize((t.shape[1], t.shape[0]), Image.BILINEAR),
                   dtype=np.float64)
    a, b = t - t.mean(), m - m.mean()
    denom = np.sqrt((a * a).sum() * (b * b).sum())
    return round(float((a * b).sum() / denom), 3) if denom else None


def _findings(f: dict) -> list[Finding]:
    out: list[Finding] = []
    tool_text = " ".join(filter(None, [f["software"], f["xmp_creator_tool"]])).lower()

    if f["xmp_digital_source_type"] == IPTC_AI_SOURCE:
        out.append(Finding("meta.iptc_ai_source", Signal.ai, Strength.strong,
                           "XMP declares the IPTC source type 'trained algorithmic media' "
                           "(AI-generated)."))
    elif f["xmp_digital_source_type"] == IPTC_AI_COMPOSITE:
        out.append(Finding("meta.iptc_ai_composite", Signal.ai, Strength.moderate,
                           "XMP declares the image is a composite that includes AI-generated "
                           "content."))

    ai_keys = AI_PNG_KEYS.intersection(k.lower() for k in f["png_text_keys"])
    if ai_keys:
        out.append(Finding("meta.diffusion_parameters", Signal.ai, Strength.strong,
                           f"PNG text chunks typical of image generators found: "
                           f"{', '.join(sorted(ai_keys))}."))

    ai_tool = next((h for h in AI_TOOL_HINTS if h in tool_text), None)
    if ai_tool:
        out.append(Finding("meta.ai_tool_tag", Signal.ai, Strength.moderate,
                           f"Software tag names an AI image tool ('{ai_tool}')."))

    editor = next((h for h in EDITOR_HINTS if h in tool_text), None)
    if editor:
        out.append(Finding("meta.editor_tag", Signal.edited, Strength.moderate,
                           f"Software tag shows the file was saved by an editor ('{editor}')."))

    if (f["datetime_original"] and f["datetime_modified"]
            and f["datetime_original"] != f["datetime_modified"]):
        out.append(Finding("meta.modified_after_capture", Signal.edited, Strength.weak,
                           "Modification date differs from the original capture date."))

    camera = f["make"] and f["model"] and f["datetime_original"]
    if camera:
        out.append(Finding("meta.camera_capture", Signal.authentic, Strength.weak,
                           f"Camera capture metadata present ({f['make']} {f['model']}). "
                           "This is easy to forge, so it counts only as weak evidence."))

    # A file straight from the camera keeps traces that editors and naive EXIF copying tend to
    # break. Still weak: the phone's own photo editor keeps them, so this cannot show "unedited".
    if (camera and not editor and f["has_makernote"] and f["exif_size_matches"] is not False
            and (f["thumbnail_similarity"] or 0) >= MIN_THUMBNAIL_SIMILARITY
            and not (f["datetime_modified"] and f["datetime_modified"] != f["datetime_original"])):
        out.append(Finding("meta.camera_original", Signal.authentic, Strength.weak,
                           "The file has the structure of a camera original: maker data, the "
                           "recorded image size and a preview that matches the picture."))

    if not f["has_exif"] and not f["has_xmp"] and not f["png_text_keys"]:
        out.append(Finding("meta.stripped", Signal.neutral, Strength.weak,
                           "No embedded metadata. This is normal after social-media upload "
                           "or screenshots and is not evidence either way."))
    return out


def _exiftool_dump(media: MediaInfo) -> dict | None:
    exe = shutil.which("exiftool")
    if exe is None:
        return None
    try:
        # Argument list, no shell: the file path can never be interpreted as a command.
        proc = subprocess.run(
            [exe, "-json", "-G1", "-n", "-x", "System:all", str(media.path)],
            capture_output=True, timeout=EXIFTOOL_TIMEOUT_S, check=False,
        )
        tags = json.loads(proc.stdout or b"[{}]")[0]
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None
    return {
        k: v for k, v in tags.items()
        if "GPS" not in k and k != "SourceFile" and not str(v).startswith("(Binary data")
    }


def _clean(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    text = str(value).strip("\x00 ").strip()
    return text or None


def _digital_source_type(xmp: str) -> str | None:
    lowered = xmp.lower()
    # Check the longer IPTC term first: it contains the shorter one.
    for term in (IPTC_AI_COMPOSITE, IPTC_AI_SOURCE, "digitalcapture"):
        if term in lowered:
            return term
    return None


def _xmp_attr(xmp: str, name: str) -> str | None:
    """Tiny extractor for attribute or element forms; avoids a full XML parser on untrusted input."""
    for opener, closer in ((f'{name}="', '"'), (f"<{name}>", f"</{name}>")):
        start = xmp.find(opener)
        if start != -1:
            start += len(opener)
            end = xmp.find(closer, start)
            if end != -1:
                return xmp[start:end].strip() or None
    return None
