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

Large files go to `D:/metaproof/data` (override with `METAPROOF_DATA`). Trained on an RTX 4050
laptop GPU (6 GB); feature extraction is download-bound (~1 hour at 5 MB/s).

## License

Code: MIT. Model weights: CC BY-NC-SA 4.0 (derived from the training data), non-commercial.
