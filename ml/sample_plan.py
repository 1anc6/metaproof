"""Step 2: decide exactly what to download, per split.

Design choices (see ml/README.md):
- Split by GENERATOR: the test split contains only generators never seen in training, so the
  headline number measures generalization, not memorization.
- Real photos come from cheap sources (COCO, LAION, Landscapes, VISION phone photos, FFHQ/
  ImageNet), skipping 22 MB RAISE files.
- Small download budget (~17 GB), sampled at row-group granularity where possible.

v2 adds newer generators (2025-26) without changing anything above, so v1 chunks that are
already extracted are reused:
- Rapidata: generators with role "train" in common.RAPIDATA_MODELS join train/calib (the
  calibration share is chosen per image by content hash, so a repeated image cannot end up on
  both sides). Role "heldout" (Nano Banana, FLUX.2) goes to a new test split, heldout2.
- zr-zhang benchmark: GPT Image 2, Nano Banana 2, Qwen Image 2.1, FLUX.2 and real photos, in
  heldout2 only.
- More COCO and Landscapes photos keep the training classes roughly balanced.
- Local folders (default: Images/ at the repo root, git-ignored) become a third test split,
  "local", for checking the detector on your own images.

    python sample_plan.py
"""

import argparse
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

from common import DATA_DIR, EVAL_REPO, RAPIDATA_MODELS, SEED, TRAIN_REPO, ZR_REPO

TRAIN_GENERATORS = [
    "DFGAN", "GALIP", "Hourglass", "Dalle2", "IdeogramV1", "MidjourneyV5_2", "Firefly_Image2",
    "kandinsky_2_2", "LCM_lora_sdv15", "LCM_lora_ssd1b", "DeciDiffusionV2", "kvikontent_midjourney_v6",
]
HELDOUT_GENERATORS = [
    "FLUX-dev", "FLUX-schnell", "MidjourneyV6_1", "Dalle3", "Firefly_Image3", "IdeogramV2",
    "Imagen3", "stable_cascade", "LCM_lora_sdxl",
]
FAKES_PER_TRAIN_GEN = 600
FAKES_PER_HELDOUT_GEN = 300
REAL_LAION_TRAIN = 3000         # cheap LAION reals paired with train generators
REAL_LAION_TEST = 1500          # LAION reals paired with held-out generators
REAL_FFHQ_IMAGENET = 600        # Hourglass pairs: faces and objects
CALIB_FRACTION = 0.1
MAX_REAL_MB_PER_IMAGE = 2.0     # skips RAISE raw photos (~22 MB each)

# Whole files from the Small set: (model_name in the footer, number of files).
SMALL_FILES = [
    ("COCO", 5), ("LandscapesHQ", 2), ("VISION", 1),   # real photos (v1: COCO 2, Landscapes 1)
    ("SYSTEMATIC_FAKE", 2),                             # ~6k images from thousands of SD variants
]

# v2: newer generators.
NEW_FAKES_PER_TRAIN_GEN = 600
NEW_FAKES_PER_HELDOUT_GEN = 300
# Rapidata row groups mix a featured model with a few images from many others, and repeat
# images across rows (a row group of 200 images can hold only 76 distinct ones). Which images
# repeat is only known once downloaded, so the plan lists candidates for RAW_OVERSAMPLE times
# the target, and extract_features.py stops at the target ("cap") of distinct images.
RAW_OVERSAMPLE = 3
# A row group is only a candidate while it fills at least this many missing images per GB.
MIN_NEW_IMAGES_PER_GB = 150
ZR_PER_GENERATOR = 300          # split evenly over its three categories
ZR_REAL = 900
FILES_PER_CHUNK = 50
REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_AI = REPO_ROOT / "Images" / "AI Images"
LOCAL_REAL = REPO_ROOT / "Images" / "Real Raw Images"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def pure(rg: dict) -> bool:
    """Row group from a single generator with a single label."""
    return ".." not in str(rg["model_name"]) and rg["label"] in (0, 1)


def take_row_groups(groups: list[dict], target: int, rng: random.Random) -> list[dict]:
    groups = groups[:]
    rng.shuffle(groups)
    picked, n = [], 0
    for g in groups:
        if n >= target:
            break
        picked.append(g)
        n += g["rows"]
    return picked


