import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * A built-in preset names no model, and the person tunes it as their own, in a real window: Settings › Tasks › Presets,
 * Prototype tuned with a lead and a brief of theirs, then reset to the built-in. The screenshots it takes are this
 * change's own evidence (test-results/preset-*.png).
 */

test('a built-in preset names no model, is tuned as the person’s own, and resets to the built-in', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'light' }))
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  try {
    await page.setViewportSize({ width: 1180, height: 1000 })
    await openFirstProject(electronApp, page, repository(home))
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    const presets = page.getByRole('main').getByRole('region', { name: 'Presets' })
    const shoot = (name: string) => presets.screenshot({ path: `test-results/preset-${name}.png`, scale: 'css', animations: 'disabled' })
    // As built in: Prototype names no lead.
    await expect(presets.getByText('a worktree, no review, ends here, the coordinator picks its lead')).toHaveCount(1)
    await expect(presets.getByText('Tuned')).toHaveCount(0)

    // Tuned: a lead of theirs and a brief.
    await presets.getByRole('button', { name: 'Tune' }).nth(4).click()
    await expect(presets.getByText('Picked for each task')).toBeVisible()
    await presets.getByRole('button', { name: 'Choose a model' }).click()
    // A model of theirs, from the picker, and how hard it thinks.
    await presets.getByRole('button', { name: /^Lead: / }).click()
    await page.getByRole('dialog', { name: 'Lead model and effort' }).getByRole('radio', { checked: false }).first().click()
    await expect(presets.getByRole('button', { name: /^Lead: / })).toBeVisible()
    const brief = presets.getByLabel(/Brief/)
    await brief.fill('Three directions on one live page, with a switcher.')
    await shoot('tuning')
    await presets.getByRole('button', { name: 'Save' }).click()
    await expect(presets.getByText('Tuned')).toBeVisible()
    await expect(presets.getByText(/^a worktree, no review, ends here, led by (?!claude-code’s own)/)).toBeVisible()
    await shoot('tuned')

    // Reset: the built-in again, naming no model.
    await presets.getByRole('button', { name: 'Reset' }).click()
    await expect(presets.getByText('Tuned')).toHaveCount(0)
    await expect(presets.getByText('a worktree, no review, ends here, the coordinator picks its lead')).toHaveCount(1)
    await shoot('reset')
  } finally {
    await electronApp.close()
  }
})
