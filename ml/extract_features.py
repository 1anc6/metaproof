"""Step 3: download the planned chunks, standardize each image, run CLIP, keep only features.

Every image (real or AI) goes through the same standardize() step that the live API uses:
shorter side resized to 256 px, then re-encoded as JPEG. Without it a detector can learn
"PNG means AI" from this data, because the real photos are mostly small JPEGs.

Both CLIP backbones are computed in one pass, so each image is downloaded once.
Images never touch the disk; resumable per chunk.

Three kinds of chunks (see sample_plan.py): Community Forensics row groups, Rapidata row
groups with two images per row ("pairs"), and lists of single image files ("files", from the
zr-zhang benchmark or a local folder). Exact duplicates, by content hash, are kept only once
per split; Rapidata reuses its comparison images across rows and datasets.

    python extract_features.py --split train
"""

import argparse
import hashlib
import io
import json
import queue
import random
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import open_clip
import pyarrow as pa
import pyarrow.parquet as pq
import torch
from huggingface_hub import HfFileSystem, hf_hub_download
from PIL import Image
from tqdm import tqdm

from common import BACKBONES, DATA_DIR, RAPIDATA_MODELS, SEED

Image.MAX_IMAGE_PIXELS = 200_000_000
COLUMNS = ["image_data", "label", "model_name", "real_source", "nsfw_flag"]
BATCH = 64
SHORT_SIDE = 256


def standardize(img: Image.Image, quality: int, scale: float = 1.0) -> Image.Image:
    """Same steps as backend/app/analyzers/detector.py: resize, then JPEG round trip."""
    img = img.convert("RGB")
    w, h = img.size
    target = SHORT_SIDE * scale
    if min(w, h) > target:
        r = target / min(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.BICUBIC)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


NATIVE_MAX_SHORT = 1024
CROP = 224
# Where the four crops sit (fractions of width and height); training draws random spots.
FIXED_SPOTS = [(0.5, 0.5), (0.25, 0.25), (0.75, 0.25), (0.5, 0.75)]


def native_crops(img: Image.Image, quality: int, scale: float = 1.0,
                 rng: random.Random | None = None) -> list[Image.Image]:
    """Four 224 px crops at (near) full resolution, for detector v5.

    The image is capped at 1024 px on its short side (times `scale`, as in standardize) and
    goes through the same JPEG round trip as every other image, then cropped without further
    resizing, so fine pixel detail survives. Must match backend/app/analyzers/detector.py.
    """
    img = img.convert("RGB")
    w, h = img.size
    target = min(w, h, NATIVE_MAX_SHORT) * scale
    if target < min(w, h):
        r = target / min(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.BICUBIC)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    img = Image.open(buf).convert("RGB")
    w, h = img.size
    if min(w, h) < CROP:  # tiny image: upscale just enough for a crop
        r = CROP / min(w, h)
        img = img.resize((max(CROP, round(w * r)), max(CROP, round(h * r))), Image.BICUBIC)
        w, h = img.size
    crops = []
    for fx, fy in FIXED_SPOTS:
        if rng is not None:
            fx, fy = rng.uniform(0.1, 0.9), rng.uniform(0.1, 0.9)
        x = min(max(0, round(fx * w - CROP / 2)), w - CROP)
        y = min(max(0, round(fy * h - CROP / 2)), h - CROP)
        crops.append(img.crop((x, y, x + CROP, y + CROP)))
    return crops


# Per split: list of (variant name, function picking quality/scale for each image).
VARIANTS = {
    "train": [("", lambda rng: (rng.randint(65, 95), rng.choice([1.0, 1.0, 0.75, 0.5])))],
    "calib": [("", lambda rng: (90, 1.0))],
    "heldout": [("", lambda rng: (90, 1.0)),            # what the live API sees
                ("-hard", lambda rng: (60, 0.5))],      # social-media style recompression
}
VARIANTS["heldout2"] = VARIANTS["heldout"]  # newer generators, never seen in training
VARIANTS["local"] = VARIANTS["heldout"]     # your own images


def as_table(data: list[bytes], label: list[int], model: list[str], source: list[str]):
    """The same columns a Community Forensics row group has."""
    return pa.table({"image_data": pa.array(data, pa.binary()),
                     "label": pa.array(label, pa.int8()),
                     "model_name": pa.array(model, pa.string()),
                     "real_source": pa.array(source, pa.string()),
                     "nsfw_flag": pa.array(["False"] * len(data), pa.string())})


def read_pairs(item: dict, fs: HfFileSystem):
    """Rapidata: two images per row; keep those from the models the plan chose."""
    with fs.open(item["file"], "rb", block_size=4 * 1024 * 1024) as f:
        t = pq.ParquetFile(f).read_row_group(
            item["row_group"], columns=["model1", "image1", "model2", "image2"]).to_pydict()
    keep = set(item["keep"])
    data, models = [], []
    for col in ("1", "2"):
        for raw, img in zip(t[f"model{col}"], t[f"image{col}"]):
            if raw in keep and img and img.get("bytes"):
                data.append(img["bytes"])
                models.append(RAPIDATA_MODELS[raw][0])
    return as_table(data, [1] * len(data), models, [""] * len(data))