def pick_rapidata(index: list[dict], role: str, target: int, rng: random.Random) -> list[dict]:
    """Greedy: keep taking the row group that fills the most missing images per byte.

    Returns candidates in order of value; extraction stops each generator at `target`."""
    need = {name: target * RAW_OVERSAMPLE for name, r in RAPIDATA_MODELS.values() if r == role}
    groups = []
    for rg in index:
        counts, keep = Counter(), set()
        for col in rg["models"].values():
            for raw, n in col.items():
                name, r = RAPIDATA_MODELS.get(raw, (None, None))
                if r == role:
                    counts[name] += n
                    keep.add(raw)
        if counts:
            groups.append((rg, counts, keep))
    rng.shuffle(groups)  # ties are broken at random, not by file order
    picked = []
    while True:
        best, best_rate = None, MIN_NEW_IMAGES_PER_GB
        for i, (rg, counts, _) in enumerate(groups):
            rate = sum(min(n, need[g]) for g, n in counts.items()) / (rg["bytes"] / 1e9)
            if rate > best_rate:
                best, best_rate = i, rate
        if best is None:
            break
        rg, counts, keep = groups.pop(best)
        for g, n in counts.items():
            need[g] = max(0, need[g] - n)
        repo = rg["repo"].split("/")[-1]
        stem = rg["file"].split("/")[-1].replace(".parquet", "")
        picked.append({"repo": rg["repo"], "file": rg["file"], "row_group": rg["row_group"],
                       "rows": sum(counts.values()), "bytes": rg["bytes"], "kind": "pairs",
                       "keep": sorted(keep), "key": f"{repo}_{stem}_rg{rg['row_group']}",
                       "expected": dict(counts), "cap": target})
    short = {g: n for g, n in need.items() if n > target * (RAW_OVERSAMPLE - 1)}
    if short:
        print(f"  {role}: possibly fewer than {target} distinct images for {sorted(short)}")
    return picked


def file_chunks(paths: list[str], label: int, model: str, source: str, key: str,
                bytes_per_file: float = 0) -> list[dict]:
    """Single image files, grouped so one plan item is one unit of download and resume."""
    items = []
    for i in range(0, len(paths), FILES_PER_CHUNK):
        part = paths[i:i + FILES_PER_CHUNK]
        items.append({"kind": "files", "files": part, "label": label, "model": model,
                      "source": source, "rows": len(part),
                      "bytes": int(len(part) * bytes_per_file),
                      "key": re.sub(r"[^A-Za-z0-9._-]+", "-", f"{key}_{i // FILES_PER_CHUNK}")})
    return items


def plan_zr(rng: random.Random) -> list[dict]:
    index = json.loads((DATA_DIR / "index_zr.json").read_text())
    by = defaultdict(list)
    for r in index:
        by[(r["generator"], r["category"])].append(r["file"])
    items = []
    for (gen, cat), files in sorted(by.items()):
        files = sorted(files)
        rng.shuffle(files)
        real = gen == "Real"
        n = (ZR_REAL if real else ZR_PER_GENERATOR) // 3
        source = f"zr:{cat.removesuffix(' Images')}"
        items += file_chunks(files[:n], 0 if real else 1, "" if real else gen,
                             source if real else "", f"zr_{gen}_{cat}",
                             0.1e6 if real else 1.5e6)  # typical sizes: small JPEGs vs PNGs
    return items


