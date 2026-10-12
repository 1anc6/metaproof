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
