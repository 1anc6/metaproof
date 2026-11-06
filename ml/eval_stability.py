"""Does a flagged image keep its score when it is shared, cropped or straightened?

The report's stability check (backend/app/analyzers/detector.py) re-scores an image the
detector flags (score >= the weak band, 0.79) on a few everyday copies of it, and counts the
detector's evidence only as far as the lowest of those scores supports it. This script
measures what that does, on the live model with the backend's own preprocessing:

  - which copies to use: every candidate below is scored, so subsets can be compared;
  - what the rule costs and buys: AI images and real photos at the strong and weak bands,
    with the original score alone and with the lowest of the original and the copies.

Copies are chosen on the calibration split (plan_calib.v3) and reported on the held-out
generators (the same 40 chunks as eval_robustness.py) and on the real camera photos from
real_photos.py, original files and their social-media copies, where false alarms happen.

    python eval_stability.py --out results_stability.json
    python eval_stability.py --summarize           # re-read stored scores, e.g. for new rules

Only images at or above the weak band get copies, as in the backend, so this is quick for
real photos. Per-image scores go to DATA_DIR/stability_scores.jsonl; --resume reuses them.
"""

import argparse
import io
import itertools
import json
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem
from PIL import Image, ImageEnhance, ImageFilter
from scipy.stats import beta

from common import DATA_DIR, SEED

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DETECTOR = ROOT / "backend/app/analyzers/detector.py"
MODEL = ROOT / "backend/models/detector.onnx"


def load_backend() -> dict:
    """The backend detector module's namespace, without importing the backend package."""
    src = BACKEND_DETECTOR.read_text(encoding="utf-8").replace(
        "from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength",
        "from types import SimpleNamespace as _NS\n"
        "AnalyzerResult = Finding = MediaInfo = None\n"
        "Signal = _NS(ai=0, authentic=1, neutral=2)\n"
        "Strength = _NS(strong=0, moderate=1, weak=2)",
    )
    ns: dict = {"__name__": "detector"}
    exec(compile(src, str(BACKEND_DETECTOR), "exec"), ns)
    return ns


# --- candidate copies ---------------------------------------------------------------------
# Built from a working copy whose longer side is at most WORK_SIDE, as the backend does, so a
# 50 MP photo isn't rotated at full size. Everything after that is deterministic.

WORK_SIDE = 2048


def working_copy(img: Image.Image) -> Image.Image:
    """A new RGB image, independent of `img`, so the decoded original can be freed."""
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > WORK_SIDE:
        r = WORK_SIDE / max(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.Resampling.LANCZOS)
    return img


def jpeg(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    out = Image.open(io.BytesIO(buf.getvalue()))
    out.load()
    return out


def crop(img: Image.Image, keep: float, ax: float = 0.5, ay: float = 0.5) -> Image.Image:
    """Keep `keep` of each side; (ax, ay) places the kept part (0.5, 0.5 = centre)."""
    w, h = img.size
    cw, ch = max(1, round(w * keep)), max(1, round(h * keep))
    x, y = round((w - cw) * ax), round((h - ch) * ay)
    return img.crop((x, y, x + cw, y + ch))


def shared(img):
    """As a messaging app or social network sends it: longer side 1080 px, JPEG quality 75."""
    w, h = img.size
    if max(w, h) > 1080:
        r = 1080 / max(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.Resampling.LANCZOS)
    return jpeg(img, 75)


def straightened(img):
    """Rotated 3 degrees and cropped to hide the corners, as a photo editor straightens."""
    return jpeg(crop(img.rotate(3, resample=Image.Resampling.BICUBIC), 0.9), 90)


def filtered(img):
    img = ImageEnhance.Brightness(img).enhance(1.1)
    img = ImageEnhance.Contrast(img).enhance(1.2)
    img = ImageEnhance.Color(img).enhance(1.3)
    return jpeg(img.filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2)), 85)


CANDIDATES = {
    "shared": shared,
    "crop_80": lambda im: crop(im, 0.8),
    "crop_60": lambda im: crop(im, 0.6),
    "crop_tl_70": lambda im: crop(im, 0.7, 0, 0),
    "crop_br_70": lambda im: crop(im, 0.7, 1, 1),
    "straightened": straightened,
    "filtered": filtered,
}


