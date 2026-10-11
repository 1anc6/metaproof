"""Step 3: download the planned chunks, standardize each image, run CLIP, keep only features.

Every image (real or AI) goes through the same standardize() step that the live API uses:
shorter side resized to 256 px, then re-encoded as JPEG. Without it a detector can learn
"PNG means AI" from this data, because the real photos are mostly small JPEGs.

Both CLIP backbones are computed in one pass, so each image is downloaded once.
Images never touch the disk; resumable per chunk.

    python extract_features.py --split train
"""

import argparse
import io
import json
import queue
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import open_clip
import pyarrow.parquet as pq
import torch
from huggingface_hub import HfFileSystem, hf_hub_download
from PIL import Image
from tqdm import tqdm

from common import BACKBONES, DATA_DIR, SEED

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


# Per split: list of (variant name, function picking quality/scale for each image).
VARIANTS = {
    "train": [("", lambda rng: (rng.randint(65, 95), rng.choice([1.0, 1.0, 0.75, 0.5])))],
    "calib": [("", lambda rng: (90, 1.0))],
    "heldout": [("", lambda rng: (90, 1.0)),            # what the live API sees
                ("-hard", lambda rng: (60, 0.5))],      # social-media style recompression
}


def read_chunk(item: dict, fs: HfFileSystem, tmp: Path):
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
    return item["file"].split("/")[-1].replace(".parquet", "") + f"_rg{item['row_group']}"


def fetch(item: dict, tmp: Path):
    fs = HfFileSystem()
    for attempt in range(5):
        try:
            return item, read_chunk(item, fs, tmp)
        except Exception as exc:  # flaky connection: retry the chunk
            print(f"\nretry {chunk_key(item)} ({attempt + 1}/5): {exc}")
    print(f"\nskipped {chunk_key(item)}")
    return item, None


def downloader(items, done: set, q: queue.Queue, tmp: Path, parallel: int = 8):
    """Small chunks are latency-bound (2-4 s each), so fetch several at once."""
    todo = [i for i in items if chunk_key(i) not in done]
    small = [i for i in todo if not i.get("whole_file")]
    whole = [i for i in todo if i.get("whole_file")]  # GB-sized: one at a time
    with ThreadPoolExecutor(parallel) as pool:
        window = []
        for item in small:
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
    args = ap.parse_args()

    items = json.loads((DATA_DIR / f"plan_{args.split}.json").read_text())
    tmp = DATA_DIR / "tmp"
    tmp.mkdir(exist_ok=True)
    outdirs = {}
    for variant, _ in VARIANTS[args.split]:
        for bb in BACKBONES:
            d = DATA_DIR / "features" / f"{args.split}{variant}_{bb}"
            d.mkdir(parents=True, exist_ok=True)
            outdirs[(variant, bb)] = d
    # A chunk is done when the last output directory has it.
    last_dir = list(outdirs.values())[-1]
    done = {p.stem for p in last_dir.glob("*.npz")}

    device = "cuda" if torch.cuda.is_available() else "cpu"
    models, preprocess = {}, None
    for bb, (arch, pretrained, _) in BACKBONES.items():
        m, _, preprocess = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
        models[bb] = m.visual.to(device).eval().half()

    q: queue.Queue = queue.Queue(maxsize=4)
    threading.Thread(target=downloader, args=(items, done, q, tmp), daemon=True).start()
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

        for variant, pick in VARIANTS[args.split]:
            tensors, meta = [], []
            for i in range(n):
                if str(nsfw[i]) == "True":
                    continue
                try:
                    img = Image.open(io.BytesIO(cols["image_data"][i]))
                    quality, scale = pick(rng)
                    tensors.append(preprocess(standardize(img, quality, scale)))
                except Exception:
                    continue
                # Whole files: send every tenth image to the calibration split instead.
                to_calib = item.get("whole_file") and i % round(1 / item["calib_fraction"]) == 0
                meta.append((int(cols["label"][i]), str(cols["model_name"][i] or ""),
                             str(cols["real_source"][i] or ""), bool(to_calib)))
            if not tensors:
                continue
            x_all = torch.stack(tensors)
            for bb, model in models.items():
                feats = []
                with torch.no_grad():
                    for s in range(0, len(x_all), BATCH):
                        f = model(x_all[s:s + BATCH].to(device).half()).float()
                        feats.append(torch.nn.functional.normalize(f, dim=-1).cpu().numpy())
                feats = np.concatenate(feats).astype(np.float16)
                labels, gens, sources, calib = map(np.array, zip(*meta))
                for target, mask in (("main", ~calib), ("calib", calib)):
                    if not mask.any():
                        continue
                    out_dir = outdirs[(variant, bb)] if target == "main" else \
                        DATA_DIR / "features" / f"calib_{bb}"
                    out_dir.mkdir(parents=True, exist_ok=True)
                    np.savez_compressed(out_dir / f"{key}.npz", features=feats[mask],
                                        label=labels[mask].astype(np.int8), model=gens[mask],
                                        source=sources[mask])
        bar.update(item["rows"])
    bar.close()
    print("done")


if __name__ == "__main__":
    main()
