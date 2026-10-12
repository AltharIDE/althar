import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, say } from './support'

/*
 * The effort the coordinator picks for a step, in a real window with the
 * fake agent: `[coordinator:plan-effort]` plans its lead on the large model
 * at high effort. The plan's card shows it as one the person chose, and the
 * person changes it there before the plan starts.
 */

test('shows on the plan the effort the coordinator picked for its lead, which the person can change before it starts', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  // Where people keep code, so the first screen finds it.
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  repository(projects)
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await page
      .getByRole('list', { name: 'Repositories for the project' })
      .getByRole('checkbox', { name: /meridian/ })
      .click()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await say(page, 'Rework how the cache expires. [coordinator:plan-effort] [coordinator:plan-no-review] [lead:finish]')

    // The lead at the coordinator's effort, on its card with the time it starts.
    const lead = page.getByRole('button', { name: /^Lead for this task: .*Large High$/ })
    await expect(lead).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/^Starts in \d+s$/)).toBeVisible()
    await page.getByRole('button', { name: 'Hold' }).click()
    await expect(page.getByText('Held. Starts when you say')).toBeVisible()
    const plan = page.locator('div[data-rhythm]', { has: lead }).last()
    await plan.screenshot({ path: 'test-results/plan-effort.png', animations: 'disabled' })
    await page.screenshot({ path: 'test-results/plan-effort-window.png', animations: 'disabled' })

    // Changed by the person, as their own pick would be.
    await lead.click()
    await page.getByRole('radio', { name: 'Low' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Lead for this task: .*Large Low$/ })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
