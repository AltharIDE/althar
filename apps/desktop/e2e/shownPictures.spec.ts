import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, toConversation } from './support'

/*
 * Pictures a lead shows in its thread once its task is done, with no step
 * open (show_pictures), in a real window with the fake agent
 * (`[lead:show]`): captioned, in order, under what the person asked, each
 * opening in the lightbox with the other a key away. The screenshots it
 * takes are this change's own evidence (test-results/shown-*.png).
 */

test('shows the pictures a lead shows after its task is done, captioned, opening in the lightbox', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // Its plan is done, so no step is open: asked to see it, the lead shows it all the same.
    await say(page, 'Can I see checkout before and after? [lead:show]')
    const round = page.getByRole('article').filter({ hasText: 'Those are the two states.' }).last()
    const before = round.getByRole('button', { name: 'View Checkout before the retry: the payment fails once full size' })
    await expect(before).toBeVisible()
    await expect(round.getByRole('button', { name: 'View Checkout after the retry: it goes through full size' })).toBeVisible()
    await expect.poll(() => before.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    expect(await before.getByRole('img').getAttribute('src')).toMatch(/^althar-picture:\/\/shot\/[0-9a-f]{64}\?w=1120$/)
    await expect(page.getByText(/No step is waiting/)).toHaveCount(0)
    await round.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    // The set runs wider than the round's words: the shot takes both.
    const boxes = await Promise.all([round.boundingBox(), before.locator('xpath=ancestor::figure/..').boundingBox()])
    const x = Math.min(...boxes.map((box) => box?.x ?? 0)) - 8
    const y = Math.min(...boxes.map((box) => box?.y ?? 0)) - 8
    const right = Math.max(...boxes.map((box) => (box?.x ?? 0) + (box?.width ?? 0))) + 8
    const bottom = Math.max(...boxes.map((box) => (box?.y ?? 0) + (box?.height ?? 0))) + 8
    await page.screenshot({ path: 'test-results/shown-round.png', scale: 'css', clip: { x, y, width: right - x, height: bottom - y } })

    // Each opens full size, the other a key away.
    await before.click()
    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    await expect(page.getByRole('dialog', { name: 'before.png' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: 'after.png' })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/shown-lightbox.png', scale: 'css' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
