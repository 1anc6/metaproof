"""Step 1: index the datasets by reading only Parquet footers (no images, no columns).

Each file's footer stores, per row group (~25 images), the min and max of every column.
Row groups here come from a single generator and real source, so min/max tells us what a
row group contains for about one HTTP request per file. Exact per-image labels are read
later, together with the images.

Rapidata (newer generators) mixes models inside a row group, so there the two small
model-name columns are read in full instead: exact counts for about one request per row group.

    python scan_metadata.py            # all datasets
    python scan_metadata.py --only eval
"""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem
from tqdm import tqdm

from common import DATA_DIR, EVAL_REPO, RAPIDATA_REPOS, TRAIN_REPO, ZR_REPO

fs = HfFileSystem()
COLUMNS = ["label", "model_name", "subset", "real_source", "architecture"]


def _minmax(rg_meta, index: int):
    stats = rg_meta.column(index).statistics
    if stats is None or not stats.has_min_max:
        return None, None
    return stats.min, stats.max


def scan_file(path: str) -> list[dict]:
    with fs.open(path, "rb", block_size=256 * 1024) as f:
        md = pq.ParquetFile(f).metadata
    names = [md.schema.column(i).name for i in range(md.num_columns)]
    rows = []
    for rg in range(md.num_row_groups):
        meta = md.row_group(rg)
        entry = {
            "file": path,
            "row_group": rg,
            "rows": meta.num_rows,
            "bytes": sum(meta.column(i).total_compressed_size for i in range(meta.num_columns)),
        }
        for col in COLUMNS:
            lo, hi = _minmax(meta, names.index(col)) if col in names else (None, None)
            entry[col] = lo if lo == hi else f"{lo}..{hi}"  # a range marks a mixed row group
        rows.append(entry)
    return rows


def scan_repo(repo: str, out_name: str, workers: int = 16) -> None:
    out = DATA_DIR / out_name
    if out.exists():
        print(f"{out} exists, skipping")
        return
    files = sorted(fs.glob(f"{repo}/data/*.parquet"))
    index: list[dict] = []
    with ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(scan_file, p) for p in files]
        for fut in tqdm(as_completed(futures), total=len(files), desc=out_name):
            index.extend(fut.result())
    index.sort(key=lambda r: (r["file"], r["row_group"]))
    out.write_text(json.dumps(index))
    total = sum(r["rows"] for r in index)
    print(f"wrote {out}: {len(index):,} row groups, {total:,} images")


def scan_rapidata_file(repo: str, path: str) -> list[dict]:
    with fs.open(path, "rb", block_size=1024 * 1024) as f:
        pf = pq.ParquetFile(f)
        md = pf.metadata
        rows = []
        for rg in range(md.num_row_groups):
            t = pf.read_row_group(rg, columns=["model1", "model2"]).to_pydict()
            meta = md.row_group(rg)
            rows.append({
                "repo": repo,
                "file": path,
                "row_group": rg,
                "rows": meta.num_rows,
                "bytes": sum(meta.column(i).total_compressed_size for i in range(meta.num_columns)),
                # images per model and column, e.g. {"image1": {"seedream-3-24-7-25": 100}}
                "models": {"image1": dict(Counter(t["model1"])), "image2": dict(Counter(t["model2"]))},
            })
    return rows


def scan_rapidata(workers: int = 16) -> None:
    out = DATA_DIR / "index_rapidata.json"
    if out.exists():
        print(f"{out} exists, skipping")
        return
    jobs = [(repo, p) for repo in RAPIDATA_REPOS for p in sorted(fs.glob(f"{repo}/data/*.parquet"))]
    index: list[dict] = []
    with ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(scan_rapidata_file, repo, p) for repo, p in jobs]
        for fut in tqdm(as_completed(futures), total=len(jobs), desc="index_rapidata.json"):
            index.extend(fut.result())
    index.sort(key=lambda r: (r["file"], r["row_group"]))
    out.write_text(json.dumps(index))
    images = Counter()
    for r in index:
        for col in r["models"].values():
            images.update(col)
    print(f"wrote {out}: {len(index):,} row groups")
    for model, n in images.most_common():
        print(f"  {n:>7,}  {model}")


def scan_zr() -> None:
    """The held-out benchmark is a plain image folder: list the files, grouped by folder."""
    out = DATA_DIR / "index_zr.json"
    if out.exists():
        print(f"{out} exists, skipping")
        return
    files = [p for p in fs.find(f"{ZR_REPO}/images")
             if p.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    index = []
    for p in sorted(files):
        generator, category = p.split(f"{ZR_REPO}/images/", 1)[1].split("/")[:2]
        index.append({"file": p, "generator": generator, "category": category})
    out.write_text(json.dumps(index))
    print(f"wrote {out}: {len(index):,} images")
    for (g, c), n in sorted(Counter((r["generator"], r["category"]) for r in index).items()):
        print(f"  {n:>6}  {g} / {c}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["train", "eval", "rapidata", "zr"])
    args = ap.parse_args()
    if args.only in (None, "eval"):
        scan_repo(EVAL_REPO, "index_eval.json")
    if args.only in (None, "train"):
        scan_repo(TRAIN_REPO, "index_train.json")
    if args.only in (None, "rapidata"):
        scan_rapidata()
    if args.only in (None, "zr"):
        scan_zr()
