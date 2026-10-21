import { Copy, Droplets, Fingerprint, Layers, ShieldCheck, Sparkles } from 'lucide-react'
import type { RadialItem } from '../components/ui'
import { DEMO_REPORT_PATH } from './demo'

/** The stored example report's image, for the blurred photo panels. */
export const DEMO_SHA = DEMO_REPORT_PATH.split('/').pop()!

/** The six checks, with what each one does and how much weight its findings carry. */
export const CHECKS: (RadialItem & { detail: string; weight: string })[] = [
  { key: 'metadata', label: 'Metadata', icon: Fingerprint, detail: 'EXIF, XMP and the traces generators leave in a file.', weight: 'Weak to strong' },
  { key: 'structure', label: 'Structure', icon: Layers, detail: 'JPEG quality, segments and colour profile: how the file was written.', weight: 'Explains only' },
  { key: 'c2pa', label: 'Credentials', icon: ShieldCheck, detail: 'Signed C2PA provenance, checked with the official SDK.', weight: 'Can decide' },
  { key: 'watermark', label: 'Watermark', icon: Droplets, detail: 'The invisible mark Stable Diffusion tools hide in the pixels.', weight: 'Strong' },
  { key: 'detector', label: 'AI detector', icon: Sparkles, detail: 'A calibrated classifier on CLIP features, tested on unseen generators.', weight: 'One signal' },
  { key: 'similar', label: 'Seen before', icon: Copy, detail: 'Finds resized, cropped or recompressed copies analyzed earlier.', weight: 'Context' },
]

