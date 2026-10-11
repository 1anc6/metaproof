// Images shared from another app arrive through the service worker (public/sw.js), which keeps
// the file in a local cache and opens /new?shared=1. This takes it out exactly once.
const SHARE_CACHE = 'metaproof-share-v1'
const SHARED_KEY = '/__shared-image'

export async function takeSharedImage(): Promise<File | null> {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const res = await cache.match(SHARED_KEY)
    if (!res) return null
    await cache.delete(SHARED_KEY) // the shared file never lingers on the device
    const name = decodeURIComponent(res.headers.get('X-Filename') ?? '') || 'shared-image'
    const blob = await res.blob()
    return new File([blob], name, { type: blob.type || res.headers.get('Content-Type') || '' })
  } catch {
    return null
  }
}