# --- data ---------------------------------------------------------------------------------

def hf_images(plan_file: str, chunks: int | None, fs: HfFileSystem):
    plan = json.loads((DATA_DIR / plan_file).read_text())
    if chunks:
        random.Random(SEED).shuffle(plan)
        plan = plan[:chunks]
    for item in plan:
        with fs.open(item["file"], "rb", block_size=4 * 1024 * 1024) as f:
            table = pq.ParquetFile(f).read_row_group(item["row_group"], columns=["image_data", "label"])
        rows = zip(table.column("image_data").to_pylist(), table.column("label").to_pylist())
        for i, (data, label) in enumerate(rows):
            yield f"{item['file'].rsplit('/', 1)[-1]}#{item['row_group']}#{i}", int(label), \
                lambda d=data: Image.open(io.BytesIO(d))


def file_images(plan_file: str):
    for item in json.loads((DATA_DIR / plan_file).read_text()):
        for path in item["files"]:
            yield path, 0, lambda p=path: Image.open(p)


# --- scoring ------------------------------------------------------------------------------

class Scorer:
    def __init__(self, backend: dict):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.session = ort.InferenceSession(str(MODEL), opts, providers=["CPUExecutionProvider"])
        self.prepare = backend["prepare"]
        self.weak = backend["BANDS"][1][0]

    def score(self, img: Image.Image) -> float:
        return float(np.ravel(self.session.run(None, {"pixels": self.prepare(img)[0]})[0])[0])

    def __call__(self, key: str, label: int, opener) -> dict:
        with opener() as img:
            p0 = self.score(img)
            rec = {"key": key, "label": label, "p": round(p0, 4)}
            if p0 >= self.weak:
                work = working_copy(img)
                img.close()
                rec["copies"] = {n: round(self.score(f(work)), 4) for n, f in CANDIDATES.items()}
        return rec


def collect(name: str, items, scorer: Scorer, store: Path, done: set[str]) -> None:
    lock = threading.Lock()
    n = 0

    def work(args):
        nonlocal n
        key, label, opener = args
        if f"{name}|{key}" in done:
            return
        try:
            rec = scorer(key, label, opener)
        except (OSError, ValueError) as e:  # an unreadable file is skipped, as an upload would be
            print(f"skip {key}: {e}", flush=True)
            return
        rec["set"] = name
        with lock:
            with store.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
            n += 1
            if n % 100 == 0:
                print(f"{name}: {n}", flush=True)

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(work, items))
    print(f"{name}: done, {n} new", flush=True)


# --- rules --------------------------------------------------------------------------------

def ci_hi(k: int, n: int) -> float:
    return float(beta.ppf(0.975, k + 1, n - k)) if k < n else 1.0


def effective(rec: dict, copies: tuple[str, ...]) -> float:
    """The score the evidence counts at: the lowest of the original and its copies."""
    if "copies" not in rec or not copies:
        return rec["p"]
    return min([rec["p"], *(rec["copies"][c] for c in copies)])


def summarize(recs: list[dict], copies: tuple[str, ...], strong: float, weak: float) -> dict:
    out = {}
    for label, who in ((0, "real"), (1, "ai")):
        group = [r for r in recs if r["label"] == label]
        if not group:
            continue
        eff = np.array([effective(r, copies) for r in group])
        k_s, k_w = int((eff >= strong).sum()), int((eff >= weak).sum())
        out[who] = {"n": len(group), "at_strong": k_s, "at_weak": k_w,
                    "at_strong_%": round(100 * k_s / len(group), 2),
                    "at_weak_%": round(100 * k_w / len(group), 2)}
        if label == 0:
            out[who]["at_strong_hi_%"] = round(100 * ci_hi(k_s, len(group)), 2)
    return out


