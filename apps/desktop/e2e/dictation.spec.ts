import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * Dictating into the coordinator the first time, in the built app: the
 * microphone offers the speech model, Download brings it down, it listens,
 * shows what it hears as it hears it, and what was said lands at the cursor
 * without being sent. Then the shortcut starts it, and Escape throws it
 * away. Chromium's fake microphone and the speech process's stand-in model
 * (ALTHAR_FAKE_SPEECH) stand in for a voice and the real model.
 */

test('offers the speech model on the first press, downloads it, listens, and writes at the cursor without sending', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_SPEECH: '1' })
  try {
    await chooseFolder(electronApp, meridian)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const box = page.getByRole('textbox', { name: /^Tell .* something/ })
    await box.fill('Before the PR, ')

    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    const tray = page.getByRole('group', { name: 'Dictation' })
    await expect(tray.getByText(/^Dictation needs a speech model on this/)).toBeVisible()
    await expect(tray.getByText(/670 MB, downloaded once/)).toBeVisible()
    await page.screenshot({ path: 'test-results/dictation-offer.png', animations: 'disabled' })

    await tray.getByRole('button', { name: 'Download' }).click()
    await expect(tray.getByText('Downloading the speech model')).toBeVisible()
    await page.screenshot({ path: 'test-results/dictation-downloading.png', animations: 'disabled' })

    // Here, with the tray still open: it listens.
    const stop = page.getByRole('button', { name: /^Stop dictating/ })
    await expect(stop).toBeVisible({ timeout: 10_000 })
    await expect(tray).toBeHidden()
    await expect(stop).toHaveAccessibleName('Stop dictating, 0:01', { timeout: 5_000 })
    // What is heard shows faint where it will land, as it is said, and the field waits.
    const faint = page.locator('[aria-hidden="true"][class*="interim"]')
    await expect(faint).toHaveText('Before the PR, Also check the webhook retry path.')
    await expect(box).toHaveJSProperty('readOnly', true)
    await page.screenshot({ path: 'test-results/dictation-listening.png', animations: 'disabled' })
    await stop.click()
    await expect(box).toHaveValue('Before the PR, Also check the webhook retry path.')
    // Written, not sent: the coordinator's thread doesn't have it.
    await expect(page.getByText('Also check the webhook retry path.', { exact: true })).toBeHidden()

    // From now on the microphone listens at once, from the shortcut too; Escape throws it away.
    await page.keyboard.press('Control+Shift+KeyD')
    await expect(stop).toBeVisible()
    await expect(tray).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible()
    await expect(box).toHaveValue('Before the PR, Also check the webhook retry path.')
  } finally {
    await electronApp.close()
  }
})
