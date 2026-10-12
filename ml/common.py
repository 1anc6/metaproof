"""Shared paths and settings for the ML pipeline.

Large files live outside the repo (default D:/metaproof/data); only code is committed.
"""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("METAPROOF_DATA", "D:/metaproof/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

TRAIN_REPO = "datasets/OwensLab/CommunityForensics-Small"
EVAL_REPO = "datasets/OwensLab/CommunityForensics-Eval"

# Newer generators (2025-26) for detector v2. Rapidata's human-preference sets (CDLA-
# Permissive-2.0) store two images per row, from the columns image1/model1 and image2/model2.
RAPIDATA_REPOS = [
    "datasets/Rapidata/bananamark-dataset",
    "datasets/Rapidata/Imagen4_t2i_human_preference",
    "datasets/Rapidata/Imagen-4-ultra-24-7-25_t2i_human_preference",
    "datasets/Rapidata/Seedream-3_t2i_human_preference",
    "datasets/Rapidata/Flux-2-pro_t2i_human_preference",
    "datasets/Rapidata/Recraft-v3-24-7-25_t2i_human_preference",
    "datasets/Rapidata/Hidream_t2i_human_preference",
    "datasets/Rapidata/Reve-AI-Halfmoon_t2i_human_preference",
    "datasets/Rapidata/HunyuanImage-2.1_t2i_human_preference",
]
# Held-out test only (Apache-2.0, research use): GPT Image 2, Nano Banana 2, Qwen Image 2.1,
# FLUX.2 and real photos, as single image files under images/<generator>/<category>/.
ZR_REPO = "datasets/zr-zhang/MLLM-Generated-Image-Detection-Dataset"

# Rapidata model name -> (generator name used in results, role).
#   train     used for training and calibration
#   heldout   only in the new held-out test; whole families are held out (Nano Banana, FLUX.2)
#   excluded  never used: these are in the v1 held-out test (DALL-E 3, Imagen 3, Ideogram 2,
#             FLUX.1), so training on them would make the v1 numbers incomparable; Midjourney
#             5.2 is already in training
RAPIDATA_MODELS = {
    "imagen-4.0-ultra-generate-exp-05-20": ("Imagen4-Ultra-2505", "train"),
    "imagen-4-ultra-24-7-25": ("Imagen4-Ultra-2507", "train"),
    "4o-26-3-25": ("GPT-4o-image", "train"),
    "seedream-3-24-7-25": ("Seedream3", "train"),
    "bytedance/seedream-4": ("Seedream4", "train"),
    "hidream-I1-full": ("HiDream-I1", "train"),
    "halfmoon-4-4-25": ("Reve-Halfmoon", "train"),
    "recraft-v2": ("RecraftV2", "train"),
    "recraft-v3-24-7-25": ("RecraftV3", "train"),
    "recraft-ai/recraft-v3": ("RecraftV3", "train"),
    "ideogram-ai/ideogram-v3-quality": ("IdeogramV3", "train"),
    "hunyuan-image-2.1": ("HunyuanImage2.1", "train"),
    "tencent/hunyuan-image-3": ("HunyuanImage3", "train"),
    "prunaai/wan-2.2-image": ("Wan2.2", "train"),
    "aurora-20-1-25": ("Grok-Aurora", "train"),
    "frames-23-1-25": ("Runway-Frames", "train"),
    "lumina-17-2-25": ("Lumina", "train"),
    "janus-7b": ("Janus-7B", "train"),
    "stable-diffusion-3": ("SD3", "train"),
    "google/nano-banana": ("NanoBanana", "heldout"),
    "google/nano-banana-pro": ("NanoBananaPro", "heldout"),
    "flux-2-pro-25-11-25": ("FLUX.2-pro", "heldout"),
    "black-forest-labs/flux-2-pro": ("FLUX.2-pro", "heldout"),
    "black-forest-labs/flux-2-dev": ("FLUX.2-dev", "heldout"),
    "black-forest-labs/flux-2-flex": ("FLUX.2-flex", "heldout"),
    "dalle-3": ("Dalle3", "excluded"),
    "imagen-3": ("Imagen3", "excluded"),
    "ideogram": ("IdeogramV2", "excluded"),
    "flux-1-pro": ("FLUX.1-pro", "excluded"),
    "flux-1.1-pro": ("FLUX.1.1-pro", "excluded"),
    "midjourney-5.2": ("MidjourneyV5_2", "excluded"),
}

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
