"""File structure analyzer: what the container itself says about how the file was written.

Lists JPEG segments and PNG/WebP/HEIF chunks, reads the JPEG quantization tables and estimates
the quality they were saved at, names the ICC colour profile and measures data appended after
the image. All of this explains the file; none of it says whether the picture is real, so every
finding here is neutral.
"""

import io
import struct

from PIL import Image, ImageCms

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

# Long lists are cut here; a progressive JPEG or a big PNG can have hundreds of entries.
MAX_SEGMENTS = 200

# Zigzag position -> natural (row-major) index, from the JPEG spec (ITU T.81 figure A.6).
ZIGZAG = (
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
)

# Example tables from the JPEG spec (Annex K), natural order. libjpeg (IJG) scales these by
# its quality setting, and so does almost everything built on it.
IJG_LUMINANCE = (
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
)
IJG_CHROMINANCE = (
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
) + (99,) * 32

SOF_CODING = {
    0xC0: "baseline", 0xC1: "extended sequential", 0xC2: "progressive", 0xC3: "lossless",
    0xC5: "differential sequential", 0xC6: "differential progressive",
    0xC7: "differential lossless", 0xC9: "extended sequential, arithmetic",
    0xCA: "progressive, arithmetic", 0xCB: "lossless, arithmetic",
    0xCD: "differential sequential, arithmetic", 0xCE: "differential progressive, arithmetic",
    0xCF: "differential lossless, arithmetic",
}
JPEG_MARKERS = {0xC4: "DHT", 0xCC: "DAC", 0xD8: "SOI", 0xD9: "EOI", 0xDA: "SOS", 0xDB: "DQT",
                0xDD: "DRI", 0xFE: "COM"}
# Identifier at the start of an APPn payload -> what it holds.
APP_IDENTIFIERS = (
    (b"JFIF\x00", "JFIF header"),
    (b"JFXX\x00", "JFIF thumbnail"),
    (b"Exif\x00", "Exif"),
    (b"http://ns.adobe.com/xap/1.0/\x00", "XMP"),
    (b"http://ns.adobe.com/xmp/extension/\x00", "Extended XMP"),
    (b"ICC_PROFILE\x00", "ICC profile"),
    (b"MPF\x00", "Multi-picture index (MPF)"),
    (b"Photoshop 3.0\x00", "Photoshop resources"),
    (b"Adobe", "Adobe colour transform"),
    (b"Ducky", "Photoshop Save for Web"),
    (b"JP", "JUMBF (C2PA Content Credentials)"),
    (b"FPXR", "FlashPix extension"),
)

