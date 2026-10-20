"""Can detector v5 ship? False alarms on real camera photos versus catches on new generators.

Scores the real-photo calibration set (real_photos.py: original phone and camera files plus
their social-media copies) with v3 (live) and v5 (full-resolution crops), and compares
decision rules for the "strong" band, where the detector alone can decide a verdict:

  v3          v3 >= 0.91, as shipped
  v5          v5 >= t
  v5&global   v5 >= t and v3 >= g: the global 256 px view must agree with the crops
  v5&crops    v5 >= t and every crop, scored on its own with the global view, >= c

Thresholds are chosen on half of the devices (by a hash of the device name) and the false-
alarm rate is reported on the other half, with a 95% Clopper-Pearson interval, so the rate
isn't flattered by the search. The bar: the upper end of that interval stays at or below
1.3% (v3's rate on its own test). Catches are reported on the zr-zhang benchmark's held-out
generators (Nano Banana 2, GPT Image 2, Qwen Image 2.1, FLUX.2).

    python eval_realcal.py                 # features only (GPU extraction already done)
    python eval_realcal.py --onnx          # also score every file with the live ONNX model
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from scipy.stats import beta

from common import DATA_DIR
from compare_heads import load_head
from train import load_split, logits

BAR = 0.013
ZR = ["Nano Banana 2", "GPT Image 2", "Qwen Image 2.1", "FLUX.2"]
V3_BANDS = {"strong": 0.91, "weak": 0.79, "likely_real_below": 0.05}


def ci(k: int, n: int) -> tuple[float, float]:
    """95% Clopper-Pearson interval for k events in n trials."""
    lo = beta.ppf(0.025, k, n - k + 1) if k else 0.0
    hi = beta.ppf(0.975, k + 1, n - k) if k < n else 1.0
    return float(lo), float(hi)


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


class Scorer:
    """All scores one image needs, from its five stored views."""

    def __init__(self, v5: str = "head_vitb16n.v5.pt"):
        self.v3, self.t3, _ = load_head("head_vitb16.v3.pt")
        self.v5, self.t5, _ = load_head(v5)

    def __call__(self, f: np.ndarray, crops: list[int] | None = None) -> dict[str, np.ndarray]:
        f = f.astype(np.float32)
        g = f[:, 0]
        c = f[:, 1:] if crops is None else f[:, [1 + i for i in crops]]
        out = {"v3": sigmoid(logits(self.v3, g) / self.t3),
               "v5": sigmoid(logits(self.v5, np.concatenate([g, c.mean(1)], 1)) / self.t5)}
        per_crop = np.stack([sigmoid(logits(self.v5, np.concatenate([g, c[:, i]], 1)) / self.t5)
                             for i in range(c.shape[1])], 1)
        out["crop_min"] = per_crop.min(1)
        return out


def seen_in_training(features: np.ndarray, threshold: float = 0.95) -> np.ndarray:
    """Photos whose global view nearly matches a training or calibration real image.

    Community Forensics includes VISION photos (resized), and VISION shoots the same scenes
    many times, so these are dropped to keep the test independent."""
    q = features[:, 0].astype(np.float32)
    best = np.full(len(q), -1.0, np.float32)
    for split in ("train", "calib"):
        f = load_split(split, "vitb16n")
        k = f["features"][f["label"] == 0][:, 0].astype(np.float32)
        for i in range(0, len(k), 10000):
            best = np.maximum(best, (q @ k[i:i + 10000].T).max(1))
    return best >= threshold


def half_of(device: str) -> int:
    return int(hashlib.sha1(device.encode()).hexdigest()[:8], 16) % 2


def rules(s: dict, t: float, g: float, c: float) -> dict[str, np.ndarray]:
    return {"v3": s["v3"] >= V3_BANDS["strong"],
            "v5": s["v5"] >= t,
            "v5&global": (s["v5"] >= t) & (s["v3"] >= g),
            "v5&crops": (s["v5"] >= t) & (s["crop_min"] >= c)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", action="store_true", help="score files with the live ONNX model")
    ap.add_argument("--v5", default="head_vitb16n.v5.pt",
                    help="full-resolution head to test (in DATA_DIR), e.g. a retrained one")
    ap.add_argument("--out", default="results_realcal.json")
    args = ap.parse_args()
    score = Scorer(args.v5)
    print(f"candidate: {args.v5}")

    real = {name: load_split(name, "vitb16n") for name in ("realcal", "realcal-social")}
    for name, s in real.items():
        seen = seen_in_training(s["features"])
        print(f"{name}: dropped {int(seen.sum())} photos seen in training "
              f"({', '.join(sorted(set(x.split(':')[0] for x in s['source'][seen])))})")
        s.update({k: v[~seen] for k, v in s.items()})
        s.update(score(s["features"]))
        s["half"] = np.array([half_of(d) for d in s["source"]])
    h2 = {name: load_split(name, "vitb16n") for name in ("heldout2", "heldout2-hard")}
    for s in h2.values():
        s.update(score(s["features"]))
    v1 = {name: load_split(name, "vitb16n") for name in ("heldout", "heldout-hard")}
    for s in v1.values():
        s.update(score(s["features"]))
    zr_real = {k: s["label"] == 0 for k, s in h2.items()}
    zr_ai = {k: np.isin(s["model"], ZR) for k, s in h2.items()}

    o, so = real["realcal"], real["realcal-social"]
    print(f"real photos: {len(o['label'])} originals from {len(set(o['source']))} devices, "
          f"{len(so['label'])} social copies")

    # --- 1. False alarms per band, v3 and plain v5, whole set --------------------------------
    print("\nReal photos at or above each score (originals / social copies)")
    for thr in (0.5, 0.79, 0.85, 0.91, 0.95, 0.98, 0.99):
        cells = []
        for m in ("v3", "v5"):
            for s in (o, so):
                k, n = int((s[m] >= thr).sum()), len(s[m])
                cells.append(f"{k:4}/{n} {k / n:5.1%}")
        print(f"  >= {thr:4}: v3 {cells[0]} | {cells[1]}   v5 {cells[2]} | {cells[3]}")

    print("\nPer source, v5 >= 0.95 (originals / social)")
    groups = sorted(set(d.split(":")[0] for d in o["source"]))
    for grp in groups:
        m1 = np.char.startswith(o["source"].astype(str), grp)
        m2 = np.char.startswith(so["source"].astype(str), grp)
        print(f"  {grp:8} n={m1.sum():4}  v3>=.91 {(o['v3'][m1] >= .91).mean():5.1%} / "
              f"{(so['v3'][m2] >= .91).mean():5.1%}   v5>=.95 {(o['v5'][m1] >= .95).mean():5.1%} / "
              f"{(so['v5'][m2] >= .95).mean():5.1%}")
    worst = sorted(((float(np.mean(o["v5"][o["source"] == d] >= .95)), d) for d in set(o["source"])),
                   reverse=True)[:8]
    print("  devices with most v5 >= 0.95:", ", ".join(f"{d} {r:.0%}" for r, d in worst if r))

    # --- 2. Grid search on half A ------------------------------------------------------------
    def fpr(mask_fn, half=None):
        """Worst of originals and social copies; also the zr real photos (all halves)."""
        rates = []
        for s in (o, so):
            sel = np.ones(len(s["v5"]), bool) if half is None else s["half"] == half
            rates.append((int(mask_fn(s)[sel].sum()), int(sel.sum())))
        return rates

    def catch(mask_fn, split="heldout2"):
        s = h2[split]
        return {g: float(mask_fn(s)[s["model"] == g].mean()) for g in ZR}

    grid_t = [0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.985, 0.99, 0.995]
    grid_g = [0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.79]
    grid_c = [0.0, 0.5, 0.7, 0.8, 0.9, 0.95]
    best = {}
    for name in ("v5", "v5&global", "v5&crops"):
        for t in grid_t:
            for g in (grid_g if name == "v5&global" else [0.0]):
                for c in (grid_c if name == "v5&crops" else [0.0]):
                    fn = lambda s, t=t, g=g, c=c: rules(s, t, g, c)[name]
                    # On half A: the point estimate must leave room for the interval (<= 0.6%)
                    # and the zr real photos must stay at or below v3's rate there.
                    a = fpr(fn, half=0)
                    if max(k / n for k, n in a) > 0.006:
                        continue
                    zr_fp = fn(h2["heldout2"])[zr_real["heldout2"]].mean()
                    if zr_fp > max(0.002, rules(h2["heldout2"], 0, 0, 0)["v3"][zr_real["heldout2"]].mean()):
                        continue
                    c4 = np.mean(list(catch(fn).values()))
                    if c4 > best.get(name, (0,))[0]:
                        best[name] = (c4, t, g, c)

    # --- 3. Report on half B and on everything -------------------------------------------------
    print("\nStrong band, thresholds chosen on half A of the devices, reported on half B")
    print(f"{'rule':10}{'t':>6}{'g':>6}{'c':>6}  {'half B orig':>22}{'half B social':>22}"
          f"{'all orig':>22}{'all social':>22}{'zr real':>8}   catch NB2 / GPT2 / Qwen / FLUX.2  (recompressed)")
    summary = {}
    choices = [("v3", 0.91, 0, 0)] + [(n, *best[n][1:]) for n in ("v5", "v5&global", "v5&crops") if n in best]
    for name, t, g, c in choices:
        fn = lambda s, t=t, g=g, c=c: rules(s, t, g, c)[name]
        b, al = fpr(fn, half=1), fpr(fn)
        cells = []
        for k, n in b + al:
            lo, hi = ci(k, n)
            cells.append(f"{k:3}/{n:4} {k / n:4.1%} [≤{hi:4.1%}]")
        zr_fp = fn(h2["heldout2"])[zr_real["heldout2"]].mean()
        cat, cat_h = catch(fn), catch(fn, "heldout2-hard")
        print(f"{name:10}{t:6}{g:6}{c:6}  " + "".join(f"{x:>22}" for x in cells) + f"{zr_fp:8.1%}   "
              + " / ".join(f"{cat[z]:4.0%}" for z in ZR) + "  ("
              + " / ".join(f"{cat_h[z]:4.0%}" for z in ZR) + ")")
        v1c = fn(v1["heldout"])[v1["heldout"]["label"] == 1].mean()
        v1f = fn(v1["heldout"])[v1["heldout"]["label"] == 0].mean()
        summary[name] = {"t": t, "g": g, "c": c, "half_b": b, "all": al, "zr_real_fp": float(zr_fp),
                         "catch": cat, "catch_recompressed": cat_h,
                         "v1_test_catch": float(v1c), "v1_test_real_fp": float(v1f),
                         "upper95_all": [ci(k, n)[1] for k, n in al]}
        print(f"{'':10}v1 test (2023-24 generators): catches {v1c:.0%}, flags {v1f:.1%} of its real images")

    # --- 4. Cheaper variants: two crops, and crops only when the global view is unsure --------
    print("\nCheaper variants of v5&global (same thresholds)")
    if "v5&global" in best:
        _, t, g, c = best["v5&global"]
        for label, crops in (("4 crops", None), ("2 crops (centre, lower)", [0, 3]),
                             ("2 crops (upper corners)", [1, 2])):
            ks = []
            for s in (o, so, h2["heldout2"]):
                sc = score(s["features"], crops)
                ks.append((sc["v5"] >= t) & (sc["v3"] >= g))
            k1, k2 = int(ks[0].sum()), int(ks[1].sum())
            hs = h2["heldout2"]
            cat = " / ".join(f"{ks[2][hs['model'] == z].mean():4.0%}" for z in ZR)
            print(f"  {label:26} real flagged {k1}/{len(ks[0])} orig, {k2}/{len(ks[1])} social;  catch {cat}")
        # Cascade: run the crops only if v3 >= g; otherwise the rule can't fire anyway.
        for s, nm in ((o, "real originals"), (h2["heldout2"], "heldout2 (all)")):
            print(f"  crops needed only when v3 >= {g}: {(s['v3'] >= g).mean():.0%} of {nm}")

    out = Path(__file__).with_name(args.out)
    out.write_text(json.dumps(summary, indent=2))
    print("\nsaved", out.name)

    if args.onnx:
        onnx_check(o, so)


def onnx_check(o, so):
    """The live model on the actual files, with the backend's own preprocessing."""
    import onnxruntime as ort
    from PIL import Image
    from eval_onnx import backend_preprocess

    preprocess = backend_preprocess()
    model = Path(__file__).resolve().parents[1] / "backend/models/detector.onnx"
    if not model.exists():  # git worktrees share the main checkout's model
        model = Path(__file__).resolve().parents[4] / "backend/models/detector.onnx"
    sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    plans = {n: json.loads((DATA_DIR / f"plan_{n}.json").read_text()) for n in ("realcal", "realcal-social")}
    for name, plan in plans.items():
        p = []
        for item in plan:
            for f in item["files"]:
                with Image.open(f) as img:
                    p.append(float(sess.run(None, {"pixels": preprocess(img)})[0][0]))
        p = np.array(p)
        for thr in (0.79, 0.91):
            k = int((p >= thr).sum())
            print(f"live ONNX v3, {name}: {k}/{len(p)} ({k / len(p):.1%}) >= {thr}, "
                  f"upper 95% {ci(k, len(p))[1]:.1%}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
