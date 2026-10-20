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
under different names, and 35 such duplicates were caught.

**Full-resolution experiment** (`probe_native.py`). A linear classifier on CLIP features
compares the live 256 px input with four 224 px crops at up to 1024 px, on the same images
(AUC vs the benchmark's real photos, each generator left out of training):

| Generator | 256 px input | Full-res crops | Crops, AI given the reals' size and JPEG history |
| --- | --- | --- | --- |
| Nano Banana 2 | 0.65 | 0.84 | 0.61 → 0.70 |
| GPT Image 2 | 0.83 | 0.97 | 0.80 → 0.92 |
| Qwen Image 2.1 | 0.95 | 0.98 | 0.98 → 0.99 |
| FLUX.2 | 0.99 | 0.995 | 0.995 → 0.997 |

The benchmark's real photos are small, already-compressed web JPEGs, so part of the first
gain was a size and compression shortcut. The last column (`--match-reals`) shrinks and
compresses the AI images like them first. A real gain survives there, but Nano Banana 2
stays hard for frozen CLIP features even at full resolution. Against phone photos everything
separates near 1.0 on content alone, which says nothing about this question. The v1 test's real images are now the same kind as the training ones (both LAION),
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

### Real camera photos: v5 does not ship

The test sets above hold small web JPEGs, so they say little about what users upload most:
original files straight from a phone or camera. `real_photos.py` builds a calibration set
of them, and `eval_realcal.py` scores it. This set is for testing only; never train on it.

| Source | Licence | Devices | Photos |
| --- | --- | --- | --- |
| [VISION](https://lesc.dinfo.unifi.it/VISION/) (Shullani et al. 2017), "nat" images | CC BY-SA 4.0 | 35 phones, 2012–16 | 770 (22 per phone, seeded sample) |
| [Wikimedia Commons](https://commons.wikimedia.org/), "Taken with …" categories | per file: CC BY-SA 4.0 (437), CC BY 4.0 (81), CC0 (75), PD (26), other CC BY/BY-SA (66) | 48 phones 2020–26 (iPhone 12–17, Galaxy S21–S26, Pixel 6–8, 7 OnePlus, Xiaomi, Honor, Huawei, Nothing, …), 14 cameras | 685 |

Commons files must name the device in EXIF, have no editing software in it (Photoshop,
Lightroom, Picasa, Snapseed, …), be at least 3,000 px on the long side and have a size that
recurs for that device (crops have sizes of their own), with at most a third from one
photographer. `manifest.jsonl` next to the files records each one's URL, licence, author and
device. VISION is partly in Community Forensics' training data: 151 VISION photos nearly match
a training image (CLIP cosine ≥ 0.95), so they are dropped, leaving **1,304 originals from 97
devices**. Each also gets a social-media copy (long side 1,080 px, JPEG quality 75).
Dresden (2009 compact cameras) and RAISE (three Nikon DSLRs, 2014) were not needed: the
gap that matters is recent devices, which Commons covers with clear per-file licences.

**v5 flags modern camera photos.** Real originals at or above each score:

| Score ≥ | v3 originals | v3 social copies | v5 originals | v5 social copies |
| --- | --- | --- | --- | --- |
| 0.79 | 2.8% | 1.5% | 16.6% | 2.0% |
| 0.91 | **0.6%** (≤ 1.2%) | **0.7%** (≤ 1.3%) | 9.4% | 0.8% |
| 0.95 | 0.5% | 0.1% | 5.8% | 0.2% |
| 0.99 | 0% | 0% | 1.3% | 0.1% |

(Parentheses: upper end of the 95% Clopper-Pearson interval.) VISION's 2012–16 phones are never
flagged by either model. The problem is recent hardware: at ≥ 0.95, v5 flags 8.5% of the
2020–26 phone photos and 22% of the mirrorless/DSLR photos (Lumix G9 56%, Nikon Z 8 50%,
OnePlus 12 27%), against 1.1% and 1.5% for v3 at its 0.91 threshold. Social copies are
fine, because shrinking to 1,080 px removes the very detail the crops look at. So the
crops learned "clean, sharp, noise-free pixels mean AI": every real image v5 trained on was
a web-sized JPEG, while modern sensors and phone pipelines produce exactly that clean look
at full size. This also explains the 2 of 11 OnePlus photos seen earlier.

**No stricter rule rescues it.** Thresholds were chosen on half of the devices (by hash)
and checked on the other half, requiring the zr real photos to stay at v3's level too:

| Strong rule | Real originals flagged (all) | Social copies | Nano Banana 2 / GPT Image 2 / Qwen 2.1 / FLUX.2 caught | v1 test caught |
| --- | --- | --- | --- | --- |
| v3 ≥ 0.91 (live) | 0.6% (≤ 1.2%) | 0.7% (≤ 1.3%) | **8% / 5% / 5% / 18%** | 70% |
| v5 ≥ 0.995 and v3 ≥ 0.5 (global and crops agree) | 0.5% (≤ 1.0%) | 0% | 5% / 4% / 2% / 8% | 59% |
| v5 ≥ 0.995 alone | 0.6% (≤ 1.2%) | ≤ 0.1% | 5% / 4% / 2% / 8% | — |
| v5 ≥ 0.95 alone (what was proposed) | 5.8% (≤ 7.2%) | 0.2% | 16% / 16% / 18% / 26% | — |

Requiring every crop to agree found no threshold within the bar on the first half. Brought
to v3's false-alarm rate on camera photos, v5 catches *fewer* new-generator images than v3,
not more. Against camera originals (rather than the benchmark's web JPEGs) v5's AUC on the
newest generators is 0.65–0.67, where v3 has 0.53–0.73: neither separates them, and the
0.770 → 0.885 gain measured against web JPEGs does not hold for camera files. The live
model, scored end to end on all 1,455 files with the backend's preprocessing, flags 0.5%
(≤ 1.1%) of originals and 0.5% of social copies at 0.91: v3's band edges hold on camera
photos and stay as they are.

**Cost** (`bench_cpu.py`, ONNX Runtime, one thread, 10 photos of 5–50 MP): v3 takes 0.94 s
on a laptop core, v5 2.67 s (2.9×; the forward passes dominate, the extra resize and JPEG
round trip add about 0.15 s), and two crops 1.86 s (2.0×). With v3 at about 5 s on Render's
free instance, v5 would take about 14 s and two crops about 10 s. Running crops only when
v3 ≥ 0.5 would skip them for 90% of real photos but also for 75% of the newest generators'
images, so it saves time only by giving up most of what the crops were for.

**Recommendation: don't ship v5, with or without a stricter rule.** Keep v3 with its current
bands. A full-resolution model is still the right direction (`probe_native.py`), but its head
must learn from full-resolution *camera* photos as real examples: a disjoint Commons pull
(other devices or other files than this set; `real_photos.py` already filters for unedited
originals) plus the AI images at full size. Retrain v5 that way and re-run `eval_realcal.py`
before considering it again. For Gemini/Nano Banana images, the signed C2PA credential
remains the evidence that decides.

```bash
python real_photos.py vision --per-device 22    # ~3 GB, slow server (~1 hour)
python real_photos.py commons --per-device 15   # ~4 GB
python real_photos.py social                    # social-media copies
python real_photos.py plan
python extract_features.py --split realcal --features native
python extract_features.py --split realcal-social --features native
python eval_realcal.py --onnx                   # writes results_realcal.json
python bench_cpu.py <photos...>
```

### v6: v5 retrained with camera originals as real examples, still does not ship

`real_photos.py commons-train` pulls **2,067 unedited camera originals from 189 other
devices** (1,711 phone photos, 356 camera photos; 2017–26; 950 photographers; same filters
as above), none of them a device, file or photographer of the calibration set (the script
checks all three against its manifests). `plan-train` adds them to `plan_train.json` as one
`trainreal_` chunk per device, a tenth by content hash going to the calibration split, and
`extract_features.py --split train --features native --only trainreal_` extracts them like
every training image (random crop spots, JPEG quality and scale). So 1,867 of v6's ~21,200
real training images and 199 of its calibration images are full-size camera files; nothing
else changed. `train.py`'s duplicate guard now covers the realcal splits as well.

**The camera false alarms are mostly gone:**

| Real originals ≥ 0.95 | v5 | v6 |
| --- | --- | --- |
| All 1,304 | 5.8% | 0.8% (10, ≤ 1.4%) |
| Mirrorless/DSLR (131) | 22% | 3.8% |
| 2020–26 phones (554) | 8.5% | 0.9% |
| Social copies (1,325) | 0.2% | 0.2% |

**But the bar is not cleared.** With the same protocol (threshold chosen on half A of the
devices, also requiring the benchmark's 890 real photos to stay at v3's rate), v6's strong
threshold is 0.98:

| Strong rule | Real originals flagged | Social copies | NB2 / GPT2 / Qwen 2.1 / FLUX.2 caught | Recompressed | v1 test caught / real flagged |
| --- | --- | --- | --- | --- | --- |
| v3 ≥ 0.91 (live) | 0.6% (≤ 1.2%) | 0.7% (≤ 1.3%) | **8% / 5% / 5% / 18%** | 18% / 4% / 4% / 8% | 70% / 1.3% |
| v6 ≥ 0.98 | 0.2% (≤ 0.6%) | 0.1% (≤ 0.4%) | 7% / 7% / 7% / 15% | 6% / 1% / 0% / 0% | 73% / 0.3% |
| v6 ≥ 0.97 (not chosen) | 0.4% (≤ 0.9%) | 0.1% (≤ 0.4%) | 11% / 10% / 10% / 19% | 8% / 1% / 1% / 1% | — |

v6 at 0.98 catches more GPT Image 2 and Qwen images than v3 but fewer Nano Banana 2 and
FLUX.2 images. At 0.97 it would catch more of all four, but the protocol rejects 0.97: it
flags 3 of the 890 benchmark real photos where v3 flags 2. Take that as a tie, not a
pass. The 0.97 gains are 1 to 5 points on 300 images per generator, within noise, and
were found by looking at the whole test set. The recompressed copies (long side halved, JPEG
quality 60) are where v6 clearly loses: 0–8% caught against v3's 4–18%. Once crops of real
photos can be clean too, the full-resolution view stops helping on images whose detail
has been compressed away. v6 does separate camera originals from the new generators better than
either earlier model (AUC 0.76 / 0.70 / 0.81 / 0.78 for NB2 / GPT2 / Qwen / FLUX.2,
against v5's 0.65–0.67 and v3's 0.53–0.73). The extra separation sits below the strong band,
so at a threshold that keeps camera photos safe, little of it is left.

`compare_heads.py` (≥ 0.95 on the web-image tests): v6 keeps most of v5's gains (heldout2
AUC 0.852 vs v5 0.885 and v3 0.770; new generators 11–24% caught vs v5's 16–26% and v3's
1–12%), and no longer flags your own real photos (`local`: 0 of 11, v5 2 of 11).

**Recommendation: keep v3.** v6 is a much safer full-resolution model than v5, but it does not
beat v3 where it counts. Not exported, and the backend is unchanged. Next steps, if
the full-resolution path is pursued: more camera originals (a few thousand more, weighted
up, so the head learns the camera look rather than ~10% of reals); full-size outputs of the
newest generators for training; and a
larger test set of the newest generators, so a 3-point gain can be told from noise.

```bash
python real_photos.py commons-train --per-device 14   # ~8 GB, ~3 hours (API-throttled)
python real_photos.py plan-train                       # appends trainreal_ chunks to plan_train.json
python extract_features.py --split train --features native --only trainreal_
python train.py --backbone vitb16n                     # -> head_vitb16n.pt (kept as head_vitb16n.v6.pt)
python eval_realcal.py --v5 head_vitb16n.v6.pt --out results_realcal_v6.json
python compare_heads.py --heads v3=head_vitb16.v3.pt v5=head_vitb16n.v5.pt v6=head_vitb16n.v6.pt
```

Large files go to `D:/metaproof/data` (override with `METAPROOF_DATA`). Trained on an RTX 4050
laptop GPU (6 GB); feature extraction is download-bound (~1 hour at 5 MB/s).

## Robustness to edits: border trimming

`eval_robustness.py` scores the live model with the backend's preprocessing on 928 held-out
images (577 AI, 351 real) after edits people make before checking an image. A white meme
caption band cut AI images at the strong band from 70.7% to 2.9%, and phone screenshots with
dark app bars to 41.1%: the band filled much of the 256 px image and the center crop, so the
model mostly saw a flat area.

The backend now trims added borders before standardizing (`trim_borders` in
`backend/app/analyzers/detector.py`; the trim is reported as `trimmed_px` per side). A border
must be flat rows of one colour that hold text or UI and end in a straight edge across the
image. A first version that cut any flat edge also trimmed 281 of the 928 unedited images
(studio backgrounds, skies) and lowered AI images at strong on them from 70.7% to 66.6%, so
plain margins without text are left alone. Results (`results_robustness.json` before,
`results_robustness_trim.json` after):

| Edit | AUC | Real photos at strong | Real at weak | AI at strong | AI above 0.5 |
| --- | --- | --- | --- | --- | --- |
| none (original) | 0.976 → 0.976 | 0.3% → 0.3% | 2.3% → 2.3% | 70.7% → 70.7% | 92.4% → 92.4% |
| **caption band** | 0.872 → **0.970** | 0.0% → 0.0% | 0.0% → 0.9% | 2.9% → **57.0%** | 22.0% → 85.3% |
| **screenshot** | 0.948 → **0.958** | 0.0% → 0.0% | 1.1% → 1.4% | 41.1% → **57.4%** | 80.1% → 84.1% |
| center crop 60% | 0.961 → 0.961 | 0.6% → 0.6% | 2.6% → 2.6% | 55.6% → 55.5% | 86.0% → 85.8% |
| corner crop 50% | 0.951 → 0.951 | 0.0% → 0.0% | 0.0% → 0.0% | 40.6% → 40.6% | 78.7% → 78.7% |
| filter edit | 0.967 → 0.967 | 1.4% → 1.4% | 2.6% → 2.6% | 64.0% → 63.8% | 91.0% → 91.0% |
| rotate 3° | 0.971 → 0.971 | 0.3% → 0.3% | 1.7% → 1.7% | 61.5% → 61.5% | 90.1% → 90.1% |
| social recompress | 0.967 → 0.966 | 0.9% → 0.9% | 2.0% → 2.0% | 59.8% → 59.6% | 89.8% → 89.8% |

No edit raises real photos at the strong band, and unedited images score as before. The
other changes are one image each. Real photos at the weak band rose by one to three images
for captions and screenshots; that band only counts together with other evidence. Captioned
and screenshotted AI images still score below the originals: a bar is only cut where its
edge is straight, which a dark picture under dark app bars may not show, and a gap-only rule
(no edge check) that recovered screenshots to 64.5% lowered unedited AI images at strong to
69.8%. Corner crops are untouched by this and remain the weakest case.

## License

Code: MIT. Model weights: CC BY-NC-SA 4.0 (derived from the training data), non-commercial.
