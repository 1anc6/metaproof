// MetaProof service worker. It does one job: receive images shared from another app (the
// manifest's share_target) and hand them to the upload page. Every other request goes to the
// network untouched, so a new deploy is never hidden behind a stale cache.

const SHARE_CACHE = 'metaproof-share-v1'
const SHARED_KEY = '/__shared-image'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return
  event.respondWith(receiveShare(event.request))
})

async function receiveShare(request) {
  try {
    const form = await request.formData()
    const file = form.getAll('image').find((f) => f instanceof File && f.size > 0)
    if (!file) return Response.redirect('/new?shared=none', 303)
    // Kept on this device only until the upload page picks it up.
    const cache = await caches.open(SHARE_CACHE)
    await cache.put(SHARED_KEY, new Response(file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name || 'shared-image') },
    }))
    return Response.redirect('/new?shared=1', 303)
  } catch {
    return Response.redirect('/new?shared=error', 303)
  }
}
