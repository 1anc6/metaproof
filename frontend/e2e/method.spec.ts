import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test('the Method page shows what everyday edits do to the detector', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto('/method')

  const chart = page.getByRole('list', { name: /scored 91% or more after each edit/ })
  const rows = chart.getByRole('listitem')
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toContainText('Unedited')
  await expect(rows.first()).toContainText('70.7%')
  await expect(rows.last()).toContainText('Corner crop')
  await expect(rows.last()).toContainText('40.6%')

  // The detail appears for a keyboard (or a tap) as well as a pointer.
  const corner = rows.last()
  await expect(corner.getByText('Half of each side kept, from a corner', { exact: true })).toBeHidden()
  await corner.focus()
  await expect(corner.getByText('Half of each side kept, from a corner', { exact: true })).toBeVisible()
  await expect(corner.getByText(/78\.7% of AI images above 50% · AUC 0\.951/)).toBeVisible()

  await expect(page.getByText(/Real photos reach this band at most 1\.4% of the time/)).toBeVisible()
})
