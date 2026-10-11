// Results of ml/train.py (results_vitb16.json) on 9 generators the model never saw in
// training. "Clean" = as the API sees uploads; "recompressed" = 50% downscale + JPEG q60.

export const SUMMARY = {
  model: 'CLIP ViT-B/16 + MLP head, temperature-calibrated',
  trainImages: 25751,
  testImages: 4239,
  auc: 0.953,
  aucRecompressed: 0.95,
  calibrationError: 0.01,
}

/** Share of AI images scored above 0.5, per held-out generator. */
export const GENERATORS: { name: string; clean: number; recompressed: number }[] = [
  { name: 'Firefly Image 3', clean: 0.987, recompressed: 0.997 },
  { name: 'DALL·E 3', clean: 0.977, recompressed: 0.987 },
  { name: 'Stable Cascade', clean: 0.977, recompressed: 0.997 },
  { name: 'Midjourney 6.1', clean: 0.938, recompressed: 0.991 },
  { name: 'FLUX dev', clean: 0.937, recompressed: 0.973 },
  { name: 'FLUX schnell', clean: 0.934, recompressed: 0.957 },
  { name: 'Imagen 3', clean: 0.934, recompressed: 0.98 },
  { name: 'Ideogram 2', clean: 0.883, recompressed: 0.943 },
  { name: 'SDXL-LCM', clean: 0.873, recompressed: 0.973 },
]

/**
 * How each detector score band affects the verdict. Rates are cumulative at the band's
 * threshold, measured clean / recompressed: share of AI images at or above it ("caught")
 * and share of real photos wrongly at or above it ("false alarm").
 */
export const BANDS: { range: string; effect: string; caught: string; falseAlarm: string }[] = [
  { range: '≥ 95%', effect: 'Strong AI evidence: can decide alone', caught: '60% / 76%', falseAlarm: '1.8% / 5.2%' },
  { range: '85–95%', effect: 'Leans AI: needs another clue', caught: '79% / 90%', falseAlarm: '5.2% / 13.8%' },
  { range: '10–85%', effect: 'Neutral: detector stays out', caught: '–', falseAlarm: '–' },
  { range: '< 10%', effect: 'Weak support for a real photo (only 0.7% / 0.1% of AI images score this low)', caught: '–', falseAlarm: '–' },
]
