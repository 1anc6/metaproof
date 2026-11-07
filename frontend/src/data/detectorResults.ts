// Results of ml/train.py (results_vitb16.json, detector v3) on 9 generators the model never
// saw in training. "Clean" = as the API sees uploads; "recompressed" = 50% downscale + JPEG q60.

export const SUMMARY = {
  model: 'CLIP ViT-B/16 + MLP head, temperature-calibrated',
  trainImages: 36528,
  testImages: 4239,
  auc: 0.972,
  aucRecompressed: 0.967,
  calibrationError: 0.01,
}

/** Share of AI images scored above 0.5, per held-out generator. */
export const GENERATORS: { name: string; clean: number; recompressed: number }[] = [
  { name: 'Stable Cascade', clean: 0.977, recompressed: 0.997 },
  { name: 'Firefly Image 3', clean: 0.974, recompressed: 0.983 },
  { name: 'DALL·E 3', clean: 0.963, recompressed: 0.97 },
  { name: 'Midjourney 6.1', clean: 0.938, recompressed: 0.957 },
  { name: 'FLUX dev', clean: 0.92, recompressed: 0.937 },
  { name: 'Imagen 3', clean: 0.92, recompressed: 0.953 },
  { name: 'FLUX schnell', clean: 0.891, recompressed: 0.937 },
  { name: 'Ideogram 2', clean: 0.857, recompressed: 0.903 },
  { name: 'SDXL-LCM', clean: 0.853, recompressed: 0.967 },
]

/**
 * The newest generators (2026), also never seen in training, from an independent benchmark
 * (zr-zhang, arXiv 2608.01258). Share scored above 0.5, as uploaded. The detector still
 * misses most of their images; the real photos in the same benchmark are flagged at 0.91 or
 * above only 0.2% of the time.
 */
export const NEWEST: { name: string; clean: number }[] = [
  { name: 'FLUX.2', clean: 0.377 },
  { name: 'Qwen Image 2.1', clean: 0.237 },
  { name: 'Nano Banana 2', clean: 0.213 },
  { name: 'GPT Image 2', clean: 0.21 },
]

/**
 * How each detector score band affects the verdict. Rates are cumulative at the band's
 * threshold, measured clean / recompressed: share of AI images at or above it ("caught")
 * and share of real photos wrongly at or above it ("false alarm").
 */
export const BANDS: { range: string; effect: string; caught: string; falseAlarm: string }[] = [
  { range: '≥ 91%', effect: 'Strong AI evidence: can decide alone', caught: '70% / 78%', falseAlarm: '1.3% / 2.7%' },
  { range: '79–91%', effect: 'Leans AI: needs another clue', caught: '82% / 89%', falseAlarm: '3.1% / 7.4%' },
  { range: '5–79%', effect: 'Neutral: detector stays out', caught: '–', falseAlarm: '–' },
  { range: '< 5%', effect: 'Weak support for a real photo (only 0.8% / 0.3% of AI images score this low)', caught: '–', falseAlarm: '–' },
]

/**
 * The live detector after edits people make before checking an image: ml/eval_robustness.py on
 * 928 held-out images (577 AI, 351 real), with the backend's border trimming
 * (ml/results_robustness_trim.json; src/data/detectorResults.test.ts keeps the two in step).
 * Percentages: AI images at or above the strong band (0.91, where the score can decide a
 * verdict on its own), real photos wrongly there, and AI images above 0.5.
 */
export const ROBUSTNESS_SAMPLE = { ai: 577, real: 351 }

/** AI images with a meme caption at the strong band before borders were trimmed (ml/results_robustness.json). */
export const CAPTION_BEFORE_TRIM = 2.9

export const ROBUSTNESS: { key: string; name: string; detail: string; aiStrong: number; realStrong: number; aiAbove50: number; auc: number }[] = [
  { key: 'original', name: 'Unedited', detail: 'As generated or taken', aiStrong: 70.7, realStrong: 0.3, aiAbove50: 92.4, auc: 0.9764 },
  { key: 'filter_edit', name: 'Photo filter', detail: 'Brighter, more contrast and colour, sharpened', aiStrong: 63.8, realStrong: 1.4, aiAbove50: 91.0, auc: 0.9673 },
  { key: 'rotate_3deg', name: 'Straightened', detail: 'Rotated 3° and cropped to hide the corners', aiStrong: 61.5, realStrong: 0.3, aiAbove50: 90.1, auc: 0.9709 },
  { key: 'social_recompress', name: 'Shared online', detail: 'Halved in size and saved as JPEG quality 60', aiStrong: 59.6, realStrong: 0.9, aiAbove50: 89.8, auc: 0.966 },
  { key: 'screenshot', name: 'Phone screenshot', detail: 'Shown 1080 px wide with app bars, saved as PNG', aiStrong: 57.4, realStrong: 0.0, aiAbove50: 84.1, auc: 0.9581 },
  { key: 'caption_band', name: 'Meme caption', detail: 'A white band of text added above the picture', aiStrong: 57.0, realStrong: 0.0, aiAbove50: 85.3, auc: 0.97 },
  { key: 'crop_center_60', name: 'Centre crop', detail: 'The middle 60% of each side kept', aiStrong: 55.5, realStrong: 0.6, aiAbove50: 85.8, auc: 0.9612 },
  { key: 'crop_corner_50', name: 'Corner crop', detail: 'Half of each side kept, from a corner', aiStrong: 40.6, realStrong: 0.0, aiAbove50: 78.7, auc: 0.9508 },
]
