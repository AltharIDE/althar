import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, holdRuntime, launch, openFirstProject, say, startTask } from './support'

/*
 * Going back to a project's tab, once it has been open, is instant: the
 * window shows the screen it kept (`KeptScreens`), the very one the person
 * left, never the outline of one being read, scrolled where they left it,
 * with what they were writing still in the composer. Shown while the runtime
 * is held, as one too busy to answer would be, it can only be what the
 * window had: a screen that needed the runtime first would wait, and its
 * outline show. For a project with a long conversation and a board of tasks.
 */

/** What the outline of a conversation being read is called, as `ThreadPending` and the project's own say. */
const READING = 'Reading the conversation'

/** From now on, whether the outline of a conversation being read has shown, at any moment, until it is asked. */
const watchOutline = (page: Page) =>
  page.evaluate((reading) => {
    const seen = window as unknown as { outlined: boolean }
    seen.outlined = document.querySelector(`[aria-label="${reading}"]`) !== null
    new MutationObserver(() => {
      if (document.querySelector(`[aria-label="${reading}"]`) !== null) seen.outlined = true
    }).observe(document.body, { childList: true, subtree: true })
  }, READING)
const outlined = (page: Page) => page.evaluate(() => (window as unknown as { outlined: boolean }).outlined)

/** The project's conversation that shows. */
const conversation = (page: Page) => page.locator('section[aria-label="Conversation"]:visible')

/** The scroller of the conversation that shows. */
const scroller = (page: Page) => conversation(page).locator('xpath=ancestor::div[contains(@class, "scroll")][1]')

test('going back to an open project shows the screen it kept, where the person left it, without reading it again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // A busy board, and a long conversation with the coordinator.
    for (const title of ['Add a retry to checkout', 'Name the limits better', 'Log the refunds']) await startTask(page, title)
    const said = 16
    for (let n = 1; n <= said; n += 1)
      await say(page, `Message ${n}: ${'what the person says about the checkout and its retries, at some length. '.repeat(6)}`)
    // Every message answered: nothing queued, and no turn running.
    await expect(page.getByText(/queued/i)).toHaveCount(0)
    await expect(page.locator('section[aria-label="Conversation"][aria-busy]')).toHaveCount(0)
    await expect(conversation(page)).toContainText(`Message ${said}:`)

    // Another project, in a tab of its own, with a conversation of its own.
    await page.keyboard.press('ControlOrMeta+n')
    await page.getByRole('textbox', { name: 'Name' }).fill('halyard')
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await page.getByRole('button', { name: /^Create halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await say(page, 'Halyard first words')
    await expect(page.locator('section[aria-label="Conversation"][aria-busy]')).toHaveCount(0)

    // Back on meridian: said one more thing, then scrolled up, with something half written, as the person leaves it.
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await say(page, `More: ${'and another thing. '.repeat(10)}`)
    await scroller(page).evaluate(
      (element) =>
        new Promise((resolve) => {
          element.addEventListener('scroll', resolve, { once: true })
          element.scrollTop = 400
        }),
    )
    await box.fill('Half a thought about')
    const left = await conversation(page).elementHandle()
    await tabs.getByRole('button', { name: /^halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await expect(conversation(page)).toContainText('Halyard first words')

    // Back to meridian with the runtime held: what shows is what the window kept, the conversation the person left.
    await watchOutline(page)
    const release = await holdRuntime(page)
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect(conversation(page)).toContainText(`Message ${said}:`)
    expect(await left.evaluate((element) => element.isConnected && element.checkVisibility())).toBe(true)
    await expect(box).toHaveValue('Half a thought about')
    expect(await scroller(page).evaluate((element) => element.scrollTop)).toBe(400)
    // The runtime answers again, and the kept screen catches up from there: still the one the person left, and never the outline.
    await release()
    await expect(page.locator('section[aria-label="Conversation"][aria-busy]')).toHaveCount(0)
    expect(await left.evaluate((element) => element.isConnected && element.checkVisibility())).toBe(true)
    expect(await outlined(page)).toBe(false)

    // What a kept screen costs: the window's memory with meridian's kept, hidden, while halyard shows, and once its tab is
    // closed. Said, to read; how much is the performance run's to judge, not this test's.
    const devtools = await page.context().newCDPSession(page)
    const memory = async () => {
      await devtools.send('HeapProfiler.collectGarbage')
      const { usedSize } = await devtools.send('Runtime.getHeapUsage')
      const { nodes } = await devtools.send('Memory.getDOMCounters')
      return { heapMB: Math.round(usedSize / 1e5) / 10, nodes }
    }
    await tabs.getByRole('button', { name: /^halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    const withMeridian = await memory()
    await tabs.getByRole('button', { name: 'Close meridian' }).click()
    await expect(page.locator('section[aria-label="Conversation"]')).toHaveCount(1)
    const without = await memory()
    process.stdout.write(`memory with meridian kept: ${JSON.stringify(withMeridian)}; its tab closed: ${JSON.stringify(without)}\n`)
  } finally {
    await electronApp.close()
  }
})