def read_files(item: dict, fs: HfFileSystem):
    """Single image files: on the Hub (zr-zhang benchmark) or a local folder (absolute paths)."""
    data = []
    for path in item["files"]:
        if Path(path).is_absolute():
            data.append(Path(path).read_bytes())
        else:
            with fs.open(path, "rb") as f:
                data.append(f.read())
    n = len(data)
    return as_table(data, [item["label"]] * n, [item["model"]] * n, [item["source"]] * n)


def read_chunk(item: dict, fs: HfFileSystem, tmp: Path):
    if item.get("kind") == "pairs":
        return read_pairs(item, fs)
    if item.get("kind") == "files":
        return read_files(item, fs)
    repo = item["repo"].removeprefix("datasets/")
    if item.get("whole_file"):
        # One huge row group: download the file once (resumable), read, delete.
        local = hf_hub_download(repo, item["file"].split(f"{item['repo']}/", 1)[1],
                                repo_type="dataset", local_dir=tmp)
        # Close the file before deleting it: Windows refuses to delete open files.
        with open(local, "rb") as fh:
            pf = pq.ParquetFile(fh)
            cols = [c for c in COLUMNS if c in pf.schema_arrow.names]
            table = pf.read_row_group(item["row_group"], columns=cols)
            del pf
        Path(local).unlink(missing_ok=True)
        return table
    with fs.open(item["file"], "rb", block_size=4 * 1024 * 1024) as f:
        pf = pq.ParquetFile(f)
        cols = [c for c in COLUMNS if c in pf.schema_arrow.names]
        return pf.read_row_group(item["row_group"], columns=cols)


def chunk_key(item: dict) -> str:
    if "key" in item:  # v2 sources; their file names would collide across repos
        return item["key"]
    return item["file"].split("/")[-1].replace(".parquet", "") + f"_rg{item['row_group']}"


def already_extracted(dirs: list[Path]) -> tuple[set[str], Counter]:
    """Hashes and per-generator counts of images already extracted for this split.

    Chunks from v1 have no hashes; they are not needed, as v1 has no capped generators."""
    seen: set[str] = set()
    have: Counter = Counter()
    for d in dirs:
        for f in d.glob("*.npz"):
            with np.load(f) as z:
                if "sha" in z.files:
                    seen.update(z["sha"].tolist())
                    have.update(z["model"][z["label"] == 1].tolist())
    return seen, have


def full(item: dict, have: Counter) -> bool:
    """A capped chunk whose generators all have enough distinct images: no need to fetch it."""
    return "cap" in item and all(have[g] >= item["cap"] for g in item["expected"])


def fetch(item: dict, tmp: Path):
    fs = HfFileSystem()
    for attempt in range(5):
        try:
            return item, read_chunk(item, fs, tmp)
        except Exception as exc:  # flaky connection: retry the chunk
            print(f"\nretry {chunk_key(item)} ({attempt + 1}/5): {exc}")
    print(f"\nskipped {chunk_key(item)}")
    return item, None


