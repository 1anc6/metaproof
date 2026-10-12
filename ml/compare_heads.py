"""Compare trained detector heads on every test split, at the thresholds the app uses.

MetaProof treats a score >= 0.95 as strong evidence of AI (it can decide a verdict alone) and
0.85-0.95 as weak evidence, so both are reported: the share of AI images caught, and the share
of real images wrongly flagged.

"Real" here means "not from an AI generator", not "camera photo": the real test images include
stock photos, screenshots, logos, 3D renders and cartoons. False alarms are broken down by
kind of image, using CLIP zero-shot labels on the stored features (approximate, but enough to
tell a flagged news screenshot from a flagged photo).

    python compare_heads.py --heads v1=head_vitb16.v1.pt v2=head_vitb16.v2.pt v3=head_vitb16.pt
"""

import argparse
import sys

import numpy as np
import open_clip
import torch
from sklearn.metrics import roc_auc_score

from common import BACKBONES, DATA_DIR
from train import Head, load_split, logits

STRONG, WEAK = 0.95, 0.85
SPLITS = ["heldout", "heldout-hard", "heldout2", "heldout2-hard", "local", "local-hard"]
KINDS = {
    "photo": ["a photo.", "a photograph of a person.", "a photograph of an object.",
              "a photograph of a landscape.", "a product photo.", "a stock photo."],
    "screenshot/text": ["a screenshot of a website.", "a screenshot of a news article.",
                        "a slide with text.", "a meme with text.", "a page of text."],
    "logo/graphic": ["a logo.", "a graphic design.", "a vector illustration.", "an icon.",
                     "a badge or emblem."],
    "3D render": ["a 3D render.", "a CGI image.", "a computer-generated 3D model."],
    "illustration": ["a cartoon.", "a drawing.", "a painting.", "digital art.", "an anime image."],
}


def load_head(path: str):
    ck = torch.load(DATA_DIR / path, weights_only=False)
    head = Head(ck["dim"])
    head.load_state_dict(ck["state_dict"])
    head.eval()
    return head, ck["temperature"], ck.get("backbone", "vitb16")


def prob(head, temperature: float, features: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-logits(head, features.astype(np.float32)) / temperature))


def kind_classifier(backbone: str):
    """Zero-shot image kind from stored (normalized, projected) CLIP image features."""
    arch, pretrained, _ = BACKBONES[backbone]
    model, _, _ = open_clip.create_model_and_transforms(arch, pretrained=pretrained)
    tokenizer = open_clip.get_tokenizer(arch)
    with torch.no_grad():
        text = []
        for prompts in KINDS.values():
            t = model.encode_text(tokenizer(prompts)).float()
            t = torch.nn.functional.normalize(t, dim=-1).mean(0)
            text.append(torch.nn.functional.normalize(t, dim=-1))
        text = torch.stack(text).numpy()
    names = list(KINDS)
    return lambda features: np.array(names)[np.argmax(features.astype(np.float32) @ text.T, axis=1)]


def pct(x: np.ndarray) -> str:
    return f"{x.mean():6.1%}" if len(x) else "     -"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--heads", nargs="+", required=True, help="name=file in DATA_DIR")
    args = ap.parse_args()
    heads = {}
    for spec in args.heads:
        name, path = spec.split("=", 1)
        heads[name] = load_head(path)
    backbone = next(iter(heads.values()))[2]
    kind_of = kind_classifier(backbone)

    print(f"{'split':14}{'head':>5}{'AUC':>7}{'AI>=.95':>9}{'AI>=.85':>9}"
          f"{'real>=.95':>10}{'real>=.85':>10}   real >=.95 by kind")
    for split in SPLITS:
        try:
            s = load_split(split, backbone)
        except SystemExit:
            continue
        y = s["label"]
        kinds = kind_of(s["features"][y == 0])
        for name, (head, temp, _) in heads.items():
            p = prob(head, temp, s["features"])
            ai, real = p[y == 1], p[y == 0]
            by_kind = "  ".join(f"{k} {int(((real >= STRONG) & (kinds == k)).sum())}/{int((kinds == k).sum())}"
                                for k in KINDS if (kinds == k).any())
            print(f"{split:14}{name:>5}{roc_auc_score(y, p):7.3f}{pct(ai >= STRONG):>9}"
                  f"{pct(ai >= WEAK):>9}{pct(real >= STRONG):>10}{pct(real >= WEAK):>10}   {by_kind}")

    for split in ("heldout2", "local"):
        try:
            s = load_split(split, backbone)
        except SystemExit:
            continue
        y = s["label"]
        print(f"\n{split}: AI caught at >=0.95 per generator ({' / '.join(heads)})")
        ps = {n: prob(h, t, s["features"]) for n, (h, t, _) in heads.items()}
        for g in sorted(set(s["model"][y == 1])):
            m = (s["model"] == g) & (y == 1)
            print(f"  {g:18} n={m.sum():4}  " + " / ".join(f"{(p[m] >= STRONG).mean():4.0%}" for p in ps.values()))
        for src in sorted(set(s["source"][y == 0])):
            m = (s["source"] == src) & (y == 0)
            print(f"  real {src:13} n={m.sum():4}  flagged " +
                  " / ".join(f"{(p[m] >= STRONG).mean():4.0%}" for p in ps.values()))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
