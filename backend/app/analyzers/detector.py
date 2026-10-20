"""AI-image detector: frozen CLIP features + a small trained head, served with ONNX Runtime.

Preprocessing must match ml/extract_features.py exactly: shorter side to 256 px, JPEG
round trip at quality 90 (so file format can't be a clue), then CLIP's own resize,
center crop and normalization. The model output is already a calibrated probability.

One step runs before that and only at inference: added borders (a meme caption band, a phone
screenshot's app bars) are trimmed, because otherwise they fill much of the 256 px image and
the center crop, and the model sees mostly a flat area. Training images have no such borders,
so for them the step does nothing and the match above still holds.
"""

import io
import logging
import threading
from pathlib import Path

import numpy as np
from PIL import Image

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

log = logging.getLogger("metaproof.detector")

MODEL_ID = "clip-vitb16-mlp-v3"
STANDARD_SHORT_SIDE = 256
STANDARD_JPEG_QUALITY = 90
CLIP_SIZE = 224
CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# Border trimming (ml/README.md, robustness). Rows are compared on a copy whose longer side is
# at most TRIM_SCAN px. A row is background when it is flat (every channel's std at or below
# TRIM_ROW_STD) and has the colour of the outermost row. A border is cut only when it looks
# added rather than photographed, which on the held-out set left every unedited image's score
# unchanged:
# - it holds text or UI: at least one run of rows that are not background, no longer than
#   TRIM_MAX_GAP of the side, followed by background again. A plain white or black margin
#   without text is left alone, because it can't be told from a studio or night background;
# - it ends in a straight edge: at least TRIM_EDGE of the next two rows differ from its colour.
#   A natural background ends where the subject starts, usually in a small part of the row.
# Borders under TRIM_MIN of the side are ignored, and if the two borders of one axis add up to
# more than TRIM_MAX the image is mostly plain and that axis is not trimmed at all.
TRIM_SCAN = 256
TRIM_ROW_STD = 4.0
TRIM_COLOR_TOL = 12.0
TRIM_MAX_GAP = 0.08
TRIM_EDGE = 0.5
TRIM_MIN = 0.02
TRIM_MAX = 0.5

# Probability bands -> evidence strength (ml/README.md). Wrongly flagging a real photo is the
# costlier mistake. Thresholds were chosen on the calibration split so that v3 flags no more
# real images than v1 did at 0.95 / 0.85; on nine generators never seen in training that is
# 1.3% of real images at p >= 0.91 (2.7% after recompression), strong enough to decide on
# its own, while 0.79-0.91 only tips the balance together with other evidence. Below 0.05
# almost no AI images from those generators remain (0.8%), though about a third of the
# newest ones (GPT Image 2, Nano Banana 2) score that low too, so it stays weak support.
# The detector alone never produces "conclusive".
BANDS = [
    (0.91, Signal.ai, Strength.strong),
    (0.79, Signal.ai, Strength.weak),
]
LIKELY_REAL_BELOW = 0.05


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
            pixels, trimmed = prepare(img)
        p_ai, embedding = self._get_session().run(None, {"pixels": pixels})
        p_ai = float(p_ai[0])
        return AnalyzerResult(
            raw={"available": True, "p_ai": round(p_ai, 4), "model": MODEL_ID,
                 # Added borders removed before scoring, in pixels of the uploaded image.
                 "trimmed_px": trimmed,
                 # The band edges used for this score, so a report can draw them correctly
                 # even after a later model changes them.
                 "bands": {"strong": BANDS[0][0], "weak": BANDS[1][0],
                           "likely_real_below": LIKELY_REAL_BELOW}},
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


def _border(a: np.ndarray) -> int:
    """Rows of added border at the start of an (h, w, 3) array, 0 if there is none."""
    h = a.shape[0]
    flat = a.std(axis=1).max(axis=1) <= TRIM_ROW_STD
    mean = a.mean(axis=1)
    if not flat[0]:
        return 0
    max_gap = max(1, int(h * TRIM_MAX_GAP))
    end, gap, had_text = 0, 0, False
    for i in range(h):
        if flat[i] and np.abs(mean[i] - mean[0]).max() <= TRIM_COLOR_TOL:
            had_text |= gap > 0
            end, gap = i + 1, 0
        else:
            gap += 1
            if gap > max_gap:
                break
    if not had_text or end < h * TRIM_MIN or end >= h:
        return 0
    edge = (np.abs(a[end: end + 2] - mean[0]).max(axis=2) > TRIM_COLOR_TOL).mean()
    return end if edge >= TRIM_EDGE else 0


def trim_borders(img: Image.Image) -> tuple[Image.Image, dict[str, int]]:
    """Cut added bands (meme caption, app bars) off the edges. Deterministic."""
    img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, TRIM_SCAN / max(w, h))
    if scale < 1:
        small = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BOX)
    else:
        small = img
    a = np.asarray(small, dtype=np.float32)
    sh, sw = a.shape[:2]

    top, bottom = _border(a), _border(a[::-1])
    if top + bottom > sh * TRIM_MAX:
        top = bottom = 0
    # Columns are judged on the rows that are kept, so a caption band can't hide a frame.
    cols = a[top: sh - bottom].transpose(1, 0, 2)
    left, right = _border(cols), _border(cols[::-1])
    if left + right > sw * TRIM_MAX:
        left = right = 0

    trimmed = {"top": round(top * h / sh), "bottom": round(bottom * h / sh),
               "left": round(left * w / sw), "right": round(right * w / sw)}
    if any(trimmed.values()):
        img = img.crop((trimmed["left"], trimmed["top"],
                        w - trimmed["right"], h - trimmed["bottom"]))
    return img, trimmed


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
    return prepare(img)[0]


def prepare(img: Image.Image) -> tuple[np.ndarray, dict[str, int]]:
    """Trim borders, standardize, then reproduce open_clip's OpenAI transform without torch."""
    img, trimmed = trim_borders(img)
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
    return x.transpose(2, 0, 1)[None].astype(np.float32), trimmed
