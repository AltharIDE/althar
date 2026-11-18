import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, sizeWindow, still } from './support'

/*
 * The conversation bar's shadow: none while the thread sits at its top, a light one once it has scrolled under the bar,
 * in light and dark. The screenshots are the evidence (test-results/bar-shadow-*.png).
 */

const shoot = async (page: Page, name: string) => {
  await still(page)
  await page.screenshot({ path: `test-results/bar-shadow-${name}.png`, clip: { x: 0, y: 90, width: 560, height: 110 }, scale: 'css' })
}

for (const appearance of ['light', 'dark'] as const) {
  test(`the conversation bar shades the thread scrolled under it (${appearance})`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
    const projects = join(home, 'Projects')
    mkdirSync(projects)
    mkdirSync(join(home, 'profile'), { recursive: true })
    writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance }))
    const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
    try {
      await sizeWindow(electronApp, page, 1100, 560)
      await openFirstProject(electronApp, page, repository(projects))
      for (const n of [1, 2, 3, 4]) await say(page, `Question ${n}: what does the checkout retry do?`)
      // The face's scroll area: its edge first, then the scroller.
      const area = page.locator('[data-floats-host] > div:first-child').filter({ visible: true }).first()
      const scroller = area.locator('> div').nth(1)
      await scroller.evaluate((el) => (el.scrollTop = 0))
      await expect(area).not.toHaveAttribute('data-scrolled', '')
      await shoot(page, `${appearance}-unscrolled`)
      await scroller.evaluate((el) => (el.scrollTop = 120))
      await expect(area).toHaveAttribute('data-scrolled', '')
      await shoot(page, `${appearance}-scrolled`)
    } finally {
      await electronApp.close()
    }
  })
}
