"""How much slower is detector v5 on one CPU thread? Times v3 (one 224 px view) against v5
(the same view plus four full-resolution crops) and cheaper variants, end to end from a file.

The live API runs ONNX Runtime with one thread; Render's free instance is several times
slower than a laptop core, so the ratio to v3 (about 5 s there) is what matters.

    python bench_cpu.py photo1.jpg photo2.jpg ...
"""

import sys
import time

import numpy as np
import onnxruntime as ort
from PIL import Image

from common import DATA_DIR
from eval_onnx import backend_preprocess
from extract_features import native_crops

MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)


def to_tensor(crop: Image.Image) -> np.ndarray:
    x = (np.asarray(crop, np.float32) / 255.0 - MEAN) / STD
    return x.transpose(2, 0, 1)


def best_of(fn, n=3):
    times = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        times.append(time.perf_counter() - t)
    return min(times)


def main(paths):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = opts.inter_op_num_threads = 1
    sess = ort.InferenceSession(str(DATA_DIR / "export/detector_vitb16_w8.onnx"), opts,
                                providers=["CPUExecutionProvider"])
    preprocess = backend_preprocess()
    rows = []
    for p in paths:
        def decode():
            with Image.open(p) as img:
                img.load()
                return img.copy()
        img = decode()
        t_decode = best_of(decode)
        t_pre3 = best_of(lambda: preprocess(img))
        t_pre5 = best_of(lambda: [to_tensor(c) for c in native_crops(img, 90)])
        x1 = preprocess(img)
        crops = np.stack([to_tensor(c) for c in native_crops(img, 90)])
        x5 = np.concatenate([x1, crops])
        t_f = {n: best_of(lambda n=n: sess.run(None, {"pixels": x5[:n]})) for n in (1, 3, 5)}
        rows.append((t_decode, t_pre3, t_pre5, t_f[1], t_f[3], t_f[5]))
        print(f"{p}: {img.size[0]}x{img.size[1]}  decode {t_decode:.2f}s  v3 prep {t_pre3:.2f}s  "
              f"crops prep {t_pre5:.2f}s  forward x1 {t_f[1]:.2f}s  x3 {t_f[3]:.2f}s  x5 {t_f[5]:.2f}s")
    d, p3, p5, f1, f3, f5 = np.mean(rows, axis=0)
    v3 = d + p3 + f1
    v5_2 = d + p3 + p5 + f3  # crop prep is the same for 2 or 4 crops (resize + JPEG dominate)
    v5 = d + p3 + p5 + f5
    print(f"\nmean: v3 {v3:.2f}s   v5 two crops {v5_2:.2f}s ({v5_2 / v3:.1f}x)   "
          f"v5 four crops {v5:.2f}s ({v5 / v3:.1f}x)")


if __name__ == "__main__":
    main(sys.argv[1:])
