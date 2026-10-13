import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, toConversation } from './support'

/*
 * The evidence a lead hands as it finishes, in a real window with the fake
 * agent (`[lead:evidence]`): a screenshot it saved in its worktree, served
 * from the artifact store, a test run and what it couldn't try; under its
 * step in the thread, and under what the task changed. The screenshots it
 * takes are this change's own evidence (test-results/evidence-*.png).
 */

test('shows what the lead showed of its work: under its step, and under what the task changed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit] [lead:evidence]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()

    // A ready task opens on what it made: the evidence is under it.
    await expect(page.getByRole('heading', { name: 'Evidence', level: 2 })).toBeVisible()
    const shot = page.getByRole('list', { name: 'Screenshots' }).getByRole('img')
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

    // In the conversation, under the lead's step.
    await toConversation(page)
    await expect(page.getByText('Did the task.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Evidence', level: 4 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unverified', level: 4 })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/evidence-thread.png', fullPage: true })
  } finally {
    await electronApp.close()
  }
})
