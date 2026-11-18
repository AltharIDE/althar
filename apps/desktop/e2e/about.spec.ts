import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, still } from './support'

/*
 * About Althar in the built app: its head under Early access with the ways out, storage as tiles, and the two
 * switches side by side, light and dark and at a narrow window; then Free up space, which lands on the task
 * folders' row under Work on this computer, lit for a moment. Each shot is kept in test-results/about.
 */

const THIS_COMPUTER = process.platform === 'darwin' ? 'this Mac' : process.platform === 'win32' ? 'this PC' : 'this computer'

const shoot = async (page: Page, name: string, settle = true) => {
  if (settle) await still(page)
  await page.screenshot({ path: `test-results/about/${name}.png`, scale: 'css' })
}

test('draws About Althar, and Free up space lands on the task folders, lit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repo)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.keyboard.press('ControlOrMeta+Shift+Comma')
      await page
        .getByRole('navigation', { name: 'Settings' })
        .getByRole('button', { name: /^About Althar/ })
        .click()
      const main = page.getByRole('main')
      await expect(main.getByText('Early access')).toBeVisible()
      await expect(main.getByRole('link', { name: /What’s new/ })).toHaveAttribute('href', 'https://althar.ai/changelog')
      await expect(main.getByRole('switch', { name: 'Usage data' })).toBeVisible()
      await expect(main.getByText(/\d+(\.\d)? (B|KB|MB|GB)$/).first()).toBeVisible()
      await shoot(page, `about-${scheme}`)
    }

    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('main').getByRole('button', { name: 'Free up space' }).click()
    await expect(page.getByRole('heading', { name: `Work on ${THIS_COMPUTER}`, level: 1 })).toBeVisible()
    await expect(page.getByRole('main').getByText('Remove finished tasks’ folders')).toBeVisible()
    await page.waitForTimeout(300)
    await shoot(page, 'free-up-lit', false)
    await page.waitForTimeout(1500)
    await shoot(page, 'free-up-settled')

    await sizeWindow(electronApp, page, 800, 800)
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^About Althar/ })
      .click()
    await shoot(page, 'about-800')
  } finally {
    await electronApp.close()
  }
})
