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
