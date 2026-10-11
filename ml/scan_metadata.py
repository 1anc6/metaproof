"""Step 1: index the datasets by reading only Parquet footers (no images, no columns).

Each file's footer stores, per row group (~25 images), the min and max of every column.
Row groups here come from a single generator and real source, so min/max tells us what a
row group contains for about one HTTP request per file. Exact per-image labels are read
later, together with the images.

    python scan_metadata.py            # both datasets
    python scan_metadata.py --only eval
"""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem
from tqdm import tqdm

from common import DATA_DIR, EVAL_REPO, TRAIN_REPO

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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["train", "eval"])
    args = ap.parse_args()
    if args.only in (None, "eval"):
        scan_repo(EVAL_REPO, "index_eval.json")
    if args.only in (None, "train"):
        scan_repo(TRAIN_REPO, "index_train.json")
