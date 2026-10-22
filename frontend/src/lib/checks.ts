import { Copy, Droplets, Fingerprint, Layers, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import { DEMO_REPORT_PATH } from './demo'

/** The stored example report's image, for the photo card and the blurred backdrops. */
export const DEMO_SHA = DEMO_REPORT_PATH.split('/').pop()!

export interface Check {
  key: string
  label: string
  icon: LucideIcon
  detail: string
  weight: string
  /** The card's serif headline, in two lines; the last word of the second is set in italic. */
  headline: [string, string]
}

/** The six checks, with what each one does and how much weight its findings carry. */
export const CHECKS: Check[] = [
  { key: 'metadata', label: 'Metadata', icon: Fingerprint, detail: 'EXIF, XMP and the traces generators leave in a file.', weight: 'Weak to strong', headline: ['Read what the', 'file remembers'] },
  { key: 'structure', label: 'Structure', icon: Layers, detail: 'JPEG quality, segments and colour profile: how the file was written.', weight: 'Explains only', headline: ['See how the file', 'was written'] },
  { key: 'c2pa', label: 'Credentials', icon: ShieldCheck, detail: 'Signed C2PA provenance, checked with the official SDK.', weight: 'Can decide', headline: ['Who signed it,', 'and when'] },
  { key: 'watermark', label: 'Watermark', icon: Droplets, detail: 'The invisible mark Stable Diffusion tools hide in the pixels.', weight: 'Strong', headline: ['A mark hidden', 'in the pixels'] },
  { key: 'detector', label: 'AI detector', icon: Sparkles, detail: 'A calibrated classifier on CLIP features, tested on unseen generators.', weight: 'One signal', headline: ['A second look at', 'every pixel'] },
  { key: 'similar', label: 'Seen before', icon: Copy, detail: 'Finds resized, cropped or recompressed copies analyzed earlier.', weight: 'Context', headline: ['Have we seen', 'it before'] },
]
