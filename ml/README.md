# MetaProof ML: the AI-image detector

A frozen **CLIP ViT-B/16** image encoder with a small MLP head, calibrated with temperature
scaling and served as an 8-bit weight-only ONNX model on CPU.

**Headline result:** on 4,239 images from **nine generators never seen in training** (FLUX,
Midjourney 6.1, DALL-E 3, Firefly 3, Imagen 3, Ideogram 2, Stable Cascade, SDXL-LCM), the
detector reaches **AUC 0.953** (0.950 after social-media-style recompression) with a
calibration error of 1%.

## Why this design

- **Frozen foundation-model features** (the UnivFD idea) generalize to new generators far
  better than a CNN trained from scratch, and only a 130K-parameter head needs training.
- **Split by generator, not by image.** The test split contains only generators the model
  never saw, so the number measures generalization rather than memorization.
- **Standardize every image** (shorter side 256 px, JPEG re-encode) before the model sees it.
  In this data the real photos are mostly small JPEGs and the AI images large PNGs; without
  this step a model can learn "PNG means AI" and look great while learning nothing useful.
  The API applies the identical step (`backend/app/analyzers/detector.py`, verified to be
  bit-identical to the training pipeline).
- **Calibrated output.** Temperature scaling on a held-out split makes 0.8 mean roughly 80%,
  which lets the evidence engine use fixed, interpretable thresholds.

## Data

