"""Precision, recall, F1, ROC-AUC and confusion matrices for the shipped detector (v3).

Scores the cached CLIP features of the held-out splits with the trained head (the same
weights and temperature that were exported to the live ONNX model; the 8-bit export differs
from fp32 by 0.003 on average, see eval_onnx.py) and reports the metrics at the three
thresholds the API uses (backend/app/analyzers/detector.py): 0.5 (the usual decision point),
0.79 (weak evidence) and 0.91 (strong evidence). "AI" is the positive class.

Splits: heldout / heldout-hard are the nine generators never seen in training, as-is and
after recompression (50% downscale, JPEG q60); heldout2 / heldout2-hard are the 2026
generators (Nano Banana, FLUX.2, GPT Image 2, Qwen Image 2.1), as-is and recompressed.

Needs torch (to load the head), so run it in the training venv:

    D:/metaproof/venv/Scripts/python.exe eval_metrics.py

Writes results_metrics.json here and confusion-matrix PNGs to ../docs/images/.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support, roc_auc_score

from common import DATA_DIR
from train import Head, head_input, load_split

THRESHOLDS = [0.5, 0.79, 0.91]
SPLITS = ["heldout", "heldout-hard", "heldout2", "heldout2-hard"]
HERE = Path(__file__).resolve().parent
IMAGES = HERE.parent / "docs" / "images"


def score(split: dict, ckpt: dict) -> np.ndarray:
    head = Head(ckpt["dim"])
    head.load_state_dict(ckpt["state_dict"])
    head.eval()
    with torch.no_grad():
        z = head(torch.tensor(head_input(split["features"]), dtype=torch.float32)).numpy()
    return 1 / (1 + np.exp(-z / ckpt["temperature"]))


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    out = {"n": int(len(y)), "ai": int(y.sum()), "real": int((1 - y).sum()),
           "auc": round(float(roc_auc_score(y, p)), 4), "at": {}}
    for t in THRESHOLDS:
        pred = (p >= t).astype(int)
        tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
        pr, rc, f1, _ = precision_recall_fscore_support(y, pred, average="binary",
                                                         pos_label=1, zero_division=0)
        out["at"][str(t)] = {
            "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn),
            "accuracy": round(float((tp + tn) / len(y)), 4),
            "precision": round(float(pr), 4), "recall": round(float(rc), 4),
            "f1": round(float(f1), 4),
            "false_positive_rate": round(float(fp / max(fp + tn, 1)), 4),
        }
    return out


def per_generator(split: dict, p: np.ndarray) -> dict:
    """Each generator's images against all real images in the split (one-vs-real)."""
    y, model = split["label"].astype(int), split["model"]
    real = y == 0
    out = {}
    for g in sorted(np.unique(model[y == 1])):
        m = (model == g) & (y == 1)
        keep = m | real
        out[str(g)] = metrics(y[keep], p[keep])
    return out


def font(size: int):
    for name in ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def draw_confusion(path: Path, title: str, rows: list[tuple[str, dict]]) -> None:
    """One 2x2 matrix per threshold, side by side. Cell shade = share of the true class."""
    cell, pad, top = 150, 40, 90
    w = pad + len(rows) * (2 * cell + pad) + 20
    h = top + 2 * cell + 90
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    d.text((pad, 16), title, fill="#111", font=font(22))
    for i, (label, c) in enumerate(rows):
        x0 = pad + i * (2 * cell + pad)
        d.text((x0, top - 40), label, fill="#111", font=font(17))
        grid = [[c["tn"], c["fp"]], [c["fn"], c["tp"]]]  # rows: true real, true AI
        for r in range(2):
            total = sum(grid[r])
            for k in range(2):
                v = grid[r][k]
                share = v / total if total else 0
                good = r == k
                base = (31, 119, 180) if good else (214, 39, 40)
                shade = tuple(int(255 - (255 - b) * (0.12 + 0.78 * share)) for b in base)
                x, y = x0 + k * cell, top + r * cell
                d.rectangle([x, y, x + cell - 2, y + cell - 2], fill=shade)
                dark = share > 0.55
                d.text((x + cell / 2, y + cell / 2 - 12), f"{v:,}", fill="white" if dark else "#111",
                       font=font(24), anchor="mm")
                d.text((x + cell / 2, y + cell / 2 + 16), f"{share:.1%}",
                       fill="white" if dark else "#444", font=font(15), anchor="mm")
        for k, name in enumerate(["pred. real", "pred. AI"]):
            d.text((x0 + k * cell + cell / 2, top + 2 * cell + 14), name, fill="#333",
                   font=font(14), anchor="mm")
        for r, name in enumerate(["real", "AI"]):
            d.text((x0 - 6, top + r * cell + cell / 2), name, fill="#333", font=font(14),
                   anchor="rm")
        d.text((x0 + cell, top + 2 * cell + 44),
               f"P {c['precision']:.3f}  R {c['recall']:.3f}  F1 {c['f1']:.3f}", fill="#111",
               font=font(15), anchor="mm")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--head", default=str(DATA_DIR / "head_vitb16.v3.pt"))
    ap.add_argument("--backbone", default="vitb16")
    args = ap.parse_args()

    ckpt = torch.load(args.head)
    results = {"head": Path(args.head).name, "temperature": ckpt["temperature"],
               "thresholds": THRESHOLDS, "splits": {}}
    for name in SPLITS:
        s = load_split(name, args.backbone)
        p, y = score(s, ckpt), s["label"].astype(int)
        r = metrics(y, p)
        r["per_generator"] = per_generator(s, p)
        results["splits"][name] = r
        print(f"{name:<14} n={r['n']} auc={r['auc']}", {t: (v["precision"], v["recall"], v["f1"])
                                                         for t, v in r["at"].items()})
        rows = [(f"threshold {t}", r["at"][str(t)]) for t in THRESHOLDS]
        draw_confusion(IMAGES / f"confusion_{name}.png",
                       f"Confusion matrices: {name} (n={r['n']:,}; {r['ai']:,} AI, {r['real']:,} real)",
                       rows)
    (HERE / "results_metrics.json").write_text(json.dumps(results, indent=2))
    print("wrote results_metrics.json and", IMAGES)


if __name__ == "__main__":
    main()
