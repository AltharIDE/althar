import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, toConversation } from './support'

/*
 * What the task built and the evidence its lead hands as it finishes, in a
 * real window with the fake agent (`[lead:evidence]`): what it built, then a
 * screenshot it saved in its worktree, served from the artifact store, a
 * test run and what it couldn't try; at the top of what the task made, and
 * under its lead's report in the thread, as what it said last; and narrow,
 * the change over what it made. The screenshots it takes are
 * this change's own evidence (test-results/evidence-*.png).
 */

test('shows what the task built and what the lead showed of it: atop its outputs, and as its lead’s result in its thread', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit] [lead:evidence]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()

    // A ready task opens on what it made: what it is at the top, then how it looks, then what it checked.
    await expect(page.getByRole('heading', { name: 'What changed', level: 2 })).toBeVisible()
    await expect(page.getByText('Checkout retries once when the payment call fails')).toBeVisible()
    await expect(page.getByRole('heading', { name: /^What it looks like/, level: 2 })).toBeVisible()
    const shot = page.getByRole('button', { name: /View The retry button after a failed checkout full size/ }).getByRole('img')
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    expect(await shot.getAttribute('src')).toMatch(/^althar-picture:\/\/shot\/[0-9a-f]{64}\?w=1120$/)
    await page.getByRole('button', { name: 'What it printed: The checkout tests' }).click()
    await expect(page.getByText('1 passed')).toBeVisible()
    await expect(page.getByText('Not tried against the real payment provider: no sandbox account')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/evidence-outputs.png', fullPage: true })

    // Its screenshot opens full size.
    await page.getByRole('button', { name: /View The retry button after a failed checkout full size/ }).click()
    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/evidence-lightbox.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // In the conversation, the lead's report is what it said last: what it built, its screenshot large, what it checked
    // and what it couldn't; no card closes the thread (ADR-042).
    await toConversation(page)
    const round = page.getByRole('article').filter({ hasText: 'Checkout retries once when the payment call fails' }).last()
    await expect(round.getByRole('button', { name: /View The retry button after a failed checkout full size/ })).toBeVisible()
    await expect(round.getByText('What it checked')).toBeVisible()
    await expect(round.getByText('Not checked')).toBeVisible()
    await expect(page.getByRole('article', { name: 'What the task built' })).toHaveCount(0)
    await round.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/evidence-thread.png', fullPage: true })
    await round.screenshot({ path: 'test-results/evidence-round.png' })

    // Narrow, as beside the Connect panel: the change first, its button and its files in reach, what it made under it.
    // The window's own minimum is wider than what that panel leaves the page, so it goes lower for this.
    await (
      await electronApp.browserWindow(page)
    ).evaluate((window) => {
      window.setMinimumSize(600, 600)
      window.setSize(760, 900)
    })
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    const card = page.getByRole('article').filter({ has: page.getByRole('button', { name: /^Review the diff/ }) })
    await expect(card.getByRole('button', { name: /^Merge into/ })).toBeVisible()
    const top = async (one: Locator) => (await one.boundingBox())?.y ?? Number.NaN
    const story = page.getByRole('heading', { name: 'What changed', level: 2 })
    await expect.poll(async () => (await top(story)) - (await top(card)), { timeout: 5_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/evidence-outputs-narrow.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
