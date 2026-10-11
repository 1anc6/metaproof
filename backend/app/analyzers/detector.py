"""AI-image detector: frozen CLIP features + a small trained head, served with ONNX Runtime.

Preprocessing must match ml/extract_features.py exactly: shorter side to 256 px, JPEG
round trip at quality 90 (so file format can't be a clue), then CLIP's own resize,
center crop and normalization. The model output is already a calibrated probability.
"""

import io
import logging
import threading
from pathlib import Path

import numpy as np
from PIL import Image

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

log = logging.getLogger("metaproof.detector")

MODEL_ID = "clip-vitb16-mlp-v1"
STANDARD_SHORT_SIDE = 256
STANDARD_JPEG_QUALITY = 90
CLIP_SIZE = 224
CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# Probability bands -> evidence strength, chosen on nine generators never seen in training
# (ml/README.md). Wrongly flagging a real photo is the costlier mistake, so only p >= 0.95
# (1.8% of real photos, 5.2% after recompression) is strong enough to decide on its own;
# 0.85-0.95 only tips the balance together with other evidence. Below 0.10 almost no AI
# images remain (0.7%). The detector alone never produces "conclusive".
BANDS = [
    (0.95, Signal.ai, Strength.strong),
    (0.85, Signal.ai, Strength.weak),
]
LIKELY_REAL_BELOW = 0.10


class DetectorAnalyzer:
    name = "detector"
    version = "0.1.0"

    def __init__(self, model_path: Path) -> None:
        self.model_path = model_path
        self._session = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self.model_path.exists()

    def _get_session(self):
        # Loaded on first use so startup stays fast and memory is only spent when needed.
        with self._lock:
            if self._session is None:
                import onnxruntime as ort

                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 1
                opts.inter_op_num_threads = 1
                self._session = ort.InferenceSession(
                    str(self.model_path), opts, providers=["CPUExecutionProvider"]
                )
            return self._session

    def run(self, media: MediaInfo) -> AnalyzerResult:
        if not self.available:
            return AnalyzerResult(raw={"available": False}, findings=[])
        with Image.open(media.path) as img:
            pixels = preprocess(img)
        p_ai, embedding = self._get_session().run(None, {"pixels": pixels})
        p_ai = float(p_ai[0])
        return AnalyzerResult(
            raw={"available": True, "p_ai": round(p_ai, 4), "model": MODEL_ID},
            findings=findings_for(p_ai),
            embedding=[round(float(v), 6) for v in embedding[0]],
        )


def findings_for(p_ai: float) -> list[Finding]:
    pct = round(p_ai * 100)
    for threshold, signal, strength in BANDS:
        if p_ai >= threshold:
            return [Finding("detector.ai_pixels", signal, strength,
                            f"The AI-image detector rates the pixels {pct}% likely to be "
                            "AI-generated.")]
    if p_ai < LIKELY_REAL_BELOW:
        return [Finding("detector.camera_like", Signal.authentic, Strength.weak,
                        f"The AI-image detector finds no generator traces ({pct}% AI). "
                        "This supports, but cannot prove, a real photo.")]
    return [Finding("detector.uncertain", Signal.neutral, Strength.weak,
                    f"The AI-image detector is unsure ({pct}% AI).")]


def standardize(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    if min(w, h) > STANDARD_SHORT_SIDE:
        r = STANDARD_SHORT_SIDE / min(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.BICUBIC)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=STANDARD_JPEG_QUALITY)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def preprocess(img: Image.Image) -> np.ndarray:
    """Standardize, then reproduce open_clip's OpenAI transform without torch."""
    img = standardize(img)
    w, h = img.size
    # torchvision Resize(224): shorter side to 224, longer side truncated proportionally.
    if w <= h:
        size = (CLIP_SIZE, int(CLIP_SIZE * h / w))
    else:
        size = (int(CLIP_SIZE * w / h), CLIP_SIZE)
    img = img.resize(size, Image.BICUBIC)
    w, h = img.size
    left = round((w - CLIP_SIZE) / 2.0)
    top = round((h - CLIP_SIZE) / 2.0)
    img = img.crop((left, top, left + CLIP_SIZE, top + CLIP_SIZE))
    x = np.asarray(img, dtype=np.float32) / 255.0
    x = (x - CLIP_MEAN) / CLIP_STD
    return x.transpose(2, 0, 1)[None].astype(np.float32)
