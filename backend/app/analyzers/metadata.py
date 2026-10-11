"""Metadata analyzer: EXIF, XMP and PNG text chunks.

Pillow covers the signals we score on everywhere. When the ExifTool binary is installed
(it is in the Docker image), its full tag dump is added to the raw output for the report.
"""

import json
import shutil
import subprocess

from PIL import Image

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

# Tag ids from the EXIF spec (PIL.ExifTags has the same values).
TAG_MAKE, TAG_MODEL, TAG_SOFTWARE, TAG_DATETIME = 271, 272, 305, 306
TAG_DATETIME_ORIGINAL = 36867
EXIF_IFD, GPS_IFD = 0x8769, 0x8825

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
    version = "0.1.0"

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
        }


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

    if f["make"] and f["model"] and f["datetime_original"]:
        out.append(Finding("meta.camera_capture", Signal.authentic, Strength.weak,
                           f"Camera capture metadata present ({f['make']} {f['model']}). "
                           "This is easy to forge, so it counts only as weak evidence."))

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
