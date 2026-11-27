import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

/*
 * Automations (ADR-061), the person's way through: asking the coordinator
 * for one, which proposes it on a card; turning it on there; finding it on
 * the project's Automations view, and on its own page, with its limits and
 * its runs; making one by hand; running it now, its run on its page until
 * it made something, and its task opened from there; and pausing it. The
 * screenshots are this change's own evidence (test-results/automations-*.png),
 * at 1x.
 */

/**
 * How its page says the next run of "the second Tuesday at 16:00" from now, as the window says it (its own way with days and dates): "Runs
 * next on 13 Oct at 16:0x", where the runtime staggers a run by up to four minutes. The runtime's next one is the first whose time hasn't
 * passed, so the two candidates cover a run just now due.
 */
const secondTuesdayWords = async (page: Page): Promise<RegExp> => {
  const words = await page.evaluate(() => {
    const now = new Date()
    const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const sentence = (at: Date) => {
      const days = Math.round((startOf(at) - startOf(now)) / 864e5)
      const day =
        days === 0
          ? 'today'
          : days === 1
            ? 'tomorrow'
            : days < 7
              ? `on ${at.toLocaleDateString(undefined, { weekday: 'long' })}`
              : `on ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
      return `Runs next ${day} at 16:0\\d`
    }
    const found: string[] = []
    for (let month = 0; found.length < 2; month += 1) {
      const first = new Date(now.getFullYear(), now.getMonth() + month, 1, 16)
      const at = new Date(first.getFullYear(), first.getMonth(), 1 + ((9 - first.getDay()) % 7) + 7, 16)
      if (at.getTime() + 5 * 60_000 > now.getTime()) found.push(sentence(at))
    }
    return found
  })
  return new RegExp(`^(${words.join('|')})$`)
}

test('makes an automation by asking the coordinator, turns it on from its card, and keeps it on its own page', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await say(page, 'Every Friday at 16:00, write release notes from what merged this week. [coordinator:automate]')

    // Proposed on a card, off until the person turns it on.
    const card = page.locator('[data-rhythm="card"]').filter({ has: page.getByRole('button', { name: 'Turn on' }) })
    // Its foot reads "Off", then the way to its limits.
    await expect(card.getByText(/^Off\b/)).toBeVisible()
    await card.screenshot({ path: 'test-results/automations-1-proposed.png', animations: 'disabled', scale: 'css' })
    await card.getByRole('button', { name: 'Turn on' }).click()
    // Once on, the card folds to a line, with the way to its page.
    const folded = page.getByText(/is on\. It runs next/).locator('xpath=..')
    await expect(folded).toBeVisible()
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

    // Set to run monthly, on the second Tuesday at 16:00: it shows its words and the date of its next run at once, and keeps both
    // once saved, on its page opened again.
    await page.getByRole('button', { name: /Every Friday at 16:00/ }).click()
    await page.getByRole('menuitem', { name: 'Monthly…' }).click()
    await page.getByRole('radio', { name: 'Weekday', exact: true }).click()
    await page.getByRole('combobox', { name: 'Which weekday of the month' }).click()
    await page.getByRole('option', { name: 'Second' }).click()
    await page.getByRole('combobox', { name: 'Weekday', exact: true }).click()
    await page.getByRole('option', { name: 'Tuesday' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    // Its next run is the second Tuesday's at 16:00 (and no more than the stagger after it), not the Friday's it was: said at once, and read
    // again from the runtime once the window starts over with nothing cached.
    const nextRun = page.getByText(await secondTuesdayWords(page))
    await expect(page.getByRole('button', { name: 'Monthly, on the second Tuesday at 16:00' })).toBeVisible()
    await expect(nextRun).toBeVisible()
    await page.reload()
    await page
      .getByRole('button', { name: 'Automations', exact: true })
      .or(page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: /^Automations/ }))
      .first()
      .click()
    await page.getByRole('button', { name: 'Release notes' }).click()
    await expect(page.getByRole('button', { name: 'Monthly, on the second Tuesday at 16:00' })).toBeVisible()
    await expect(nextRun).toBeVisible()
    await page.screenshot({ path: 'test-results/automations-4b-monthly.png', animations: 'disabled', scale: 'css', fullPage: true })

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

    // Turned on, it is made, and its own page opens.
    await page.getByPlaceholder('Name it').fill('Changelog')
    await page.getByPlaceholder('What should each run do?').fill('Write the changelog from what merged. [lead:finish] [lead:terse]')
    await page.getByRole('button', { name: 'Turn on' }).click()
    const runNow = page.getByRole('button', { name: 'Run now' })
    await expect(runNow).toBeVisible()

    // Run now: its run is on its page as it goes, until it made something.
    await runNow.click()
    const runs = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Runs' }) })
    // A run's row is named for its time, then how it went.
    const made = runs.getByRole('button', { name: /Made something: Changelog, / })
    await expect(made).toBeVisible()
    await runs.screenshot({ path: 'test-results/automations-6-ran.png', animations: 'disabled', scale: 'css' })

    // Its run opens its task: an ordinary task, named for the automation and its day.
    await made.click()
    await expect(page.getByText(/^Changelog, \d+ \w+$/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/automations-7-task.png', animations: 'disabled', scale: 'css' })

    // Back from its task, on the project's Automations view, on its page as
    // it was left; paused from there, nothing of it starts until it is turned on again.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: /^Automations/ })).toBeChecked()
    await expect(page.getByRole('heading', { name: 'Changelog', level: 2 })).toBeVisible()
    await page.getByRole('switch', { name: 'On' }).click()
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('switch', { name: 'On' })).not.toBeChecked()
  } finally {
    await electronApp.close()
  }
})
