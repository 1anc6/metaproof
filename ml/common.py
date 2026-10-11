"""Shared paths and settings for the ML pipeline.

Large files live outside the repo (default D:/metaproof/data); only code is committed.
"""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("METAPROOF_DATA", "D:/metaproof/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

TRAIN_REPO = "datasets/OwensLab/CommunityForensics-Small"
EVAL_REPO = "datasets/OwensLab/CommunityForensics-Eval"

# Columns that are cheap to read: everything except the image bytes and prompts.
META_COLUMNS = [
    "label", "model_name", "subset", "architecture", "real_source", "resolution", "nsfw_flag",
]

# CLIP backbones we compare: (open_clip model name, pretrained tag, embedding size).
# OpenAI weights were trained with QuickGELU, so the -quickgelu configs are required.
BACKBONES = {
    "vitb32": ("ViT-B-32-quickgelu", "openai", 512),
    "vitb16": ("ViT-B-16-quickgelu", "openai", 512),
}

SEED = 1234
