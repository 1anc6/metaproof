import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { JOB_ID, mockApi, seedHistory, skipWelcome } from './mock-api'

// Every screen, with a finished analysis in the history so the cards have something to show,
// checked by axe against WCAG 2.1 A and AA in both themes.
const SCREENS = [
  ['overview', '/'],
  ['new analysis', '/new'],
  ['report', `/analysis/${JOB_ID}`],
  ['history', '/history'],
  ['method', '/method'],
  ['settings', '/settings'],
] as const

for (const scheme of ['dark', 'light'] as const) {
  for (const [name, path] of SCREENS) {
    test(`${name} has no WCAG A or AA violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await mockApi(page)
      await skipWelcome(page)
      await seedHistory(page)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await page.waitForLoadState('networkidle')

      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      // One line per failing element, so a failure says what to fix without opening the trace.
      const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim()}`))
      expect(found).toEqual([])
    })
  }
}