def downloader(items, done: set, have: Counter, q: queue.Queue, tmp: Path, parallel: int = 8):
    """Small chunks are latency-bound (2-4 s each), so fetch several at once."""
    todo = [i for i in items if chunk_key(i) not in done]
    small = [i for i in todo if not i.get("whole_file")]
    whole = [i for i in todo if i.get("whole_file")]  # GB-sized: one at a time
    with ThreadPoolExecutor(parallel) as pool:
        window = []
        for item in small:
            if full(item, have):  # `have` is updated by the main thread as images arrive
                continue
            window.append(pool.submit(fetch, item, tmp))
            if len(window) >= parallel * 2:
                q.put(window.pop(0).result())
        for fut in window:
            q.put(fut.result())
    for item in whole:
        q.put(fetch(item, tmp))
    q.put(None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", required=True, choices=list(VARIANTS))
    ap.add_argument("--features", default="clip", choices=["clip", "native"],
                    help="clip: one 256 px view per image, for every backbone (v1-v3). "
                         "native: that view plus four full-resolution crops, ViT-B/16 only (v5)")
    args = ap.parse_args()
    native = args.features == "native"
    # Feature set name -> backbone; "vitb16n" holds 5 views per image (global + 4 crops).
    feature_sets = {"vitb16n": "vitb16"} if native else {bb: bb for bb in BACKBONES}

    items = json.loads((DATA_DIR / f"plan_{args.split}.json").read_text())
    tmp = DATA_DIR / "tmp"
    tmp.mkdir(exist_ok=True)
    outdirs = {}
    for variant, _ in VARIANTS[args.split]:
        for fset in feature_sets:
            d = DATA_DIR / "features" / f"{args.split}{variant}_{fset}"
            d.mkdir(parents=True, exist_ok=True)
            outdirs[(variant, fset)] = d
    # A chunk is done when the last output directory has it.
    last_dir = list(outdirs.values())[-1]
    done = {p.stem for p in last_dir.glob("*.npz")}
    last_set = list(feature_sets)[-1]
    seen, have = already_extracted([last_dir, DATA_DIR / "features" / f"calib_{last_set}"])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    models, preprocess = {}, None
    for fset, bb in feature_sets.items():
        arch, pretrained, _ = BACKBONES[bb]
        m, _, preprocess = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
        models[fset] = m.visual.to(device).eval().half()
    dims = {fset: BACKBONES[bb][2] for fset, bb in feature_sets.items()}
    views = 1 + len(FIXED_SPOTS) if native else 1

    def embed(batch: list[torch.Tensor]) -> dict[str, np.ndarray]:
        """(n, views, 3, 224, 224) -> per feature set, (n, dim) or (n, views, dim)."""
        x = torch.stack(batch).reshape(-1, 3, 224, 224).to(device).half()
        out = {}
        with torch.no_grad():
            for fset, model in models.items():
                f = torch.nn.functional.normalize(model(x).float(), dim=-1).cpu().numpy()
                f = f.reshape(len(batch), views, -1)
                out[fset] = f if native else f[:, 0]
        return out

    q: queue.Queue = queue.Queue(maxsize=4)
    threading.Thread(target=downloader, args=(items, done, have, q, tmp), daemon=True).start()
    bar = tqdm(total=sum(i["rows"] for i in items), desc=args.split, unit="img")
    bar.update(sum(i["rows"] for i in items if chunk_key(i) in done))

    while (got := q.get()) is not None:
        item, table = got
        if table is None:
            continue
        key = chunk_key(item)
        rng = random.Random(f"{SEED}-{key}")
        cols = table.to_pydict()
        n = table.num_rows
        nsfw = cols.get("nsfw_flag", ["False"] * n)

        todo = []
        for i in range(n):
            if str(nsfw[i]) == "True":
                continue
            sha = hashlib.sha1(cols["image_data"][i]).hexdigest()[:16]
            if sha in seen:
                continue
            gen = str(cols["model_name"][i] or "")
            if "cap" in item and have[gen] >= item["cap"]:
                continue  # this generator has enough distinct images
            seen.add(sha)
            if int(cols["label"][i]) == 1:
                have[gen] += 1
            # Calibration share: every tenth image of a whole file, or chosen by content hash.
            if item.get("whole_file"):
                to_calib = i % round(1 / item["calib_fraction"]) == 0
            elif item.get("calib_by_hash"):
                to_calib = int(sha[:8], 16) % round(1 / item["calib_by_hash"]) == 0
            else:
                to_calib = False
            todo.append((i, sha, to_calib))

        for variant, pick in VARIANTS[args.split]:
            # Embedded in batches as images are prepared, so a 3,000-image file with five
            # views each never sits in memory all at once.
            batch, meta = [], []
            feats = {fset: [] for fset in models}
            for i, sha, to_calib in todo:
                try:
                    img = Image.open(io.BytesIO(cols["image_data"][i]))
                    quality, scale = pick(rng)
                    stack = [preprocess(standardize(img, quality, scale))]
                    if native:
                        crop_rng = rng if args.split == "train" else None
                        stack += [preprocess(c) for c in native_crops(img, quality, scale, crop_rng)]
                    batch.append(torch.stack(stack))
                except Exception:
                    continue
                meta.append((int(cols["label"][i]), str(cols["model_name"][i] or ""),
                             str(cols["real_source"][i] or ""), bool(to_calib), sha))
                if len(batch) == BATCH:
                    for fset, f in embed(batch).items():
                        feats[fset].append(f)
                    batch = []
            if batch:
                for fset, f in embed(batch).items():
                    feats[fset].append(f)
            if not meta:
                # Nothing new in this chunk (e.g. only duplicates): mark it done anyway.
                for fset in models:
                    shape = (0, views, dims[fset]) if native else (0, dims[fset])
                    np.savez_compressed(outdirs[(variant, fset)] / f"{key}.npz",
                                        features=np.zeros(shape, np.float16),
                                        label=np.zeros(0, np.int8), model=np.array([], str),
                                        source=np.array([], str), sha=np.array([], str))
                continue
            labels, gens, sources, calib, shas = map(np.array, zip(*meta))
            for fset in models:
                f = np.concatenate(feats[fset]).astype(np.float16)
                for target, mask in (("main", ~calib), ("calib", calib)):
                    if not mask.any():
                        continue
                    out_dir = outdirs[(variant, fset)] if target == "main" else \
                        DATA_DIR / "features" / f"calib_{fset}"
                    out_dir.mkdir(parents=True, exist_ok=True)
                    np.savez_compressed(out_dir / f"{key}.npz", features=f[mask],
                                        label=labels[mask].astype(np.int8), model=gens[mask],
                                        source=sources[mask], sha=shas[mask])
        bar.update(item["rows"])
    bar.close()
    print("done")

if __name__ == "__main__":
    main()