def spread(recs: list[dict], copies: tuple[str, ...]) -> dict:
    """How far the lowest copy falls below the original, for flagged images."""
    out = {}
    for label, who in ((0, "real"), (1, "ai")):
        drops = np.array([r["p"] - min(r["copies"][c] for c in copies)
                          for r in recs if r["label"] == label and "copies" in r])
        if len(drops):
            out[who] = {"flagged": len(drops),
                        "median_drop": round(float(np.median(drops)), 3),
                        "drop_over_0.2_%": round(100 * float((drops > 0.2).mean()), 1)}
    return out


def check_backend_copies(backend: dict) -> None:
    """The backend's copies must be the ones measured here, pixel for pixel."""
    assert backend["STABILITY_WORK_SIDE"] == WORK_SIDE
    rng = np.random.default_rng(SEED)
    img = Image.fromarray(rng.integers(0, 256, (1600, 2600, 3), dtype=np.uint8))
    work = working_copy(img)
    assert np.array_equal(np.asarray(work), np.asarray(backend["working_copy"](img)))
    for name, (_, make) in backend["STABILITY_COPIES"].items():
        assert name in CANDIDATES, f"backend copy {name} was never measured"
        assert np.array_equal(np.asarray(make(work)), np.asarray(CANDIDATES[name](work))), name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=int, default=40, help="held-out chunks, as eval_robustness.py")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--summarize", action="store_true", help="only re-read the stored scores")
    ap.add_argument("--out", default="results_stability.json")
    ap.add_argument("--sets", default="calib,heldout,camera,camera_social")
    args = ap.parse_args()

    backend = load_backend()
    strong, weak = backend["BANDS"][0][0], backend["BANDS"][1][0]
    shipped = tuple(backend["STABILITY_COPIES"])
    check_backend_copies(backend)
    store = DATA_DIR / "stability_scores.jsonl"
    if not (args.resume or args.summarize) and store.exists():
        store.unlink()
    done = set()
    if store.exists():
        done = {f"{r['set']}|{r['key']}" for r in map(json.loads, store.open(encoding="utf-8"))}

    scorer = Scorer(backend)
    fs = HfFileSystem()
    sources = {
        "calib": lambda: hf_images("plan_calib.v3.json", None, fs),
        "heldout": lambda: hf_images("plan_heldout.v3.json", args.chunks, fs),
        "camera": lambda: file_images("plan_realcal.json"),
        "camera_social": lambda: file_images("plan_realcal-social.json"),
    }
    for name in [] if args.summarize else args.sets.split(","):
        collect(name, sources[name](), scorer, store, done)

    recs: dict[str, list[dict]] = {}
    for r in map(json.loads, store.open(encoding="utf-8")):
        recs.setdefault(r["set"], []).append(r)

    # Subsets of up to three copies, ranked on the calibration split by how many AI images
    # stay at the strong band (the cost), ties broken by fewer real photos there.
    subsets = [c for k in (1, 2, 3) for c in itertools.combinations(CANDIDATES, k)]
    calib = recs.get("calib", [])
    ranked = sorted(subsets, key=lambda c: (-summarize(calib, c, strong, weak)["ai"]["at_strong"],
                                            summarize(calib, c, strong, weak)["real"]["at_strong"]))
    out = {
        "model": MODEL.name,
        "bands": {"strong": strong, "weak": weak},
        "candidates": list(CANDIDATES),
        "work_side": WORK_SIDE,
        "calib_ranking": [{"copies": list(c), **summarize(calib, c, strong, weak)}
                          for c in ranked],
        "sets": {
            name: {
                "original_only": summarize(rs, (), strong, weak),
                "shipped": {"copies": list(shipped), **summarize(rs, shipped, strong, weak),
                            "spread": spread(rs, shipped)},
                "spread_all_candidates": spread(rs, tuple(CANDIDATES)),
                "per_candidate": {c: summarize(rs, (c,), strong, weak) for c in CANDIDATES},
                "top_subsets": [{"copies": list(c), **summarize(rs, c, strong, weak)}
                                for c in ranked[:8]],
            }
            for name, rs in recs.items()
        },
    }
    Path(args.out).write_text(json.dumps(out, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k != "calib_ranking"}, indent=2)[:6000])


if __name__ == "__main__":
    main()
