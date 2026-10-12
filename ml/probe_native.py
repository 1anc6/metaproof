"""Experiment: does CLIP see newer generators better at (near) full resolution?

The live detector shrinks every image to 256 px before CLIP looks at it. That removes the fine
detail where photorealistic generators (Nano Banana 2, GPT Image 2, Qwen Image 2.1) may still
differ from photos. This compares two inputs on the same images, with the same linear probe:

  standard  the live preprocessing (256 px, JPEG 90, CLIP resize and center crop)
  native    four 224 px crops at up to 1024 px short side (JPEG 90 first), no resizing below

Every image is first made comparable: short side at most 1024 px, then JPEG quality 90, real
and AI alike. AI images come from the zr-zhang benchmark (PNG). Real images come from the same
benchmark (matched content, but small web JPEGs) and from VISION phone photos (high
resolution; downscaling them to 1024 px also erases their original JPEG grid).

Reports probe AUC per generator against each real source, with every generator in training,
and with the tested generator left out of training (the honest view for the next one).

    python probe_native.py
"""

import argparse
import hashlib
import io
import json
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import open_clip
import pyarrow.parquet as pq
import torch
from huggingface_hub import HfFileSystem, hf_hub_download
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from tqdm import tqdm

from common import DATA_DIR, SEED, TRAIN_REPO
from extract_features import standardize

Image.MAX_IMAGE_PIXELS = 200_000_000
GENERATORS = ["Nano Banana 2", "GPT Image 2", "Qwen Image 2.1", "FLUX.2"]
TRAIN_PER_GEN, TEST_PER_GEN = 400, 300
ZR_REAL_TRAIN, ZR_REAL_TEST = 600, 600
VISION_TRAIN, VISION_TEST = 1200, 800
MAX_SHORT = 1024
CROP = 224
OUT = DATA_DIR / "probe_native"


def comparable(img: Image.Image) -> Image.Image:
    """Same treatment for every image: short side <= 1024 px, then a JPEG 90 round trip."""
    img = img.convert("RGB")
    w, h = img.size
    if min(w, h) > MAX_SHORT:
        r = MAX_SHORT / min(w, h)
        img = img.resize((round(w * r), round(h * r)), Image.BICUBIC)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def native_crops(img: Image.Image) -> list[Image.Image]:
    """Four 224 px crops at the image's own scale (center, and three other fixed positions)."""
    w, h = img.size
    if min(w, h) < CROP:  # tiny image: upscale just enough for one crop
        r = CROP / min(w, h)
        img = img.resize((max(CROP, round(w * r)), max(CROP, round(h * r))), Image.BICUBIC)
        w, h = img.size
    spots = [(0.5, 0.5), (0.25, 0.25), (0.75, 0.25), (0.5, 0.75)]
    crops = []
    for fx, fy in spots:
        x = min(max(0, round(fx * w - CROP / 2)), w - CROP)
        y = min(max(0, round(fy * h - CROP / 2)), h - CROP)
        crops.append(img.crop((x, y, x + CROP, y + CROP)))
    return crops


def zr_items(rng: random.Random) -> list[dict]:
    """Benchmark files: test = exactly the heldout2 files, train = others, no overlap."""
    index = json.loads((DATA_DIR / "index_zr.json").read_text())
    tested = {f for i in json.loads((DATA_DIR / "plan_heldout2.json").read_text())
              if i.get("kind") == "files" for f in i["files"]}
    items = []
    for gen in GENERATORS + ["Real"]:
        files = sorted(r["file"] for r in index if r["generator"] == gen)
        test = [f for f in files if f in tested]
        rest = [f for f in files if f not in tested]
        rng.shuffle(rest)
        rng.shuffle(test)
        n_train = ZR_REAL_TRAIN if gen == "Real" else TRAIN_PER_GEN
        n_test = ZR_REAL_TEST if gen == "Real" else TEST_PER_GEN
        source = "zr-real" if gen == "Real" else gen
        items += [{"file": f, "source": source, "split": "train"} for f in rest[:n_train]]
        items += [{"file": f, "source": source, "split": "test"} for f in test[:n_test]]
    return items


def vision_images(tmp: Path) -> list[tuple[bytes, str]]:
    small = json.loads((DATA_DIR / "index_train.json").read_text())
    entry = next(r for r in small if r["model_name"] == "VISION" and r["label"] == 0)
    rel = entry["file"].split(f"{TRAIN_REPO}/", 1)[1]
    local = hf_hub_download(TRAIN_REPO.removeprefix("datasets/"), rel, repo_type="dataset",
                            local_dir=tmp)
    with open(local, "rb") as fh:
        table = pq.ParquetFile(fh).read_row_group(entry["row_group"], columns=["image_data"])
    Path(local).unlink(missing_ok=True)
    return [(b, "vision") for b in table.column("image_data").to_pylist()]


def degrade_like_reals(data: bytes, rng: random.Random, real_shorts: list[int]) -> bytes:
    """Give an AI image the history of the benchmark's real photos: a web-sized JPEG.

    Their short sides are mostly 290-930 px and about 90% are JPEGs at quality ~75-85, so an
    AI image is shrunk to a size drawn from theirs and saved at a quality drawn the same way.
    """
    img = Image.open(io.BytesIO(data)).convert("RGB")
    s = rng.choice(real_shorts)
    if s < min(img.size):
        r = s / min(img.size)
        img = img.resize((max(1, round(img.width * r)), max(1, round(img.height * r))),
                         Image.BICUBIC)
    quality = rng.choices([75, 85, 95], weights=[52, 40, 8])[0]
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--match-reals", action="store_true",
                    help="give AI images the size and JPEG history of the benchmark's real "
                         "photos first, to rule out a compression or size shortcut")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / ("features_matched.npz" if args.match_reals else "features.npz")
    if not cache.exists():
        extract(cache, args.match_reals)
    report(np.load(cache))


