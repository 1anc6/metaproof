"""Quick experiment: do hand-made pixel measurements separate AI images from camera photos?

Each image is cut into 256 px tiles at its original resolution (never resized, which would
erase the traces) and measured: noise level and how it follows brightness, periodic peaks in
the noise spectrum, Bayer-pattern traces, cross-channel noise correlation, and flatness.

The AI and real sets usually differ in format and size too (PNG vs JPEG), so every image is
measured under three conditions, applied identically to both classes:
  native  the file as it is
  jpeg90  re-saved as JPEG quality 90 at full size
  matched long side 1408 px (the Gemini size), kept lossless: separates image size from JPEG
  social  long side 1080 px, JPEG quality 75 (a WhatsApp/Instagram-like copy)
A signal that only works on "native" is likely detecting the file format, not the generator.

Usage:
  python probe_pixels.py --ai DIR --real DIR [--check-ai GLOB --check-real GLOB] [--out FILE]
"""

import argparse
import glob
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, stats
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TILE = 256
MAX_TILES = 48
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
CONDITIONS = ("native", "jpeg90", "matched", "social")
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def apply_condition(img: Image.Image, condition: str) -> np.ndarray:
    img = img.convert("RGB")
    if condition in ("matched", "social"):
        w, h = img.size
        r = (1408 if condition == "matched" else 1080) / max(w, h)
        if r < 1:
            img = img.resize((round(w * r), round(h * r)), Image.BICUBIC)
    if condition in ("jpeg90", "social"):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90 if condition == "jpeg90" else 75)
        buf.seek(0)
        img = Image.open(buf).convert("RGB")
    return np.asarray(img, dtype=np.float32)


def residual(x: np.ndarray) -> np.ndarray:
    """High-pass residual: each pixel minus the mean of its 4 neighbours (content removed)."""
    k = np.array([[0, 0.25, 0], [0.25, 0, 0.25], [0, 0.25, 0]], dtype=np.float32)
    return x - ndimage.convolve(x, k, mode="reflect")


def tiles(rgb: np.ndarray, rng: np.random.Generator) -> list[np.ndarray]:
    h, w, _ = rgb.shape
    if h < TILE or w < TILE:
        return [rgb]
    ys = np.arange(0, h - TILE + 1, TILE)
    xs = np.arange(0, w - TILE + 1, TILE)
    grid = [(y, x) for y in ys for x in xs]
    if len(grid) > MAX_TILES:
        grid = [grid[i] for i in sorted(rng.choice(len(grid), MAX_TILES, replace=False))]
    return [rgb[y:y + TILE, x:x + TILE] for y, x in grid]


def peak_ratio(spectrum: np.ndarray, period: int) -> float:
    """Spectral energy at a given period (both axes) relative to the typical energy nearby."""
    n = spectrum.shape[0]
    f = n // period
    pts = [(f, 0), (0, f), (f, f)]
    peak = np.mean([spectrum[p] for p in pts])
    ring = []
    for py, px in pts:
        for dy in (-3, -2, 2, 3):
            for dx in (-3, -2, 2, 3):
                ring.append(spectrum[(py + dy) % n, (px + dx) % n])
    return float(np.log(peak / (np.median(ring) + 1e-9) + 1e-9))


def measure(rgb: np.ndarray, rng: np.random.Generator) -> dict[str, float]:
    ts = tiles(rgb, rng)
    luma_std, luma_mean, kurt, flat, corr_rg, corr_bg = [], [], [], [], [], []
    spec_y = np.zeros((TILE, TILE))
    spec_g = np.zeros((TILE, TILE))
    used = 0
    for t in ts:
        y = t @ LUMA
        ry = residual(y)
        s = float(ry.std())
        luma_std.append(s)
        luma_mean.append(float(y.mean()))
        flat.append(s < 0.6)
        if s < 0.6 or t.shape[0] != TILE or t.shape[1] != TILE:
            continue  # flat or partial tiles carry no usable noise
        used += 1
        kurt.append(float(stats.kurtosis(ry.ravel())))
        rr, rg, rb = (residual(t[..., c]) for c in range(3))
        corr_rg.append(float(np.corrcoef(rr.ravel(), rg.ravel())[0, 1]))
        corr_bg.append(float(np.corrcoef(rb.ravel(), rg.ravel())[0, 1]))
        spec_y += np.abs(np.fft.fft2(ry))
        spec_g += np.abs(np.fft.fft2(rg))

    luma_std = np.array(luma_std)
    luma_mean = np.array(luma_mean)
    # Noise-vs-brightness: on the calmer half of tiles, does noise rise with brightness, as
    # photon shot noise does in a camera?
    calm = luma_std <= np.median(luma_std)
    nb = stats.spearmanr(luma_mean[calm], luma_std[calm]).statistic if calm.sum() > 4 else 0.0

    out = {
        "noise_median": float(np.median(luma_std)),
        "noise_spread": float(np.percentile(luma_std, 90) / (np.percentile(luma_std, 10) + 1e-3)),
        "noise_vs_brightness": float(np.nan_to_num(nb)),
        "flat_fraction": float(np.mean(flat)),
        "residual_kurtosis": float(np.median(kurt)) if kurt else 0.0,
        "chan_corr_rg": float(np.median(corr_rg)) if corr_rg else 0.0,
        "chan_corr_bg": float(np.median(corr_bg)) if corr_bg else 0.0,
    }
    if used:
        for p in (2, 4, 8, 16):
            out[f"peak_period{p}"] = peak_ratio(spec_y / used, p)
        out["bayer_green_p2"] = peak_ratio(spec_g / used, 2)
    else:
        for p in (2, 4, 8, 16):
            out[f"peak_period{p}"] = 0.0
        out["bayer_green_p2"] = 0.0
    return out


