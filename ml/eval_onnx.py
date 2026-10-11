"""Step 6: check the exported ONNX models on real held-out images, end to end.

Uses the backend's own preprocessing (backend/app/analyzers/detector.py), so this measures
exactly what the live API will compute, and compares int8 against fp32.

    python eval_onnx.py --backbone vitb16 --chunks 24
"""

import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import HfFileSystem
from PIL import Image
from sklearn.metrics import roc_auc_score

from common import DATA_DIR, SEED
from extract_features import read_chunk

BACKEND_DETECTOR = Path(__file__).resolve().parent.parent / "backend/app/analyzers/detector.py"


def backend_preprocess():
    """Load preprocess() from the backend file without importing the whole backend package."""
    src = BACKEND_DETECTOR.read_text(encoding="utf-8").replace(
        "from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength",
        "from types import SimpleNamespace as _NS\n"
        "AnalyzerResult = Finding = MediaInfo = None\n"
        "Signal = _NS(ai=0, authentic=1, neutral=2)\n"
        "Strength = _NS(strong=0, moderate=1, weak=2)",
    )
    ns: dict = {}
    exec(compile(src, str(BACKEND_DETECTOR), "exec"), ns)
    return ns["preprocess"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="vitb16")
    ap.add_argument("--chunks", type=int, default=24)
    ap.add_argument("--variants", default="fp32,int8", help="compared against the first one")
    args = ap.parse_args()

    preprocess = backend_preprocess()
    plan = json.loads((DATA_DIR / "plan_heldout.json").read_text())
    random.Random(SEED).shuffle(plan)
    fs = HfFileSystem()
    sessions = {
        name: ort.InferenceSession(str(DATA_DIR / "export" / f"detector_{args.backbone}_{name}.onnx"),
                                   providers=["CPUExecutionProvider"])
        for name in args.variants.split(",")
    }
    probs = {k: [] for k in sessions}
    labels = []
    for item in plan[: args.chunks]:
        table = read_chunk(item, fs, DATA_DIR / "tmp").to_pydict()
        for data, label in zip(table["image_data"], table["label"]):
            x = preprocess(Image.open(io.BytesIO(data)))
            for name, sess in sessions.items():
                probs[name].append(float(sess.run(None, {"pixels": x})[0][0]))
            labels.append(int(label))
    y = np.array(labels)
    out = {"n": len(y), "fake": int(y.sum())}
    for name, p in probs.items():
        p = np.array(p)
        out[name] = {"auc": round(float(roc_auc_score(y, p)), 4),
                     "acc@0.5": round(float(((p >= 0.5) == y).mean()), 4)}
    base, *others = args.variants.split(",")
    for name in others:
        diff = np.abs(np.array(probs[name]) - np.array(probs[base]))
        out[f"{name}_vs_{base}"] = {"mean_abs_diff": round(float(diff.mean()), 4),
                                    "p95_abs_diff": round(float(np.percentile(diff, 95)), 4),
                                    "max_abs_diff": round(float(diff.max()), 4)}
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
