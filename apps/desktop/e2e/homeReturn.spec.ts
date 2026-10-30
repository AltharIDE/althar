import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { holdRuntime, launch, openFirstProject, startTask } from './support'

/*
 * Going back to the home, from a project's tab or from a task, is instant:
 * the window shows the home it kept (`KeptScreens`), never the outline of
 * one being read; the first visit too, as the window reads the home ahead.
 * Each is shown with the runtime held, as one too busy to answer would be,
 * as going back to a project's tab is (`switching.spec.ts`): what shows can
 * only be what the window had. For a home with work running and work
 * waiting.
 */

/** What the outline of the home being read is called, as `HomePending` says. */
const READING = 'Reading what waits and what runs'

/** From now on, whether the outline of the home being read has shown, at any moment, until it is asked. */
const watchOutline = (page: Page) =>
  page.evaluate((reading) => {
    const seen = window as unknown as { outlined: boolean }
    seen.outlined = document.querySelector(`[aria-label="${reading}"]`) !== null
    new MutationObserver(() => {
      if (document.querySelector(`[aria-label="${reading}"]`) !== null) seen.outlined = true
    }).observe(document.body, { childList: true, subtree: true })
  }, READING)
const outlined = (page: Page) => page.evaluate(() => (window as unknown as { outlined: boolean }).outlined)

test('going back to the home shows the home it kept, without the outline', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  const project = page.getByRole('heading', { name: 'meridian', level: 1 })
  // The home's side list of projects, which shows once the home does.
  const projects = page.getByRole('complementary', { name: 'Projects' })
  const toHome = () => page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(project).toBeVisible()
    // Its address: its tab goes back to the task last open in it, and each return starts on the project itself.
    const at = await page.evaluate(() => location.hash.split('?')[0] ?? '')
    // Work running, and work waiting on the person, so the home has something of each.
    for (const title of ['Add a retry to checkout', 'Name the limits better', 'Log the refunds'])
      await startTask(page, title, '[lead:wait]')
    await startTask(page, 'Tidy the receipts', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible()
    await watchOutline(page)

    // The home, the first time, with the runtime held: what it waits on was read ahead.
    let release = await holdRuntime(page)
    await toHome()
    await expect(projects).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tidy the receipts', level: 4 })).toBeVisible()
    await release()
    const kept = await projects.elementHandle()

    // A task, opened from the home: its address, to go back to it.
    await page.getByRole('button', { name: 'Review' }).click()
    await expect(projects).toBeHidden()
    const task = await page.evaluate(() => location.hash)

    // To the home from the task, then from the project's tab, each with the runtime held: the home it kept, each time.
    for (const from of [task, at]) {
      await page.evaluate((hash) => (location.hash = hash), from)
      await expect(projects).toBeHidden()
      release = await holdRuntime(page)
      await toHome()
      await expect(projects).toBeVisible()
      expect(await kept.evaluate((element) => element.isConnected && element.checkVisibility())).toBe(true)
      await release()
    }
    // Answered again, the home is still the one kept, and its outline never showed.
    await expect(page.getByRole('heading', { name: 'Tidy the receipts', level: 4 })).toBeVisible()
    expect(await kept.evaluate((element) => element.isConnected && element.checkVisibility())).toBe(true)
    expect(await outlined(page)).toBe(false)
  } finally {
    await electronApp.close()
  }
})
