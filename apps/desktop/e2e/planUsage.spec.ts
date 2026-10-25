import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * Plan usage in the window's bar: the gauge after CPU and memory, and its
 * peek from a click and from Control-U (⌘U on a Mac). The fake usage
 * endpoint answers every plan with its five hours 97% used
 * (ALTHAR_FAKE_PLAN), so the bar says who is nearly out beside the gauge.
 */

test('shows the plan gauge once a plan is read, says who is nearly out, and opens its peek from the bar and the key', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_PLAN: '97' })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const gauge = page.getByRole('button', { name: /^Plan usage: .* has 3% left/ })
    await expect(gauge).toBeVisible()
    await expect(page.locator('output').filter({ hasText: /3% · / })).toBeVisible()
    await gauge.click()
    const peek = page.getByRole('dialog', { name: 'Plan usage' })
    await expect(peek).toBeVisible()
    await expect(peek.getByText(/is nearly out/)).toBeVisible()
    // The gauge, what the bar says beside it and the peek under it, at 1×.
    const box = (await peek.boundingBox())!
    const at = (await gauge.boundingBox())!
    const left = Math.max(0, Math.min(box.x, at.x) - 120)
    await page.screenshot({
      path: 'test-results/plan-usage.png',
      animations: 'disabled',
      scale: 'css',
      clip: { x: left, y: 0, width: Math.max(box.x + box.width, at.x + at.width + 160) + 12 - left, height: box.y + box.height + 12 },
    })
    await page.keyboard.press('Escape')
    await expect(peek).toBeHidden()
    // The key opens it, and the same key closes it.
    const key = process.platform === 'darwin' ? 'Meta+u' : 'Control+u'
    await page.keyboard.press(key)
    await expect(peek).toBeVisible()
    await page.keyboard.press(key)
    await expect(peek).toBeHidden()
  } finally {
    await electronApp.close()
  }
})