def plan_local(ai_dir: Path, real_dir: Path) -> list[dict]:
    items = []
    for d, label, model, source in ((ai_dir, 1, "local-ai", ""), (real_dir, 0, "", "local")):
        if d.is_dir():
            files = sorted(str(p) for p in d.iterdir() if p.suffix.lower() in IMAGE_EXT)
            items += file_chunks(files, label, model, source, f"local_{label}")
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local-ai", type=Path, default=LOCAL_AI)
    ap.add_argument("--local-real", type=Path, default=LOCAL_REAL)
    args = ap.parse_args()
    rng = random.Random(SEED)
    ev = [r for r in json.loads((DATA_DIR / "index_eval.json").read_text()) if pure(r)]
    by = defaultdict(list)
    for r in ev:
        by[(r["model_name"], r["label"])].append(r)

    plan: dict[str, list[dict]] = {"train": [], "calib": [], "heldout": []}

    def add(split_groups: list[dict], split: str, repo: str):
        for g in split_groups:
            plan[split].append({"repo": repo, "file": g["file"], "row_group": g["row_group"],
                                "rows": g["rows"], "bytes": g["bytes"]})

    # Fakes: seen generators go to train/calib, unseen ones only to the held-out test.
    for gen in TRAIN_GENERATORS:
        picked = take_row_groups(by[(gen, 1)], FAKES_PER_TRAIN_GEN, rng)
        cut = max(1, round(len(picked) * CALIB_FRACTION))
        add(picked[cut:], "train", EVAL_REPO)
        add(picked[:cut], "calib", EVAL_REPO)
    for gen in HELDOUT_GENERATORS:
        add(take_row_groups(by[(gen, 1)], FAKES_PER_HELDOUT_GEN, rng), "heldout", EVAL_REPO)

    # Cheap real photos paired with the same generators (same content domain as the fakes).
    def cheap_reals(gens):
        return [g for gen in gens for g in by[(gen, 0)]
                if g["bytes"] / g["rows"] <= MAX_REAL_MB_PER_IMAGE * 1e6]

    train_reals = take_row_groups(cheap_reals(TRAIN_GENERATORS), REAL_LAION_TRAIN + REAL_FFHQ_IMAGENET, rng)
    cut = max(1, round(len(train_reals) * CALIB_FRACTION))
    add(train_reals[cut:], "train", EVAL_REPO)
    add(train_reals[:cut], "calib", EVAL_REPO)
    add(take_row_groups(cheap_reals(HELDOUT_GENERATORS), REAL_LAION_TEST, rng), "heldout", EVAL_REPO)

    # Whole files from the Small set (one row group each).
    small = json.loads((DATA_DIR / "index_train.json").read_text())
    for name, count in SMALL_FILES:
        if name == "SYSTEMATIC_FAKE":
            pool = [r for r in small if r["label"] == 1 and r["subset"] == "Systematic"]
        else:
            pool = [r for r in small if r["label"] == 0 and r["model_name"] == name]
        pool.sort(key=lambda r: r["file"])
        rng.shuffle(pool)
        for r in pool[:count]:
            plan["train"].append({"repo": TRAIN_REPO, "file": r["file"], "row_group": r["row_group"],
                                  "rows": r["rows"], "bytes": r["bytes"], "whole_file": True,
                                  "calib_fraction": CALIB_FRACTION})

    # v2: newer generators, with their own random stream so the v1 plan above stays identical.
    rng2 = random.Random(f"{SEED}-v2")
    plan["heldout2"], plan["local"] = [], []
    rapidata = json.loads((DATA_DIR / "index_rapidata.json").read_text())
    for item in pick_rapidata(rapidata, "train", NEW_FAKES_PER_TRAIN_GEN, rng2):
        plan["train"].append({**item, "calib_by_hash": CALIB_FRACTION})
    plan["heldout2"] += pick_rapidata(rapidata, "heldout", NEW_FAKES_PER_HELDOUT_GEN, rng2)
    plan["heldout2"] += plan_zr(rng2)
    plan["local"] += plan_local(args.local_ai, args.local_real)

    # Candidate images per new generator, counting repeats; extraction keeps up to the cap.
    expected = defaultdict(Counter)
    for split in ("train", "heldout2"):
        for item in plan[split]:
            if item.get("kind") == "pairs":
                expected[split].update(item["expected"])
            elif item.get("kind") == "files":
                expected[split][item["model"] or f"real {item['source']}"] += item["rows"]
    for split, counts in expected.items():
        print(f"new candidate images in {split} (with repeats):")
        for g, n in sorted(counts.items()):
            print(f"  {n:>6}  {g}")

    total_gb = 0.0
    for split, items in plan.items():
        n, gb = sum(i["rows"] for i in items), sum(i["bytes"] for i in items) / 1e9
        total_gb += gb
        print(f"{split:<8} {len(items):>5} chunks  {n:>6} images  {gb:6.1f} GB")
        (DATA_DIR / f"plan_{split}.json").write_text(json.dumps(items, indent=1))
    print(f"total download up to ~{total_gb:.1f} GB (Rapidata candidates stop early at their caps)")


if __name__ == "__main__":
    main()
