import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

/*
 * Automations (ADR-057), the person's way through: asking the coordinator
 * for one, which proposes it on a card; turning it on there; finding it on
 * the project's Automations view, and on its own page, with its limits and
 * its runs; and making one by hand. The screenshots are this change's own
 * evidence (test-results/automations-*.png), at 1x.
 */

test('makes an automation by asking the coordinator, turns it on from its card, and keeps it on its own page', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await say(page, 'Every Friday at 16:00, write release notes from what merged this week. [coordinator:automate]')

    // Proposed on a card: nothing runs until the person turns it on.
    const proposed = page.getByText('Nothing runs until you turn it on.')
    await expect(proposed).toBeVisible({ timeout: 30_000 })
    const card = page.locator('[data-rhythm="card"]').filter({ has: proposed })
    await card.screenshot({ path: 'test-results/automations-1-proposed.png', animations: 'disabled', scale: 'css' })
    await card.getByRole('button', { name: 'Turn on' }).click()
    // Once on, the card folds to a line, with the way to its page.
    const folded = page.getByText(/is on\. It runs next/).locator('xpath=..')
    await expect(folded).toBeVisible({ timeout: 15_000 })
    const line = await folded.boundingBox()
    if (line !== null) {
      const clip = { x: line.x - 16, y: line.y - 16, width: line.width + 32, height: line.height + 32 }
      await page.screenshot({ path: 'test-results/automations-2-on.png', animations: 'disabled', scale: 'css', clip })
    }

    // On the project's Automations view, as a card.
    await page
      .getByRole('radiogroup', { name: 'View' })
      .getByRole('radio', { name: /^Automations/ })
      .click()
    await expect(page.getByRole('heading', { name: 'Automations', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Release notes' })).toBeVisible()
    await page.screenshot({ path: 'test-results/automations-3-view.png', animations: 'disabled', scale: 'css' })

    // Its own page: where it stands, what it does, its limits and its runs.
    await page.getByRole('button', { name: 'Release notes' }).click()
    await expect(page.getByRole('heading', { name: 'Limits' })).toBeVisible()
    await expect(page.getByText(/Runs next/)).toBeVisible()
    await page.screenshot({ path: 'test-results/automations-4-page.png', animations: 'disabled', scale: 'css', fullPage: true })

    // Made by hand: a blank page, its prompt ready to type.
    await page.getByRole('button', { name: 'Automations', exact: true }).click()
    await page.getByRole('button', { name: 'New automation' }).click()
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible()
    // From its name down to what it does, the prompt as wide as its card.
    const named = await page.getByPlaceholder('Name it').boundingBox()
    const does = await page.locator('[data-rhythm="card"]').first().boundingBox()
    if (named !== null && does !== null) {
      const clip = { x: does.x - 24, y: named.y - 24, width: does.width + 48, height: does.y + does.height - named.y + 48 }
      await page.screenshot({ path: 'test-results/automations-5-new.png', animations: 'disabled', scale: 'css', clip })
    }
  } finally {
    await electronApp.close()
  }
})
