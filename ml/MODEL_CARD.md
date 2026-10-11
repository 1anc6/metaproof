---
license: cc-by-nc-sa-4.0
tags:
  - image-classification
  - ai-generated-image-detection
  - clip
  - onnx
datasets:
  - OwensLab/CommunityForensics-Eval
  - OwensLab/CommunityForensics-Small
---

# MetaProof AI-image detector

Detector used by [MetaProof](https://github.com/1anc6/metaproof): a frozen OpenAI CLIP
image encoder (ViT-B/16) with a small MLP head, temperature-calibrated, exported to ONNX with
8-bit weight-only quantization for CPU serving (121 MB; probabilities within 0.003 of fp32 on
average).

- **Input:** `pixels`, float32 `[N, 3, 224, 224]`, preprocessed exactly as in
  `backend/app/analyzers/detector.py` (shorter side 256 px, JPEG quality 90 round trip,
  CLIP resize, center crop and normalization).
- **Outputs:** `p_ai`, the calibrated probability that the image is AI-generated, and
  `embedding`, the L2-normalized 512-d CLIP embedding (used for near-duplicate search).

## Training data

Sampled from Community Forensics (Park & Owens, CVPR 2025). Training uses 12 generators from
the evaluation set plus about 6,000 images from thousands of Stable Diffusion variants, with
real photos from COCO, LAION, Landscapes HQ, VISION phone photos, FFHQ and ImageNet. Every
image is resized and JPEG re-encoded the same way, so file format is not a usable cue.

## Evaluation

Full numbers in `results.json`. On 4,239 images from **nine generators never seen in
training**: AUC 0.953, accuracy 88.7% at 0.5, expected calibration error 1.0%; AUC 0.950
after recompression. Detection per generator ranges from 87% (SDXL-LCM) to 99% (Firefly 3).
About 20% of real photos score above 0.5, so MetaProof only treats scores of 0.95 or more
(1.8% of real photos) as strong evidence.

Unseen generators: FLUX dev/schnell, Midjourney 6.1, DALL-E 3, Firefly Image 3, Ideogram 2,
Imagen 3, Stable Cascade and SDXL-LCM. Each was tested as-is and after social-media-style
recompression (50% downscale, JPEG quality 60).

## Limitations

- A probability, not proof. MetaProof combines it with metadata and C2PA evidence and
  answers "inconclusive" when evidence is weak.
- Accuracy drops on heavily recompressed images and on generators unlike anything in the
  training data. Real photos with heavy editing or filters can be flagged.
- Does not detect local edits (splicing, inpainting) in real photos.

## License

The weights are derived from CC BY-NC-SA 4.0 data and are released under the same license:
**non-commercial use only**. MetaProof's code is MIT.