[Community Forensics](https://arxiv.org/abs/2411.04125) (Park & Owens, CVPR 2025),
CC BY-NC-SA 4.0. Only a sample is used, streamed straight from Hugging Face: images are
decoded in memory and only CLIP features are kept (42 MB on disk for 33K images).

| Split | Images | AI | Real | Generators |
| --- | --- | --- | --- | --- |
| Train | 25,751 | 11,714 | 14,037 | 12 named + ~150 Stable Diffusion variants |
| Calibration | 2,851 | 1,299 | 1,552 | same as train |
| Test (unseen) | 4,239 | 2,731 | 1,508 | 9 new generators |

Real photos come from COCO, LAION, Landscapes HQ, VISION (phone cameras), FFHQ and ImageNet.

## Results on unseen generators

| Model | Accuracy @0.5 | AUC | AUC recompressed | Calibration error |
| --- | --- | --- | --- | --- |
| CLIP ViT-B/32 + MLP | 87.2% | 0.937 | 0.894 | 1.5% |
| **CLIP ViT-B/16 + MLP** (shipped) | **88.7%** | **0.953** | **0.950** | **1.0%** |

Detection per unseen generator (ViT-B/16, threshold 0.5): Firefly 3 99%, DALL-E 3 98%,
Stable Cascade 98%, Midjourney 6.1 94%, FLUX dev 94%, FLUX schnell 93%, Imagen 3 93%,
Ideogram 2 88%, SDXL-LCM 87%.

**Known weakness:** about 20% of real photos score above 0.5 (38% after heavy
recompression). Wrongly flagging a real photo is the costlier mistake, so the evidence engine
uses the score conservatively:

| Score | Effect | AI images at/above | Real photos at/above |
| --- | --- | --- | --- |
| ≥ 0.95 | strong evidence, can decide alone | 60% (76% recompressed) | 1.8% (5.2%) |
| 0.85–0.95 | weak, needs other evidence | 79% (90%) | 5.2% (13.8%) |
| 0.10–0.85 | neutral | | |
| < 0.10 | weak support for a real photo | 0.7% of AI images score this low | |

## Serving

| Export | Size | Peak RAM in the API | AUC on real test images |
| --- | --- | --- | --- |
| fp32 | 346 MB | 557 MB (over Render's 512 MB) | 0.9519 |
| dynamic int8 | 88 MB | — | 0.919 (rejected) |
| **8-bit weight-only** (shipped) | **121 MB** | **348 MB** | **0.9518** |
| 4-bit weight-only | 82 MB | — | 0.940 |

Weight-only quantization stores weights in 8 bits but computes in fp32; quantizing CLIP's
activations as well (dynamic int8) cost 0.03 AUC.

## Reproduce

```bash
python -m venv D:/metaproof/venv && D:/metaproof/venv/Scripts/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt

python scan_metadata.py          # 1. index both datasets from Parquet footers (no images)
python sample_plan.py            # 2. choose chunks per split (~17 GB to stream)
python extract_features.py --split heldout   # 3. stream, standardize, CLIP features (GPU)
python extract_features.py --split calib
python extract_features.py --split train
python train.py --backbone vitb16             # 4. train head, calibrate, evaluate
python export_onnx.py --backbone vitb16       # 5. ONNX export + 8-bit weight-only copy
python eval_onnx.py --variants fp32,w8        # 6. end-to-end check with the API's preprocessing
python export_onnx.py --backbone vitb16 --upload 1anc6/metaproof-detector
```

### v2 data: newer generators (shipped as detector v3)

The live API runs v3 (`MODEL_ID = "clip-vitb16-mlp-v3"`, pipeline 0.7.0), with thresholds
chosen on the calibration split to flag no more real images than v1 did: ≥ 0.91 strong,
0.79–0.91 weak, < 0.05 weak support for a real photo. The sections above describe v1; v3's
numbers are below and in `results_vitb16.json`.

v2 keeps everything above and adds 2025–26 generators. Training gets Imagen 4, GPT-4o
image, Seedream 3/4, Recraft v2/v3, HiDream, Reve, Ideogram 3, Hunyuan 2.1/3, Wan 2.2, Grok
Aurora, Runway Frames, Lumina, Janus and SD3, from Rapidata's human-preference datasets
(CDLA-Permissive-2.0). A new test split, `heldout2`, contains only families never trained on:
Nano Banana (1, Pro, 2), FLUX.2, GPT Image 2 and Qwen Image 2.1. These come from Rapidata and
the [zr-zhang benchmark](https://huggingface.co/datasets/zr-zhang/MLLM-Generated-Image-Detection-Dataset)
(Apache-2.0, research use). Generators in the v1 test (DALL-E 3, Imagen 3, Ideogram 2, FLUX.1)
stay out of training, so the v1 numbers remain comparable.

Rapidata repeats images across rows, so extraction dedupes by content hash and stops at 600
distinct images per training generator (300 per held-out one). The `local` split runs your
own images from `Images/` at the repo root (git-ignored).

First extraction (about 1.5 hours, download-bound): 5,400 new distinct training images, with
300–550 for most generators. Seedream 4, Wan 2.2, Ideogram 3 and Hunyuan 3 come only from
the small Bananamark set, which repeats heavily, so they have 37 or fewer. `heldout2` has
1,423 AI images and 890 real photos.

**Lesson from the first v2 head:** balancing the new AI images with COCO and Landscapes
snapshots taught it "polished means AI". Real images flagged at ≥ 0.95 rose from 1.8% to 2.5%,
mostly stock photos, logos, news screenshots and 3D renders. ("Real" in these test sets means
"not from a generator", not "camera photo".) Balancing with about 6,000 LAION images, which
include exactly those kinds of images, fixed it. `compare_heads.py` reports false alarms per
kind of image (CLIP zero-shot labels; studio product photos are sometimes labelled "3D
render").

| ≥ 0.95, v1 → v3 | Real images flagged | AI caught |
| --- | --- | --- |
| v1 test (2023–24 generators) | 1.8% → 0.8% | 60% → 61% |
| v1 test, recompressed | 5.2% → 1.6% | 76% → 70% |
| heldout2 (Nano Banana 2, GPT Image 2, Qwen 2.1, FLUX.2) | 0.3% → 0.1% | 11% → 16% |

v3's AUC is higher everywhere except heldout2-hard (v1 test 0.953 → 0.972), so its threshold
can come down. Chosen on the calibration split to flag no more real images than v1 does at
0.95, the threshold is 0.908. There v3 flags fewer real images on every test and catches
more AI: 70% of the v1 test, 20% of heldout2, and 5 of 10 Gemini images (v1: 1).
Next-generation models (GPT Image 2, Nano Banana 2, Qwen 2.1) remain mostly undetected (1–5%
at 0.95).

**v4 experiment: not shipped.** Training on 1,200 Nano Banana 2 images and 1,200 real photos from
the same benchmark (other files than the test) did not help: Nano Banana 2 test images caught
at 0.95 went from 5% to 7%, and false alarms on the benchmark's real photos rose. v4 put
only 8% of its *own* Nano Banana 2 training images at ≥ 0.95, and even a dedicated linear
classifier separates Nano Banana 2 from matched real photos at only AUC 0.85 on these
features (GPT Image 2 0.78, Qwen 0.73). The information isn't in the features. The 256 px
JPEG standardization plus CLIP's content-level view leaves too little to tell these
photorealistic models apart, so they need pixel-level evidence at original resolution, not
more examples. `ZR_TRAIN` in `sample_plan.py` is empty again. `train.py` now drops training
images that are byte-identical to a test image; the benchmark stores some real photos twice
under different names, and 35 such duplicates were caught. The v1 test's real images are now the same kind as the training ones (both LAION),
so the independent heldout2 real photos are the stricter check.

```bash
python scan_metadata.py --only rapidata      # exact model counts per row group
python scan_metadata.py --only zr            # file list of the held-out benchmark
python sample_plan.py                        # v1 items unchanged, v2 items added
python extract_features.py --split train     # only the new chunks are downloaded
python extract_features.py --split heldout2
python extract_features.py --split local
python train.py --backbone vitb16            # reports heldout, heldout2 and local
```

Large files go to `D:/metaproof/data` (override with `METAPROOF_DATA`). Trained on an RTX 4050
laptop GPU (6 GB); feature extraction is download-bound (~1 hour at 5 MB/s).

## License

Code: MIT. Model weights: CC BY-NC-SA 4.0 (derived from the training data), non-commercial.
