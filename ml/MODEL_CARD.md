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
  - Rapidata/Imagen4_t2i_human_preference
  - Rapidata/Seedream-3_t2i_human_preference
  - Rapidata/Recraft-v3-24-7-25_t2i_human_preference
  - Rapidata/bananamark-dataset
---

# MetaProof AI-image detector (v3)

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

Sampled from Community Forensics (Park & Owens, CVPR 2025): 12 generators from the evaluation
set plus about 6,000 images from thousands of Stable Diffusion variants. v3 adds about 5,400
distinct images from 18 generators of 2025, from Rapidata's human-preference datasets
(CDLA-Permissive-2.0): Imagen 4, GPT-4o image, Seedream 3/4, Recraft v2/v3, HiDream, Reve,
Ideogram 3, Hunyuan 2.1/3, Wan 2.2, Grok Aurora, Runway Frames, Lumina, Janus and SD3. Real
images come from COCO, LAION (including stock photos, graphics, screenshots and renders, so
polish alone is not a cue), Landscapes HQ, VISION phone photos, FFHQ and ImageNet; 36,528
training images in all. Every image is resized and JPEG re-encoded the same way, so file
format is not a usable cue.

## Evaluation

Full numbers in `results.json`. On 4,239 images from **nine generators never seen in
training**: AUC 0.972, accuracy 91.6% at 0.5, expected calibration error 1.1%; AUC 0.967
after recompression (v1: 0.953 and 0.950). Detection per generator at 0.5 ranges from 85%
(SDXL-LCM) to 98% (Stable Cascade). About 9% of real images score above 0.5, so MetaProof
only treats scores of 0.91 or more as strong evidence: 70% of AI images and 1.3% of real
images score that high (v1 at its 0.95 threshold: 60% and 1.8%).

**Newest generators (2026), also never seen in training**, from an independent benchmark
([zr-zhang/MLLM-Generated-Image-Detection-Dataset](https://huggingface.co/datasets/zr-zhang/MLLM-Generated-Image-Detection-Dataset)).
The share scored above 0.5 is FLUX.2 38%, Qwen Image 2.1 24%, Nano Banana 2 21% and GPT
Image 2 21%, while 0.2% of that benchmark's real photos score 0.91 or more.

Unseen generators: FLUX dev/schnell, Midjourney 6.1, DALL-E 3, Firefly Image 3, Ideogram 2,
Imagen 3, Stable Cascade and SDXL-LCM. Each was tested as-is and after social-media-style
recompression (50% downscale, JPEG quality 60).

## Limitations

- A probability, not proof. MetaProof combines it with metadata and C2PA evidence and
  answers "inconclusive" when evidence is weak.
- Accuracy drops on heavily recompressed images and on generators unlike anything in the
  training data. The newest multimodal generators (GPT Image 2, Nano Banana 2, Qwen Image
  2.1) are mostly missed. Real photos with heavy editing or filters can be flagged.
- Does not detect local edits (splicing, inpainting) in real photos.

## License

The weights are derived partly from CC BY-NC-SA 4.0 data (Community Forensics) and are
released under the same license:
**non-commercial use only**. MetaProof's code is MIT.