PNG_PUBLIC_CHUNKS = {
    "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP",
    "mDCV", "cLLI", "tEXt", "zTXt", "iTXt", "bKGD", "hIST", "pHYs", "sPLT", "eXIf", "tIME",
    "acTL", "fcTL", "fdAT", "oFFs", "pCAL", "sCAL", "sTER", "gIFg", "gIFx", "dSIG",
}
# Private chunks whose meaning is known.
PNG_PRIVATE_NOTES = {
    "caBX": "C2PA Content Credentials",
    "iDOT": "Apple screenshot / Preview decoding hint",
    "CgBI": "Apple iOS-optimised PNG",
    "vpAg": "ImageMagick virtual page",
    "orNT": "ImageMagick orientation",
    "npTc": "Android nine-patch",
    "npOl": "Android nine-patch",
    "npLb": "Android nine-patch",
    "mkBF": "Adobe Fireworks",
    "mkBS": "Adobe Fireworks",
    "mkBT": "Adobe Fireworks",
    "mkTS": "Adobe Fireworks",
    "prVW": "Adobe Fireworks preview",
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class StructureAnalyzer:
    name = "structure"
    version = "0.1.0"

    def run(self, media: MediaInfo) -> AnalyzerResult:
        data = media.path.read_bytes()
        raw: dict = {"file_size": len(data)}
        if data.startswith(b"\xff\xd8"):
            raw.update(_parse_jpeg(data))
        elif data.startswith(PNG_SIGNATURE):
            raw.update(_parse_png(data))
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            raw.update(_parse_webp(data))
        elif data[4:8] == b"ftyp":
            raw.update(_parse_bmff(data))
        elif data[:4] in (b"II*\x00", b"MM\x00*"):
            raw["format"] = "tiff"  # TIFF is a web of offsets, not a list: no segment walk.
        else:
            raw["format"] = None
        raw["icc"] = _icc_profile(media)
        return AnalyzerResult(raw=raw, findings=_findings(raw))


# --- JPEG ------------------------------------------------------------------------------------

def _parse_jpeg(data: bytes) -> dict:
    segments: list[dict] = []
    tables: dict[int, dict] = {}
    out: dict = {"format": "jpeg", "unit": "segment", "jpeg": {}}
    jpeg = out["jpeg"]
    comments: list[str] = []
    scans = 0
    pos, end_of_image = 2, None
    _add(segments, "SOI", None, 0, 0)

    while pos + 2 <= len(data):
        if data[pos] != 0xFF:
            out["parse_note"] = f"Unexpected byte at offset {pos}; stopped reading segments."
            break
        marker = data[pos + 1]
        if marker == 0xFF:  # fill bytes between segments are allowed
            pos += 1
            continue
        if marker == 0xD9:
            _add(segments, "EOI", None, pos, 0)
            end_of_image = pos + 2
            break
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:  # standalone markers, no length
            pos += 2
            continue
        if pos + 4 > len(data):
            break
        (length,) = struct.unpack(">H", data[pos + 2: pos + 4])
        payload = data[pos + 4: pos + 2 + length]
        name, note = _jpeg_marker_name(marker, payload)
        _add(segments, name, note, pos, length + 2)

        if marker in SOF_CODING:
            jpeg.update(_parse_sof(marker, payload))
        elif marker == 0xDB:
            tables.update(_parse_dqt(payload))
        elif marker == 0xDD and len(payload) >= 2:
            jpeg["restart_interval"] = struct.unpack(">H", payload[:2])[0]
        elif marker == 0xFE:
            comments.append(payload.decode("latin-1").strip("\x00 ")[:200])
        pos += 2 + length

        if marker == 0xDA:
            scans += 1
            pos = _skip_entropy_data(data, pos)

    jpeg["scans"] = scans
    if comments:
        jpeg["comments"] = comments
    if tables:
        jpeg["quant_tables"] = [{"id": i, **t} for i, t in sorted(tables.items())]
        jpeg["quality"] = _estimate_quality(tables, jpeg.get("component_tables", []))
    out["segments"] = _cap(segments, out)
    if end_of_image is None:
        out["parse_note"] = out.get("parse_note", "No end-of-image marker: the file is truncated.")
        out["trailing_bytes"] = None
    else:
        out["trailing_bytes"] = len(data) - end_of_image
        out["trailing_signature"] = _signature(data[end_of_image:])
    return out


def _jpeg_marker_name(marker: int, payload: bytes) -> tuple[str, str | None]:
    if marker in SOF_CODING:
        return f"SOF{marker - 0xC0}", SOF_CODING[marker]
    if 0xE0 <= marker <= 0xEF:
        name = f"APP{marker - 0xE0}"
        for ident, label in APP_IDENTIFIERS:
            if payload.startswith(ident):
                return name, label
        ident = payload[:24].split(b"\x00", 1)[0]
        printable = ident.decode("ascii", errors="replace") if ident.isascii() else None
        return name, printable or None
    return JPEG_MARKERS.get(marker, f"0xFF{marker:02X}"), None


def _parse_sof(marker: int, p: bytes) -> dict:
    if len(p) < 6:
        return {}
    precision, height, width, n = p[0], *struct.unpack(">HH", p[1:5]), p[5]
    comps = [(p[6 + 3 * i], p[7 + 3 * i] >> 4, p[7 + 3 * i] & 15, p[8 + 3 * i])
             for i in range(n) if 8 + 3 * i < len(p)]
    return {
        "sof": f"SOF{marker - 0xC0}",
        "coding": SOF_CODING[marker],
        "precision": precision,
        "width": width,
        "height": height,
        "components": n,
        "sampling": [f"{h}x{v}" for _, h, v, _ in comps],
        "subsampling": _subsampling(comps),
        "component_tables": [tq for *_, tq in comps],
    }


def _subsampling(comps: list[tuple[int, int, int, int]]) -> str | None:
    if len(comps) == 1:
        return "grayscale"
    if len(comps) != 3:
        return None  # CMYK / YCCK: the 4:x:x notation does not apply
    (_, yh, yv, _), (_, ch, cv, _), (_, ch2, cv2, _) = comps
    if (ch, cv) != (ch2, cv2) or not ch or not cv:
        return "unusual"
    return {(1, 1): "4:4:4", (2, 1): "4:2:2", (1, 2): "4:4:0", (2, 2): "4:2:0",
            (4, 1): "4:1:1"}.get((yh // ch, yv // cv), "unusual")


def _parse_dqt(p: bytes) -> dict[int, dict]:
    tables: dict[int, dict] = {}
    i = 0
    while i < len(p):
        precision, tid = p[i] >> 4, p[i] & 15
        size = 128 if precision else 64
        body = p[i + 1: i + 1 + size]
        if len(body) < size:
            break
        zigzag = struct.unpack(">64H", body) if precision else tuple(body)
        natural = [0] * 64
        for k, value in enumerate(zigzag):
            natural[ZIGZAG[k]] = value
        tables[tid] = {"precision": 16 if precision else 8, "values": natural}
        i += 1 + size
    return tables


def _skip_entropy_data(data: bytes, pos: int) -> int:
    """Position of the first real marker after a scan (FF00 is a stuffed byte, FFD0-D7 restarts)."""
    while True:
        pos = data.find(b"\xff", pos)
        if pos == -1 or pos + 1 >= len(data):
            return len(data)
        nxt = data[pos + 1]
        if nxt == 0x00 or 0xD0 <= nxt <= 0xD7 or nxt == 0xFF:
            pos += 1 if nxt == 0xFF else 2
            continue
        return pos


def ijg_table(base: tuple[int, ...], quality: int, max_value: int = 255) -> list[int]:
    """The table libjpeg's jpeg_set_quality writes for this quality."""
    scale = 5000 // quality if quality < 50 else 200 - quality * 2
    return [min(max((b * scale + 50) // 100, 1), max_value) for b in base]


def _estimate_quality(tables: dict[int, dict], component_tables: list[int]) -> dict:
    """Best-fitting IJG quality, and whether the tables are exactly IJG's at that quality."""
    lum_id = component_tables[0] if component_tables else min(tables)
    chroma_id = component_tables[1] if len(component_tables) > 1 else None
    pairs = [(tables[lum_id], IJG_LUMINANCE)] if lum_id in tables else []
    if chroma_id is not None and chroma_id != lum_id and chroma_id in tables:
        pairs.append((tables[chroma_id], IJG_CHROMINANCE))
    if not pairs:
        return {"estimate": None, "exact": False}

    best_q, best_err = None, float("inf")
    for q in range(1, 101):
        err, same = 0.0, True
        for table, base in pairs:
            limit = 32767 if table["precision"] == 16 else 255
            expected = ijg_table(base, q, limit)
            same = same and expected == table["values"]
            err += sum(abs(a - e) / e for a, e in zip(table["values"], expected))
        if same:
            return {"estimate": q, "exact": True, "fit_error": 0.0}
        if err < best_err:
            best_q, best_err = q, err
    # Mean relative difference per coefficient: near 0 for IJG-like encoders, large for
    # cameras and encoders with their own tables (the estimate is then only a rough guide).
    fit = best_err / (64 * len(pairs))
    return {"estimate": best_q, "exact": False, "fit_error": round(fit, 3)}


# --- PNG, WebP, HEIF -------------------------------------------------------------------------

def _parse_png(data: bytes) -> dict:
    segments: list[dict] = []
    out: dict = {"format": "png", "unit": "chunk"}
    pos, end_of_image = len(PNG_SIGNATURE), None
    while pos + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[pos: pos + 8])
        name = ctype.decode("latin-1")
        if not ctype.isalpha():
            out["parse_note"] = f"Invalid chunk at offset {pos}; stopped reading chunks."
            break
        _add(segments, name, PNG_PRIVATE_NOTES.get(name), pos, length + 12, kind=_png_kind(name))
        pos += length + 12
        if name == "IEND":
            end_of_image = pos
            break
    out["segments"] = _cap(segments, out)
    out["private_chunks"] = sorted({s["name"] for s in segments if s["kind"] == "private"})
    if end_of_image is None or end_of_image > len(data):
        out["parse_note"] = out.get("parse_note", "No IEND chunk: the file is truncated.")
        out["trailing_bytes"] = None
    else:
        out["trailing_bytes"] = len(data) - end_of_image
        out["trailing_signature"] = _signature(data[end_of_image:])
    return out


def _png_kind(name: str) -> str:
    if name in PNG_PUBLIC_CHUNKS:
        return "critical" if name[0].isupper() else "standard"
    # Bit 5 of the second letter (lowercase) marks a private chunk in the PNG spec.
    return "private" if name[1].islower() else "unknown"


def _parse_webp(data: bytes) -> dict:
    segments: list[dict] = []
    out: dict = {"format": "webp", "unit": "chunk"}
    (riff_size,) = struct.unpack("<I", data[4:8])
    end = min(8 + riff_size, len(data))
    pos = 12
    while pos + 8 <= end:
        ctype, length = struct.unpack("<4sI", data[pos: pos + 8])
        _add(segments, ctype.decode("latin-1"), None, pos, length + 8)
        pos += 8 + length + (length & 1)
    out["segments"] = _cap(segments, out)
    out["trailing_bytes"] = len(data) - (8 + riff_size) if 8 + riff_size <= len(data) else None
    if out["trailing_bytes"]:
        out["trailing_signature"] = _signature(data[8 + riff_size:])
    return out


def _parse_bmff(data: bytes) -> dict:
    """Top-level ISO-BMFF boxes (HEIC/HEIF, AVIF)."""
    segments: list[dict] = []
    out: dict = {"format": "heif", "unit": "box"}
    pos = 0
    while pos + 8 <= len(data):
        size, btype = struct.unpack(">I4s", data[pos: pos + 8])
        header = 8
        if size == 1 and pos + 16 <= len(data):
            size, header = struct.unpack(">Q", data[pos + 8: pos + 16])[0], 16
        elif size == 0:
            size = len(data) - pos
        if size < header:
            out["parse_note"] = f"Invalid box at offset {pos}; stopped reading boxes."
            break
        name = btype.decode("latin-1")
        note = None
        if name == "ftyp":
            note = f"brand {data[pos + 8: pos + 12].decode('latin-1')}"
            out["brand"] = data[pos + 8: pos + 12].decode("latin-1")
        _add(segments, name, note, pos, size)
        pos += size
    out["segments"] = _cap(segments, out)
    return out


# --- shared ----------------------------------------------------------------------------------

def _add(segments: list[dict], name: str, note: str | None, offset: int, length: int,
         **extra) -> None:
    """Append a segment, folding runs of the same one (IDAT, ICC chunks) into a count."""
    last = segments[-1] if segments else None
    if last and last["name"] == name and last["note"] == note:
        last["count"] += 1
        last["length"] += length
        return
    segments.append({"name": name, "note": note, "offset": offset, "length": length, "count": 1,
                     **extra})


def _cap(segments: list[dict], out: dict) -> list[dict]:
    if len(segments) > MAX_SEGMENTS:
        out["segments_truncated"] = len(segments) - MAX_SEGMENTS
        return segments[:MAX_SEGMENTS]
    return segments


def _signature(tail: bytes) -> str | None:
    """A hint at what appended bytes are, from their first bytes."""
    if not tail:
        return None
    if tail.startswith(b"\xff\xd8"):
        return "another JPEG image"
    if tail.startswith(PNG_SIGNATURE):
        return "another PNG image"
    if tail.startswith(b"PK\x03\x04"):
        return "ZIP archive"
    if tail[4:8] == b"ftyp":
        return "MP4/MOV video"
    if tail.strip(b"\x00") == b"":
        return "zero padding"
    return None


def _icc_profile(media: MediaInfo) -> dict | None:
    try:
        with Image.open(media.path) as img:
            data = img.info.get("icc_profile")
    except (OSError, ValueError):
        return None
    if not data:
        return None
    info: dict = {"size": len(data)}
    try:
        p = ImageCms.ImageCmsProfile(io.BytesIO(data)).profile
    except (OSError, ValueError, TypeError):
        info["parse_error"] = True
        return info

    def text(value) -> str | None:
        value = (value or "").strip()
        return value or None

    info.update({
        "description": text(p.profile_description),
        "manufacturer": text(p.manufacturer),
        "model": text(p.model),
        "copyright": text(p.copyright),
        "color_space": text(p.xcolor_space),
        "device_class": text(p.device_class),
        "version": round(p.version, 2) if p.version else None,
    })
    return info


def _findings(raw: dict) -> list[Finding]:
    out: list[Finding] = []
    quality = raw.get("jpeg", {}).get("quality") or {}
    if quality.get("exact"):
        out.append(Finding(
            "structure.jpeg_standard_tables", Signal.neutral, Strength.weak,
            f"Re-saved by common software: the JPEG uses the standard IJG quantization tables at "
            f"quality {quality['estimate']}, which libjpeg-based tools, apps and web services "
            "write when they save a JPEG. Many cameras use their own tables. This shows how the "
            "file was last saved, not whether the picture was changed."))

    private = raw.get("private_chunks") or []
    if private:
        named = ", ".join(f"{c} ({PNG_PRIVATE_NOTES[c]})" if c in PNG_PRIVATE_NOTES else c
                          for c in private)
        out.append(Finding(
            "structure.png_private_chunks", Signal.neutral, Strength.weak,
            f"The PNG has private chunks that only some software writes: {named}. They hint at "
            "the tool that saved the file and do not change the picture."))

    trailing = raw.get("trailing_bytes")
    if trailing:
        kind = raw.get("trailing_signature")
        mpf = any(s.get("note") == "Multi-picture index (MPF)" for s in raw.get("segments", []))
        hint = (" Phones put extra images here, such as a depth map, HDR gain map or Motion "
                "Photo video, and the multi-picture index in this file points to them."
                if mpf else
                " Phones store depth maps or Motion Photo videos this way; other tools append "
                "thumbnails or unrelated data.")
        out.append(Finding(
            "structure.trailing_data", Signal.neutral, Strength.weak,
            f"{trailing:,} bytes follow the end of the image data"
            f"{f' ({kind})' if kind else ''}. Viewers ignore them, so they do not change the "
            f"picture.{hint}"))
    return out
