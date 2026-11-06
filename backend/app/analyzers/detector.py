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

# Stability check (ml/eval_stability.py, docs/evaluation.md). A score that flags an image is
# also taken on a few everyday copies of it, and the evidence counts only as far as the lowest
# of those scores supports it: a real photo the detector happens to flag tends to lose the
# flag when cropped, while an AI image keeps it. Only flagged images are checked, so the extra
# inferences are spent where a score can push a verdict towards AI. Copies are made from a
# working copy at most STABILITY_WORK_SIDE px long, so a 50 MP photo isn't rotated full size.
STABILITY_FROM = BANDS[1][0]
STABILITY_WORK_SIDE = 2048


class DetectorAnalyzer:
    name = "detector"
    version = "0.2.0"

    def __init__(self, model_path: Path) -> None:
        self.model_path = model_path
        self._session = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self.model_path.exists()

    @property
    def loaded(self) -> bool:
        """In memory: from the next analysis until the worker unloads it after a quiet spell."""
        return self._session is not None

    def unload(self) -> None:
        """Free the model (about 130 MB); the next analysis loads it again."""
        with self._lock:
            self._session = None

    def _get_session(self):
        # Loaded on first use so startup stays fast and memory is only spent when needed.
        with self._lock:
            if self._session is None:
                import onnxruntime as ort

                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 1
                opts.inter_op_num_threads = 1
                # Buffers are freed after each run instead of kept for the next. Outputs are
                # bit-identical either way.
                opts.enable_cpu_mem_arena = False
                self._session = ort.InferenceSession(
                    str(self.model_path), opts, providers=["CPUExecutionProvider"]
                )
            return self._session

    def run(self, media: MediaInfo) -> AnalyzerResult:
        if not self.available:
            return AnalyzerResult(raw={"available": False}, findings=[])
        with Image.open(media.path) as img:
            pixels, trimmed = prepare(img)
            # Leaving `with` only closes the file; this frees the decoded photo (115 MB at
            # 30 MP) before the model is loaded and run, instead of after.
            img.close()
        session = self._get_session()
        p_ai, embedding = session.run(None, {"pixels": pixels})
        p_ai = float(p_ai[0])
        raw = {"available": True, "p_ai": round(p_ai, 4), "model": MODEL_ID,
               # Added borders removed before scoring, in pixels of the uploaded image.
               "trimmed_px": trimmed,
               # The band edges used for this score, so a report can draw them correctly
               # even after a later model changes them.
               "bands": {"strong": BANDS[0][0], "weak": BANDS[1][0],
                         "likely_real_below": LIKELY_REAL_BELOW}}
        copies = None
        if p_ai >= STABILITY_FROM:
            with Image.open(media.path) as img:
                work = working_copy(img)
            copies = {name: round(float(session.run(None, {"pixels": prepare(make(work))[0]})[0][0]), 4)
                      for name, (_, make) in STABILITY_COPIES.items()}
            del work
            # Scores of each everyday copy, in STABILITY_COPIES order. Absent when the image
            # wasn't flagged, so the check didn't run.
            raw["stability"] = {"copies": copies, "lowest": min(round(p_ai, 4), *copies.values())}
        return AnalyzerResult(
            raw=raw,
            findings=findings_for(p_ai, copies),
            embedding=[round(float(v), 6) for v in embedding[0]],
        )


def _band(p: float) -> int:
    """Index into BANDS of the band a score falls in, len(BANDS) below them all."""
    return next((i for i, (threshold, _, _) in enumerate(BANDS) if p >= threshold), len(BANDS))


def findings_for(p_ai: float, copies: dict[str, float] | None = None) -> list[Finding]:
    """The detector's finding for its score, held to the lowest score of its everyday copies."""
    pct = round(p_ai * 100)
    if copies:
        name, low = min(copies.items(), key=lambda kv: kv[1])
        counted = min(p_ai, low)
        if _band(counted) != _band(p_ai):
            what = STABILITY_COPIES[name][0]
            said = (f"The AI-image detector rates the pixels {pct}% likely to be AI-generated, "
                    f"but only {round(low * 100)}% on {what}")
            if _band(counted) < len(BANDS):
                _, signal, strength = BANDS[_band(counted)]
                return [Finding("detector.ai_pixels", signal, strength,
                                f"{said}, so it counts as weaker evidence.")]
            return [Finding("detector.unstable", Signal.neutral, Strength.weak,
                            f"{said}. A score that falls this much counts as no evidence.")]
        for threshold, signal, strength in BANDS:
            if p_ai >= threshold:
                return [Finding("detector.ai_pixels", signal, strength,
                                f"The AI-image detector rates the pixels {pct}% likely to be "
                                f"AI-generated, and at least {round(low * 100)}% on everyday "
                                "copies of it.")]
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


# --- everyday copies for the stability check ----------------------------------------------
# The same code as ml/eval_stability.py, which measured them; keep the two identical.

def working_copy(img: Image.Image) -> Image.Image:
    """A new RGB image, independent of `img`, so the decoded original can be freed."""
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > STABILITY_WORK_SIDE:
        r = STABILITY_WORK_SIDE / max(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.Resampling.LANCZOS)
    return img


def _crop(img: Image.Image, keep: float, ax: float = 0.5, ay: float = 0.5) -> Image.Image:
    """Keep `keep` of each side; (ax, ay) places the kept part (0.5, 0.5 = centre)."""
    w, h = img.size
    cw, ch = max(1, round(w * keep)), max(1, round(h * keep))
    x, y = round((w - cw) * ax), round((h - ch) * ay)
    return img.crop((x, y, x + cw, y + ch))


# name -> (how a report names it after "on", how to make it from the working copy)
# Provisional, from the calibration split: of seven candidates, an 80% centre crop alone took
# every flagged real photo out of the strong band (3 -> 0, and 17 -> 5 at weak or above) while
# keeping 80% of AI images there; corner crops kept only 39%. To be confirmed on the camera-
# photo set before it ships (ml/eval_stability.py).
STABILITY_COPIES = {
    "crop_80": ("a crop of its centre", lambda im: _crop(im, 0.8)),
}


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
    # convert() copies even an image that is RGB already: 115 MB more for a 30 MP photo.
    img = img if img.mode == "RGB" else img.convert("RGB")
    w, h = img.size
    scale = min(1.0, TRIM_SCAN / max(w, h))
    if scale < 1:
        small = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.BOX)
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
    img = img if img.mode == "RGB" else img.convert("RGB")
    w, h = img.size
    if min(w, h) > STANDARD_SHORT_SIDE:
        r = STANDARD_SHORT_SIDE / min(w, h)
        img = img.resize((max(1, round(w * r)), max(1, round(h * r))), Image.Resampling.BICUBIC)
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
    img = img.resize(size, Image.Resampling.BICUBIC)
    w, h = img.size
    left = round((w - CLIP_SIZE) / 2.0)
    top = round((h - CLIP_SIZE) / 2.0)
    img = img.crop((left, top, left + CLIP_SIZE, top + CLIP_SIZE))
    x = np.asarray(img, dtype=np.float32) / 255.0
    x = (x - CLIP_MEAN) / CLIP_STD
    return x.transpose(2, 0, 1)[None].astype(np.float32), trimmed
