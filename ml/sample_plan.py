"""Step 2: decide exactly what to download, per split.

Design choices (see ml/README.md):
- Split by GENERATOR: the test split contains only generators never seen in training, so the
  headline number measures generalization, not memorization.
- Real photos come from cheap sources (COCO, LAION, Landscapes, VISION phone photos, FFHQ/
  ImageNet), skipping 22 MB RAISE files.
- Small download budget (~17 GB), sampled at row-group granularity where possible.

    python sample_plan.py
"""

import json
import random
from collections import defaultdict

from common import DATA_DIR, EVAL_REPO, SEED, TRAIN_REPO

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
    ("COCO", 2), ("LandscapesHQ", 1), ("VISION", 1),   # real photos
    ("SYSTEMATIC_FAKE", 2),                             # ~6k images from thousands of SD variants
]


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


def main():
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

    total_gb = 0.0
    for split, items in plan.items():
        n, gb = sum(i["rows"] for i in items), sum(i["bytes"] for i in items) / 1e9
        total_gb += gb
        print(f"{split:<8} {len(items):>5} chunks  {n:>6} images  {gb:6.1f} GB")
        (DATA_DIR / f"plan_{split}.json").write_text(json.dumps(items, indent=1))
    print(f"total download ~{total_gb:.1f} GB")


if __name__ == "__main__":
    main()
