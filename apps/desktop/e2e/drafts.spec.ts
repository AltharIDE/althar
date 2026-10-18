import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * What is written in the coordinator's composer is there again after the
 * home and back, in the built app; what was dictated is written down while
 * the person is on the home, and waits in the composer with a quiet line
 * saying so; and dictation that is still listening as they leave goes on, in
 * a pill on the home, from which it is sent. The speech process's stand-in takes a few seconds to
 * write anything down (ALTHAR_FAKE_SPEECH_SLOW), as a busy machine or a
 * long dictation would.
 */

const SLOW = 3_000

test('keeps the draft through the home and back, and dictation finishes while the person is away', async () => {
  // Three slow writings down, and a wait on the home: more than a quick spec's time on a busy machine.
  test.setTimeout(120_000)
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

    // Away while it listens: it goes on listening, carried in a pill at the window's foot, saying whose it is.
    await box.fill('')
    await page.keyboard.press('Control+Shift+KeyD')
    await expect(stop).toHaveAccessibleName('Stop dictating, 0:01', { timeout: 5_000 })
    await toHome()
    await expect(box).toBeHidden()
    const pill = page.getByRole('group', { name: 'To the coordinator · meridian' })
    await expect(pill).toBeVisible()
    await expect(pill).toContainText('0:03', { timeout: 5_000 })
    const width = (await pill.boundingBox())?.width
    await pill.screenshot({ path: 'test-results/drafts-6-carried-on-home.png', scale: 'css', animations: 'disabled' })
    // Its width holds as it goes on.
    await expect(pill).toContainText('0:04', { timeout: 5_000 })
    expect((await pill.boundingBox())?.width).toBe(width)

    // Stopped from the pill: it is written down, and opens to read, change and send.
    await pill.getByRole('button', { name: /^Stop and write it down/ }).click()
    await expect(pill).toContainText('Writing it down…')
    await pill.screenshot({ path: 'test-results/drafts-7-writing-on-home.png', scale: 'css', animations: 'disabled' })
    const card = page.getByRole('region', { name: 'To the coordinator · meridian' })
    const said = card.getByRole('textbox', { name: 'What you said' })
    await expect(said).toHaveValue('Also check the webhook retry path.', { timeout: SLOW * 4 })
    await card.screenshot({ path: 'test-results/drafts-8-written-on-home.png', scale: 'css', animations: 'disabled' })

    // Sent from the home, to the coordinator: there in its conversation, and the composer empty.
    await card.getByRole('button', { name: 'Send to the coordinator' }).click()
    await expect(card).toBeHidden()
    await toProject()
    await expect(page.getByText('Also check the webhook retry path.').first()).toBeVisible()
    await expect(box).toHaveValue('')
    await page.screenshot({ path: 'test-results/drafts-9-sent-from-home.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
