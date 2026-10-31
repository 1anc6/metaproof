import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test('a page whose code cannot load reloads once, then explains instead of going blank', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  // What a tab opened before a deploy sees: the page's old file is gone.
  let requests = 0
  await page.route('**/assets/Method-*.js', (route) => {
    requests++
    return route.abort()
  })
  await page.goto('/method')
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  expect(requests).toBe(2) // the first try, then once more after the automatic reload
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()

  // The rest of the app still works.
  await page.getByRole('link', { name: 'Go to overview' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})