def extract(cache: Path, match_reals: bool = False) -> None:
    rng = random.Random(f"{SEED}-native")
    fs = HfFileSystem()
    items = zr_items(rng)

    files_dir = OUT / "files"  # downloads are kept, so a rerun after a failure resumes
    files_dir.mkdir(exist_ok=True)

    def fetch(item):
        local = files_dir / hashlib.sha1(item["file"].encode()).hexdigest()
        if not local.exists():
            for attempt in range(5):
                try:
                    with fs.open(item["file"], "rb") as f:
                        data = f.read()
                    break
                except Exception as exc:  # flaky connection: retry the file
                    if attempt == 4:
                        raise
                    print(f"\nretry {item['file'].split('/')[-1]} ({attempt + 1}/5): {exc}")
            local.write_bytes(data)
        return local.read_bytes(), item["source"], item["split"]

    with ThreadPoolExecutor(8) as pool:
        raw = list(tqdm(pool.map(fetch, items), total=len(items), desc="benchmark files"))
    if match_reals:
        # Only the benchmark's own real photos: the question is about them.
        shorts = [min(Image.open(io.BytesIO(b)).size) for b, s, _ in raw if s == "zr-real"]
        drng = random.Random(f"{SEED}-degrade")
        raw = [(degrade_like_reals(b, drng, shorts) if s in GENERATORS else b, s, sp)
               for b, s, sp in raw]
    else:
        vision = vision_images(DATA_DIR / "tmp")
        rng.shuffle(vision)
        raw += [(b, s, "train") for b, s in vision[:VISION_TRAIN]]
        raw += [(b, s, "test") for b, s in vision[VISION_TRAIN:VISION_TRAIN + VISION_TEST]]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-16-quickgelu",
                                                                 pretrained="openai")
    model = model.visual.to(device).eval().half()

    def embed(images: list[Image.Image]) -> np.ndarray:
        x = torch.stack([preprocess(im) for im in images]).to(device).half()
        with torch.no_grad():
            return torch.nn.functional.normalize(model(x).float(), dim=-1).cpu().numpy()

    std, nat, sources, splits, shas = [], [], [], [], []
    seen = set()
    for data, source, split in tqdm(raw, desc="CLIP"):
        sha = hashlib.sha1(data).hexdigest()[:16]
        if sha in seen:
            continue  # the benchmark repeats some files under other names
        seen.add(sha)
        try:
            img = comparable(Image.open(io.BytesIO(data)))
        except Exception:
            continue
        std.append(embed([standardize(img, 90)])[0])
        nat.append(embed(native_crops(img)))  # 4 x 512
        sources.append(source)
        splits.append(split)
        shas.append(sha)
    np.savez_compressed(cache, standard=np.array(std, np.float16), native=np.array(nat, np.float16),
                        source=np.array(sources), split=np.array(splits), sha=np.array(shas))


def fit_predict(x_tr, y_tr, x_te, crops: bool):
    """Linear probe; for crops, train on every crop and average the logits per image."""
    if crops:
        n = x_tr.shape[1]
        clf = LogisticRegression(C=1.0, max_iter=5000).fit(x_tr.reshape(-1, x_tr.shape[-1]),
                                                           np.repeat(y_tr, n))
        z = clf.decision_function(x_te.reshape(-1, x_te.shape[-1])).reshape(len(x_te), -1)
        return z.mean(axis=1)
    clf = LogisticRegression(C=1.0, max_iter=5000).fit(x_tr, y_tr)
    return clf.decision_function(x_te)


def report(z) -> None:
    source, split = z["source"], z["split"]
    ai = np.isin(source, GENERATORS)
    feats = {"standard": z["standard"].astype(np.float32), "native": z["native"].astype(np.float32)}
    tr, te = split == "train", split == "test"
    print(f"images: train {tr.sum()} (AI {(tr & ai).sum()}), test {te.sum()} (AI {(te & ai).sum()})")
    results = {}
    for mode in ("all generators in training", "tested generator left out"):
        print(f"\n{mode}: probe AUC, standard -> native")
        print(f"  {'generator':16}{'vs benchmark real':>24}{'vs phone photos':>22}")
        for gen in GENERATORS:
            row = []
            leave_out = mode.startswith("tested")
            train_mask = tr & ((~ai) | (source != gen)) if leave_out else tr
            scores = {}
            for name, x in feats.items():
                scores[name] = fit_predict(x[train_mask], ai[train_mask].astype(int), x[te],
                                           crops=name == "native")
            for real in ("zr-real", "vision"):
                if not (source[te] == real).any():
                    row.append("-")
                    continue
                m = (source[te] == gen) | (source[te] == real)
                y = ai[te][m]
                a, b = (roc_auc_score(y, scores[n][m]) for n in ("standard", "native"))
                row.append(f"{a:.3f} -> {b:.3f}")
                results[f"{mode}|{gen}|{real}"] = {"standard": round(a, 4), "native": round(b, 4)}
            print(f"  {gen:16}{row[0]:>24}{row[1]:>22}")
    name = "probe_native_results.json" if (source == "vision").any() else "probe_native_matched.json"
    Path(name).write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
