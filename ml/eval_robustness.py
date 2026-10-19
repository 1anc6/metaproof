"""How the live detector holds up when an image is cropped, screenshotted or edited.

The headline numbers (README) test unseen generators as-is and after recompression. People
also check crops, phone screenshots, filtered and captioned copies, so this runs the shipped
model (backend/models/detector.onnx) with the backend's own preprocessing on the held-out
generators under each of those changes, applied identically to real and AI images.

What matters most is the real photos: a score in the strong band can decide a verdict on its
own, so the share of real photos that reach it under each change is the number to watch.

Needs only onnxruntime, pyarrow, huggingface_hub, scikit-learn, numpy and Pillow (no torch):

    python eval_robustness.py --chunks 40 --out results_robustness.json
"""

import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from sklearn.metrics import roc_auc_score

from common import DATA_DIR, SEED

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DETECTOR = ROOT / "backend/app/analyzers/detector.py"
MODEL = ROOT / "backend/models/detector.onnx"


def load_backend():
    """preprocess() and the live bands from the backend file, without importing the backend."""
    src = BACKEND_DETECTOR.read_text(encoding="utf-8").replace(
        "from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength",
        "from types import SimpleNamespace as _NS\n"
        "AnalyzerResult = Finding = MediaInfo = None\n"
        "Signal = _NS(ai=0, authentic=1, neutral=2)\n"
        "Strength = _NS(strong=0, moderate=1, weak=2)",
    )
    ns: dict = {}
    exec(compile(src, str(BACKEND_DETECTOR), "exec"), ns)
    return ns["preprocess"], ns["BANDS"][0][0], ns["BANDS"][1][0]


# --- the changes people make before checking an image -------------------------------------

def jpeg(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    return Image.open(io.BytesIO(buf.getvalue()))


def png(img: Image.Image) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Image.open(io.BytesIO(buf.getvalue()))


def center_crop(img, keep=0.6):
    w, h = img.size
    cw, ch = int(w * keep), int(h * keep)
    return img.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2))


def corner_crop(img, rng, keep=0.5):
    w, h = img.size
    cw, ch = int(w * keep), int(h * keep)
    x, y = rng.randint(0, w - cw), rng.randint(0, h - ch)
    return img.crop((x, y, x + cw, y + ch))


def screenshot(img):
    """Shown full width on a 1080 px phone screen with app bars above and below, saved as PNG."""
    img = img.convert("RGB")
    w, h = img.size
    scaled = img.resize((1080, max(1, round(h * 1080 / w))), Image.LANCZOS)
    canvas = Image.new("RGB", (1080, scaled.height + 420), (18, 18, 18))
    canvas.paste(scaled, (0, 220))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((40, 60, 600, 120), fill=(60, 60, 60))  # stand-ins for UI text
    draw.rectangle((40, scaled.height + 260, 900, scaled.height + 300), fill=(60, 60, 60))
    return png(canvas)


def filtered(img):
    """An Instagram-style edit: brighter, more contrast and colour, sharpened, saved as JPEG."""
    img = img.convert("RGB")
    img = ImageEnhance.Brightness(img).enhance(1.1)
    img = ImageEnhance.Contrast(img).enhance(1.2)
    img = ImageEnhance.Color(img).enhance(1.3)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
    return jpeg(img, 85)


def captioned(img):
    """A meme-style white band with dark text blocks above the picture."""
    img = img.convert("RGB")
    w, h = img.size
    band = max(40, h // 6)
    canvas = Image.new("RGB", (w, h + band), (255, 255, 255))
    canvas.paste(img, (0, band))
    draw = ImageDraw.Draw(canvas)
    for i in range(3):
        x0 = w // 10 + i * w // 4
        draw.rectangle((x0, band // 3, x0 + w // 5, 2 * band // 3), fill=(20, 20, 20))
    return jpeg(canvas, 85)


def rotated(img):
    """Straightened by 3 degrees, then cropped to remove the corners, as a photo editor does."""
    img = img.convert("RGB").rotate(3, resample=Image.BICUBIC)
    return jpeg(center_crop(img, 0.9), 90)


def social(img):
    img = img.convert("RGB")
    w, h = img.size
    return jpeg(img.resize((max(1, w // 2), max(1, h // 2)), Image.LANCZOS), 60)


def variants(img: Image.Image, rng: random.Random) -> dict[str, Image.Image]:
    return {
        "original": img,
        "crop_center_60": center_crop(img),
        "crop_corner_50": corner_crop(img, rng),
        "screenshot": screenshot(img),
        "filter_edit": filtered(img),
        "caption_band": captioned(img),
        "rotate_3deg": rotated(img),
        "social_recompress": social(img),
    }


# --- data and scoring ---------------------------------------------------------------------

def read_rows(item: dict, fs: HfFileSystem):
    with fs.open(item["file"], "rb", block_size=4 * 1024 * 1024) as f:
        table = pq.ParquetFile(f).read_row_group(item["row_group"], columns=["image_data", "label"])
    return zip(table.column("image_data").to_pylist(), table.column("label").to_pylist())


def summarize(p: np.ndarray, y: np.ndarray, strong: float, weak: float) -> dict:
    real, ai = p[y == 0], p[y == 1]
    pct = lambda x: round(float(x.mean()) * 100, 1)  # noqa: E731
    return {
        "auc": round(float(roc_auc_score(y, p)), 4),
        "real_at_strong_%": pct(real >= strong),
        "real_at_weak_%": pct(real >= weak),
        "ai_at_strong_%": pct(ai >= strong),
        "ai_above_0.5_%": pct(ai >= 0.5),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=int, default=40, help="25 images each, from the held-out test")
    ap.add_argument("--plan", default="plan_heldout.v3.json", help="the test split v3 was measured on")
    ap.add_argument("--out", default="results_robustness.json")
    args = ap.parse_args()

    preprocess, strong, weak = load_backend()
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    plan = json.loads((DATA_DIR / args.plan).read_text())
    random.Random(SEED).shuffle(plan)
    rng = random.Random(SEED)
    fs = HfFileSystem()

    scores: dict[str, list[float]] = {}
    labels: list[int] = []
    for i, item in enumerate(plan[: args.chunks], 1):
        for data, label in read_rows(item, fs):
            img = Image.open(io.BytesIO(data))
            img.load()
            for name, v in variants(img, rng).items():
                p = session.run(None, {"pixels": preprocess(v)})[0]
                scores.setdefault(name, []).append(float(np.ravel(p)[0]))
            labels.append(int(label))
        print(f"chunk {i}/{args.chunks}: {len(labels)} images", flush=True)

    y = np.array(labels)
    out = {
        "model": MODEL.name,
        "plan": args.plan,
        "n": len(y),
        "ai": int(y.sum()),
        "real": int((y == 0).sum()),
        "bands": {"strong": strong, "weak": weak},
        "variants": {name: summarize(np.array(p), y, strong, weak) for name, p in scores.items()},
    }
    Path(args.out).write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
