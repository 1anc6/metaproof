"""Step 4: train the detector head on CLIP features, calibrate it, and report honest metrics.

The head is a small MLP on frozen CLIP image embeddings (the UnivFD idea: foundation-model
features generalize to unseen generators better than a network trained from scratch).
Calibration uses temperature scaling on a held-out split, so 0.8 means roughly 80%.

    python train.py --backbone vitb32
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import accuracy_score, roc_auc_score

from common import DATA_DIR, SEED


def load_split(split: str, backbone: str) -> dict:
    files = sorted((DATA_DIR / "features" / f"{split}_{backbone}").glob("*.npz"))
    if not files:
        raise SystemExit(f"no features for {split}/{backbone}; run extract_features.py first")
    parts = [np.load(f) for f in files]
    return {k: np.concatenate([p[k] for p in parts]) for k in parts[0].files}


class Head(torch.nn.Module):
    def __init__(self, dim: int, hidden: int = 256):
        super().__init__()
        self.net = torch.nn.Sequential(
            torch.nn.Linear(dim, hidden), torch.nn.GELU(), torch.nn.Dropout(0.2),
            torch.nn.Linear(hidden, 1),
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


def fit(head: Head, x: np.ndarray, y: np.ndarray, epochs: int = 30) -> None:
    opt = torch.optim.AdamW(head.parameters(), lr=1e-3, weight_decay=1e-3)
    xt, yt = torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)
    g = torch.Generator().manual_seed(SEED)
    head.train()
    for _ in range(epochs):
        for idx in torch.randperm(len(xt), generator=g).split(256):
            loss = torch.nn.functional.binary_cross_entropy_with_logits(head(xt[idx]), yt[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
    head.eval()


def logits(head: Head, x: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        return head(torch.tensor(x, dtype=torch.float32)).numpy()


def fit_temperature(z: np.ndarray, y: np.ndarray) -> float:
    """Temperature scaling: one scalar that makes probabilities match observed frequencies."""
    t = torch.ones(1, requires_grad=True)
    zt, yt = torch.tensor(z), torch.tensor(y, dtype=torch.float32)
    opt = torch.optim.LBFGS([t], lr=0.1, max_iter=100)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(zt / t.clamp(min=0.05), yt)
        loss.backward()
        return loss

    opt.step(closure)
    return float(t.detach().clamp(min=0.05))


def ece(p: np.ndarray, y: np.ndarray, bins: int = 15) -> float:
    """Expected calibration error: average gap between confidence and accuracy."""
    edges = np.linspace(0, 1, bins + 1)
    conf = np.maximum(p, 1 - p)
    correct = (p >= 0.5) == (y == 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(total)


def report(name: str, p: np.ndarray, y: np.ndarray) -> dict:
    out = {"n": int(len(y)), "accuracy": float(accuracy_score(y, p >= 0.5)), "ece": ece(p, y)}
    if len(np.unique(y)) == 2:
        out["auc"] = float(roc_auc_score(y, p))
    print(f"{name:<34} n={out['n']:>6}  acc={out['accuracy']:.3f}  "
          f"auc={out.get('auc', float('nan')):.3f}  ece={out['ece']:.3f}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="vitb32")
    args = ap.parse_args()
    torch.manual_seed(SEED)

    train = load_split("train", args.backbone)
    calib = load_split("calib", args.backbone)
    head = Head(train["features"].shape[1])
    fit(head, train["features"].astype(np.float32), train["label"].astype(np.float32))

    temperature = fit_temperature(logits(head, calib["features"].astype(np.float32)),
                                  calib["label"].astype(np.float32))
    print(f"temperature = {temperature:.3f}")

    def prob(split):
        return 1 / (1 + np.exp(-logits(head, split["features"].astype(np.float32)) / temperature))

    metrics = {"backbone": args.backbone, "temperature": temperature, "results": {}}
    for split_name in ["calib", "heldout", "heldout-hard"]:
        try:
            s = load_split(split_name, args.backbone)
        except SystemExit:
            continue
        p, y = prob(s), s["label"]
        metrics["results"][split_name] = report(split_name, p, y)
        # Per generator: share of fakes caught (and real images kept real, per source).
        per = {}
        for m in np.unique(s["model"][y == 1]):
            mask = (s["model"] == m) & (y == 1)
            per[str(m)] = {"n": int(mask.sum()), "detected": float((p[mask] >= 0.5).mean())}
        for src in np.unique(s["source"][y == 0]):
            mask = (s["source"] == src) & (y == 0)
            per[f"real:{src}"] = {"n": int(mask.sum()), "correct": float((p[mask] < 0.5).mean())}
        metrics["results"][split_name]["per_group"] = per

    out = DATA_DIR / f"head_{args.backbone}.pt"
    torch.save({"state_dict": head.state_dict(), "temperature": temperature,
                "dim": train["features"].shape[1], "backbone": args.backbone}, out)
    Path(f"results_{args.backbone}.json").write_text(json.dumps(metrics, indent=2))
    print("saved", out, "and", f"results_{args.backbone}.json")


if __name__ == "__main__":
    main()
