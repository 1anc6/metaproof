import { expect, test } from '@playwright/test'
import { JOB_ID, mockApi, skipWelcome } from './mock-api'

test.use({ viewport: { width: 390, height: 844 } })

test('the app can be installed: manifest with a share target and a service worker', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto('/')
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.share_target.action).toBe('/share-target')
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  expect(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active))).toBe(true)
})

test('a photo shared from another app is analyzed straight away', async ({ context, page }) => {
  const api = await mockApi(context) // context-wide, so requests after the service worker are faked too
  await skipWelcome(context)
  await page.goto('/settings')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // let the service worker control the page

  // What Android's share sheet sends: a multipart POST navigation to the share target.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<form id="share" method="post" action="/share-target" enctype="multipart/form-data"><input type="file" name="image" id="shared"></form>')
  })
  await page.setInputFiles('#shared', { name: 'from-whatsapp.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) })
  await page.evaluate(() => (document.getElementById('share') as HTMLFormElement).submit())

  await expect(page).toHaveURL(new RegExp(`/analysis/${JOB_ID}$`))
  expect(api.uploads).toHaveLength(1)
  // The shared file is gone from the device once the upload page took it.
  expect(await page.evaluate(async () => !!(await (await caches.open('metaproof-share-v1')).match('/__shared-image')))).toBe(false)
})

test('sharing something unusable explains what went wrong', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new?shared=none')
  await expect(page.getByText(/Nothing MetaProof can analyze was shared/)).toBeVisible()
  await expect(page).toHaveURL(/\/new$/)
})
