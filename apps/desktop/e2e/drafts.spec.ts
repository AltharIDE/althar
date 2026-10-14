import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * What is written in the coordinator's composer is there again after the
 * home and back, in the built app; and what was dictated is written down
 * while the person is on the home, and waits in the composer with a quiet
 * line saying so. The speech process's stand-in takes a few seconds to
 * write anything down (ALTHAR_FAKE_SPEECH_SLOW), as a busy machine or a
 * long dictation would.
 */

const SLOW = 3_000

test('keeps the draft through the home and back, and dictation finishes while the person is away', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_SPEECH: '1', ALTHAR_FAKE_SPEECH_SLOW: String(SLOW) })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    const box = page.getByRole('textbox', { name: /^Tell .* something/ })
    const toHome = () => tabs.getByRole('button', { name: /^Home/ }).click()
    const toProject = () => tabs.getByRole('button', { name: /^meridian/ }).click()

    // Written, then the home, then back: it is there, the cursor at its end.
    await box.click()
    await box.fill('Before the PR, look at why checkout is slow.')
    await page.screenshot({ path: 'test-results/drafts-1-written.png', animations: 'disabled' })
    await toHome()
    await expect(box).toBeHidden()
    await page.screenshot({ path: 'test-results/drafts-2-home.png', animations: 'disabled' })
    await toProject()
    await expect(box).toHaveValue('Before the PR, look at why checkout is slow.')
    await expect(box).toHaveJSProperty('selectionStart', 'Before the PR, look at why checkout is slow.'.length)
    await page.screenshot({ path: 'test-results/drafts-3-back.png', animations: 'disabled' })

    // Dictation, the first time: the model comes down, and it listens.
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await page.getByRole('group', { name: 'Dictation' }).getByRole('button', { name: 'Download' }).click()
    const stop = page.getByRole('button', { name: /^Stop dictating/ })
    await expect(stop).toBeVisible({ timeout: 10_000 })
    await expect(stop).toHaveAccessibleName('Stop dictating, 0:02', { timeout: 5_000 })
    await stop.click()
    const writing = page.getByRole('button', { name: 'Writing down what you said' })
    await expect(writing).toBeVisible()
    await page.screenshot({ path: 'test-results/drafts-4-writing.png', animations: 'disabled' })

    // Away while it is written down; it lands meanwhile.
    await toHome()
    await expect(box).toBeHidden()
    await page.waitForTimeout(SLOW * 2)
    await toProject()
    await expect(box).toHaveValue('Before the PR, look at why checkout is slow. Also check the webhook retry path.')
    await expect(page.getByText('What you said was written down while you were away.')).toBeVisible()
    await page.screenshot({ path: 'test-results/drafts-5-landed-while-away.png', animations: 'disabled' })

    // Away while it listens: it stops, and what was said is written down; back before it is done, the composer says it is still writing.
    await box.fill('')
    await page.keyboard.press('Control+Shift+KeyD')
    await expect(stop).toHaveAccessibleName('Stop dictating, 0:01', { timeout: 5_000 })
    await toHome()
    await expect(box).toBeHidden()
    await toProject()
    await expect(writing).toBeVisible()
    await expect(box).toHaveJSProperty('readOnly', true)
    await page.screenshot({ path: 'test-results/drafts-6-still-writing.png', animations: 'disabled' })
    await expect(box).toHaveValue('Also check the webhook retry path.', { timeout: SLOW * 4 })
    await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/drafts-7-landed.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
