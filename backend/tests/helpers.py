import io

from PIL import Image
from PIL.PngImagePlugin import PngInfo


def jpeg_bytes(exif: dict[int, str] | None = None, exif_ifd: dict[int, str] | None = None,
               xmp: str | None = None) -> bytes:
    img = Image.new("RGB", (64, 48), (120, 80, 40))
    ex = Image.Exif()
    for tag, value in (exif or {}).items():
        ex[tag] = value
    if exif_ifd:
        ifd = ex.get_ifd(0x8769)
        ifd.update(exif_ifd)
    buf = io.BytesIO()
    kwargs = {"exif": ex.tobytes()} if (exif or exif_ifd) else {}
    if xmp:
        kwargs["xmp"] = xmp.encode()
    img.save(buf, format="JPEG", **kwargs)
    return buf.getvalue()


def png_bytes(text: dict[str, str] | None = None) -> bytes:
    info = PngInfo()
    for k, v in (text or {}).items():
        info.add_text(k, v)
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(buf, format="PNG", pnginfo=info)
    return buf.getvalue()


def camera_exif(make: str, model: str, captured: str, size: tuple[int, int],
                thumbnail: bytes | None, makernote: bool = True, software: str | None = None) -> bytes:
    """EXIF the way a camera writes it: maker data, recorded size and a JPEG preview in IFD1.
    Pillow cannot write the preview, so this lays out the TIFF structure by hand."""
    import struct

    ascii_ = lambda s: (2, (s + "\0").encode())
    long_ = lambda n: (4, struct.pack(">I", n))

    def ifd(entries: list[tuple[int, tuple[int, bytes]]], start: int, next_ifd: int) -> tuple[bytes, bytes]:
        """One IFD at offset start; values over 4 bytes go right after it."""
        head = struct.pack(">H", len(entries))
        data_at = start + 2 + 12 * len(entries) + 4
        extra = b""
        for tag, (typ, value) in sorted(entries):
            count = len(value) // {3: 2, 4: 4}.get(typ, 1)
            if len(value) <= 4:
                field = value.ljust(4, b"\0")
            else:
                field = struct.pack(">I", data_at + len(extra))
                extra += value + (b"\0" if len(value) % 2 else b"")
            head += struct.pack(">HHI", tag, typ, count) + field
        return head + struct.pack(">I", next_ifd), extra

    ifd0_entries = [(271, ascii_(make)), (272, ascii_(model)), (0x8769, long_(0))]
    if software:
        ifd0_entries.append((305, ascii_(software)))
    exif_entries = [(36867, ascii_(captured)), (0xA002, long_(size[0])), (0xA003, long_(size[1]))]
    if makernote:
        exif_entries.append((0x927C, (7, b"MakerNoteData")))

    # Offsets depend on sizes, so the sizes are measured first and the file is built once.
    def build(exif_at: int, ifd1_at: int, thumb_at: int) -> bytes:
        e0 = [(t, long_(exif_at) if t == 0x8769 else v) for t, v in ifd0_entries]
        ifd0, x0 = ifd(e0, 8, ifd1_at if thumbnail else 0)
        exif, x1 = ifd(exif_entries, exif_at, 0)
        out = b"MM\0\x2a" + struct.pack(">I", 8) + ifd0 + x0
        out = out.ljust(exif_at, b"\0") + exif + x1
        if thumbnail:
            ifd1, _ = ifd([(0x0201, long_(thumb_at)), (0x0202, long_(len(thumbnail))),
                           (0x0103, (3, struct.pack(">H", 6)))], ifd1_at, 0)
            out = out.ljust(ifd1_at, b"\0") + ifd1
            out = out.ljust(thumb_at, b"\0") + thumbnail
        return out

    exif_at = 8 + sum(len(p) for p in ifd(ifd0_entries, 8, 0))
    exif_at += exif_at % 2
    ifd1_at = exif_at + sum(len(p) for p in ifd(exif_entries, exif_at, 0))
    ifd1_at += ifd1_at % 2
    thumb_at = ifd1_at + 2 + 12 * 3 + 4
    return b"Exif\0\0" + build(exif_at, ifd1_at, thumb_at)