def list_images(spec: str) -> list[Path]:
    p = Path(spec)
    paths = sorted(p.iterdir()) if p.is_dir() else sorted(Path(x) for x in glob.glob(spec))
    return [x for x in paths if x.suffix.lower() in IMAGE_EXT]


def measure_set(paths: list[Path], label: int) -> dict[str, list]:
    rows = {c: [] for c in CONDITIONS}
    for path in paths:
        with Image.open(path) as img:
            img.load()
            for c in CONDITIONS:
                rng = np.random.default_rng(0)
                feats = measure(apply_condition(img, c), rng)
                rows[c].append({"file": path.name, "label": label, **feats})
        print(f"  measured {path.name}")
    return rows


def leave_one_out(X: np.ndarray, y: np.ndarray) -> float:
    correct = 0
    for i in range(len(y)):
        keep = np.arange(len(y)) != i
        clf = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=1000))
        clf.fit(X[keep], y[keep])
        correct += int(clf.predict(X[i:i + 1])[0] == y[i])
    return correct / len(y)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ai", required=True)
    ap.add_argument("--real", required=True)
    ap.add_argument("--check-ai", help="other AI images, only used to test the signals")
    ap.add_argument("--check-real", help="other real images, only used to test the signals")
    ap.add_argument("--out", default="probe_results.json")
    args = ap.parse_args()

    print("main set")
    ai = measure_set(list_images(args.ai), 1)
    real = measure_set(list_images(args.real), 0)
    check = None
    if args.check_ai and args.check_real:
        print("check set")
        cai = measure_set(list_images(args.check_ai), 1)
        creal = measure_set(list_images(args.check_real), 0)
        check = {c: cai[c] + creal[c] for c in CONDITIONS}

    names = [k for k in ai["native"][0] if k not in ("file", "label")]
    report = {"features": {}, "loo_accuracy": {}, "check": {}, "rows": {}}
    for c in CONDITIONS:
        rows = ai[c] + real[c]
        report["rows"][c] = rows
        X = np.array([[r[n] for n in names] for r in rows])
        y = np.array([r["label"] for r in rows])
        for j, n in enumerate(names):
            entry = report["features"].setdefault(n, {})
            entry[c] = {
                "ai_median": round(float(np.median(X[y == 1, j])), 3),
                "real_median": round(float(np.median(X[y == 0, j])), 3),
                "auc": round(float(roc_auc_score(y, X[:, j])), 3),
            }
        report["loo_accuracy"][c] = round(leave_one_out(X, y), 3)
        if check:
            clf = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=1000))
            clf.fit(X, y)
            Xc = np.array([[r[n] for n in names] for r in check[c]])
            yc = np.array([r["label"] for r in check[c]])
            p = clf.predict_proba(Xc)[:, 1]
            report["check"][c] = {
                "accuracy": round(float(np.mean((p >= 0.5) == yc)), 3),
                "auc": round(float(roc_auc_score(yc, p)), 3),
                "per_image": {r["file"]: round(float(q), 2) for r, q in zip(check[c], p)},
            }
            report["rows"][f"check_{c}"] = check[c]

    Path(args.out).write_text(json.dumps(report, indent=2))

    # AUC 0.5 = no separation; near 0 or 1 = separates (direction does not matter here).
    print(f"\n{'feature':22}" + "".join(f"{c:>22}" for c in CONDITIONS))
    print(f"{'':22}" + "".join(f"{'AI / real / AUC':>22}" for _ in CONDITIONS))
    for n in names:
        cells = []
        for c in CONDITIONS:
            e = report["features"][n][c]
            cells.append(f"{e['ai_median']:>7.2f} {e['real_median']:>7.2f} {e['auc']:>5.2f}")
        print(f"{n:22}" + "".join(f"{x:>22}" for x in cells))
    print("\nleave-one-out accuracy (all features):",
          ", ".join(f"{c} {v:.0%}" for c, v in report["loo_accuracy"].items()))
    if check:
        print("check set, model trained on main set:",
              ", ".join(f"{c} acc {v['accuracy']:.0%} AUC {v['auc']:.2f}"
                        for c, v in report["check"].items()))


if __name__ == "__main__":
    main()
