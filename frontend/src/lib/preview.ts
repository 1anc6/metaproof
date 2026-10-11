// Local previews of images the user just picked, keyed by job id. Object URLs point at the
// file in the browser's memory: nothing extra is uploaded, and they vanish on reload.
const previews = new Map<string, string>()

export function rememberPreview(jobId: string, url: string) {
  previews.set(jobId, url)
}

export function previewFor(jobId: string): string | undefined {
  return previews.get(jobId)
}
