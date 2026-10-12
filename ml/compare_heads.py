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
from train import Head, head_input, load_split, logits

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
    return 1 / (1 + np.exp(-logits(head, head_input(features)) / temperature))


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
    def kind_of(features: np.ndarray) -> np.ndarray:
        f = features[:, 0] if features.ndim == 3 else features  # v5: the global view
        return np.array(names)[np.argmax(f.astype(np.float32) @ text.T, axis=1)]
    return kind_of


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
    kind_of = kind_classifier("vitb16")
    cache: dict = {}

    def split_for(split: str, backbone: str):
        """Each head is scored on its own feature set (v5 extracts its own copy of each split)."""
        if (split, backbone) not in cache:
            try:
                cache[(split, backbone)] = load_split(split, backbone)
            except SystemExit:
                cache[(split, backbone)] = None
        return cache[(split, backbone)]

    print(f"{'split':14}{'head':>5}{'n':>6}{'AUC':>7}{'AI>=.95':>9}{'AI>=.85':>9}"
          f"{'real>=.95':>10}{'real>=.85':>10}   real >=.95 by kind")
    for split in SPLITS:
        for name, (head, temp, backbone) in heads.items():
            s = split_for(split, backbone)
            if s is None:
                continue
            y = s["label"]
            kinds = kind_of(s["features"][y == 0])
            p = prob(head, temp, s["features"])
            ai, real = p[y == 1], p[y == 0]
            by_kind = "  ".join(f"{k} {int(((real >= STRONG) & (kinds == k)).sum())}/{int((kinds == k).sum())}"
                                for k in KINDS if (kinds == k).any())
            print(f"{split:14}{name:>5}{len(y):6}{roc_auc_score(y, p):7.3f}{pct(ai >= STRONG):>9}"
                  f"{pct(ai >= WEAK):>9}{pct(real >= STRONG):>10}{pct(real >= WEAK):>10}   {by_kind}")

    for split in ("heldout2", "local"):
        print(f"\n{split}: AI caught at >=0.95 per generator ({' / '.join(heads)})")
        ps = {}
        for name, (head, temp, backbone) in heads.items():
            s = split_for(split, backbone)
            if s is not None:
                ps[name] = (s, prob(head, temp, s["features"]))
        if not ps:
            continue
        s0 = next(iter(ps.values()))[0]
        y0 = s0["label"]
        for g in sorted(set(s0["model"][y0 == 1])):
            cells = []
            for s, p in ps.values():
                m = (s["model"] == g) & (s["label"] == 1)
                cells.append(f"{(p[m] >= STRONG).mean():4.0%}" if m.any() else "   -")
            print(f"  {g:18} n={int(((s0['model'] == g) & (y0 == 1)).sum()):4}  " + " / ".join(cells))
        for src in sorted(set(s0["source"][y0 == 0])):
            cells = []
            for s, p in ps.values():
                m = (s["source"] == src) & (s["label"] == 0)
                cells.append(f"{(p[m] >= STRONG).mean():4.0%}" if m.any() else "   -")
            print(f"  real {src:13} n={int(((s0['source'] == src) & (y0 == 0)).sum()):4}  flagged " + " / ".join(cells))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
