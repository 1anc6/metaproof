import { expect, test } from '@playwright/test'
import { JOB_ID, SHA, mockApi, seedHistory, skipWelcome } from './mock-api'

// `vite preview` sends vercel.json's headers (vite.config.ts), so these screens run under the
// production Content-Security-Policy. Anything it blocks fails here before it fails for visitors.
const SCREENS = [
  ['overview', '/'],
  ['new analysis', '/new'],
  ['analysis', `/analysis/${JOB_ID}`],
  ['report', `/report/${SHA}`],
  ['history', '/history'],
  ['method', '/method'],
  ['settings', '/settings'],
] as const

for (const [name, path] of SCREENS) {
  test(`${name} runs under the Content-Security-Policy`, async ({ page }) => {
    const violations: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) violations.push(msg.text())
    })
    await mockApi(page)
    await skipWelcome(page)
    await seedHistory(page)
    const response = await page.goto(path)
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    expect(violations).toEqual([])
  })
}

test('the inline theme script is allowed by its hash', async ({ page }) => {
  // It sets data-theme before first paint. If index.html's script changes, update its
  // sha256 in vercel.json's script-src (the console error names the new hash).
  await page.emulateMedia({ colorScheme: 'dark' })
  await skipWelcome(page)
  await page.route('**/assets/*.js', (route) => route.abort()) // only the inline script runs
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
