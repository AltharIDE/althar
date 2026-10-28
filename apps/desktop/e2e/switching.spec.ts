import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch, openFirstProject, say, startTask } from './support'

/*
 * Going back to a project's tab, once it has been open, is instant: its
 * conversation is there in the frame after the click, never the outline of
 * one being read, scrolled where the person left it, with what they were
 * writing still in the composer. Timed from the click to the frame painted
 * with the project's conversation in it, for a project with a long
 * conversation and a board of tasks.
 */

/** What the outline of a conversation being read is called, as `ThreadPending` and the project's own say. */
const READING = 'Reading the conversation'

/** How long a busy runtime takes to answer, in ms: more than the router's glance before the outline shows. */
const BUSY = 250

/**
 * Clicks a project's tab and times it, in the window itself: from the click
 * to the first frame painted with that project's heading and conversation,
 * in ms and in frames (the one it is painted in, from 1), and whether the
 * outline of a conversation being read showed on the way.
 */
const timeSwitch = (page: Page, name: string, last: string) =>
  page.evaluate(
    ({ name, last, reading }) =>
      new Promise<{ ms: number; frames: number; outline: boolean }>((resolve) => {
        const tab = [...document.querySelectorAll('nav[aria-label="Projects"] button')].find(
          (button) => button.getAttribute('aria-label')?.startsWith(name) || button.textContent?.trim().startsWith(name),
        ) as HTMLElement | undefined
        if (tab === undefined) throw new Error(`No tab for ${name}`)
        let outline = false
        const seen = () => {
          if (document.querySelector(`[aria-label="${reading}"]`) !== null) outline = true
        }
        const watching = new MutationObserver(seen)
        watching.observe(document.body, { childList: true, subtree: true })
        const shown = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && element.offsetParent !== null
        const ready = () => {
          const heading = [...document.querySelectorAll('h1')].find((h) => shown(h) && h.textContent?.trim() === name)
          const thread = [...document.querySelectorAll('section[aria-label="Conversation"]')].find(shown)
          return heading !== undefined && thread !== undefined && thread.textContent?.includes(last) === true
        }
        const start = performance.now()
        tab.click()
        let frames = 0
        const check = () => {
          seen()
          if (!ready()) {
            frames += 1
            return void requestAnimationFrame(check)
          }
          // The frame with it is painted once the next one starts.
          requestAnimationFrame(() => {
            watching.disconnect()
            resolve({ ms: performance.now() - start, frames, outline })
          })
        }
        check()
      }),
    { name, last, reading: READING },
  )

/** The scroller of the conversation that shows. */
const scroller = (page: Page) =>
  page.locator('section[aria-label="Conversation"]:visible').locator('xpath=ancestor::div[contains(@class, "scroll")][1]')

test('going back to an open project is instant, without the outline, where the person left it', async () => {
  test.setTimeout(300_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const halyard = repository(home, 'halyard')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // A busy board, and a long conversation with the coordinator.
    for (const title of ['Add a retry to checkout', 'Name the limits better', 'Log the refunds']) await startTask(page, title)
    const said = 40
    for (let n = 1; n <= said; n += 1)
      await say(page, `Message ${n}: ${'what the person says about the checkout and its retries, at some length. '.repeat(6)}`)
    const meridianLast = `Message ${said}:`
    // Every message answered: nothing queued, and no turn running.
    await expect(page.getByText(/queued/i)).toHaveCount(0, { timeout: 180_000 })
    await expect(page.locator('section[aria-label="Conversation"][aria-busy]')).toHaveCount(0, { timeout: 60_000 })

    // Another project, in a tab of its own, with a conversation of its own.
    await page.keyboard.press('ControlOrMeta+n')
    await page.getByRole('textbox', { name: 'Name' }).fill('halyard')
    await chooseFolder(electronApp, halyard)
    await page.getByRole('button', { name: 'Choose a folder…' }).click()
    await page.getByRole('button', { name: /^Create halyard/ }).click()
    await expect(page.getByRole('heading', { name: 'halyard', level: 1 })).toBeVisible()
    await say(page, 'Halyard first words')
    await expect(page.locator('section[aria-label="Conversation"][aria-busy]')).toHaveCount(0, { timeout: 60_000 })

    // Back and forth between the two tabs, timed. Each time the person leaves meridian, its coordinator has more to
    // answer, which it does while they are on halyard, as a busy project's does.
    // A runtime as busy as one with agents at work answers slower than a glance: every call to it here waits a while first.
    await page.evaluate((late) => {
      // oxlint-disable-next-line typescript/unbound-method -- applied to the port it was called on
      const post = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
        setTimeout(() => post.apply(this, args), late)
      } as MessagePort['postMessage']
    }, BUSY)
    const timings: Array<{ to: string; ms: number; frames: number; outline: boolean }> = []
    for (let round = 0; round < 6; round += 1) {
      timings.push({ to: 'meridian', ...(await timeSwitch(page, 'meridian', meridianLast)) })
      await page.waitForTimeout(300)
      for (const more of ['a', 'b', 'c']) await say(page, `More ${round}${more}: ${'and another thing. '.repeat(10)}`)
      timings.push({ to: 'halyard', ...(await timeSwitch(page, 'halyard', 'Halyard first words')) })
      await page.waitForTimeout(800)
    }
    const ms = timings.map((timing) => Math.round(timing.ms))
    process.stdout.write(`switch timings: ${JSON.stringify(timings.map((timing) => ({ ...timing, ms: Math.round(timing.ms) })))}\n`)
    process.stdout.write(`median ${ms.toSorted((a, b) => a - b)[Math.floor(ms.length / 2)]} ms, max ${Math.max(...ms)} ms\n`)
    await test.info().attach('switch timings', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' })

    // Scrolled up in meridian's conversation, with something half written: both are there again on coming back.
    await timeSwitch(page, 'meridian', meridianLast)
    const meridianScroll = scroller(page)
    await meridianScroll.evaluate((element) => (element.scrollTop = 400))
    await page.waitForTimeout(100)
    const box = page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })
    await box.fill('Half a thought about')
    await timeSwitch(page, 'halyard', 'Halyard first words')
    const back = await timeSwitch(page, 'meridian', meridianLast)
    expect(back.outline).toBe(false)
    await expect(page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })).toHaveValue('Half a thought about')
    expect(await scroller(page).evaluate((element) => element.scrollTop)).toBe(400)

    // What a kept screen costs: the window's memory with meridian's kept, hidden, while halyard shows, and once its tab is closed.
    const devtools = await page.context().newCDPSession(page)
    const memory = async () => {
      await devtools.send('HeapProfiler.collectGarbage')
      const { usedSize } = await devtools.send('Runtime.getHeapUsage')
      const { nodes } = await devtools.send('Memory.getDOMCounters')
      return { heapMB: Math.round(usedSize / 1e5) / 10, nodes }
    }
    await timeSwitch(page, 'halyard', 'Halyard first words')
    await page.waitForTimeout(500)
    const withMeridian = await memory()
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: 'Close meridian' }).click()
    await page.waitForTimeout(500)
    const without = await memory()
    process.stdout.write(`memory with meridian kept: ${JSON.stringify(withMeridian)}; its tab closed: ${JSON.stringify(without)}\n`)
    await expect(page.locator('section[aria-label="Conversation"]')).toHaveCount(1)

    // No skeleton on any switch back, and each painted within a couple of frames of the click.
    expect(timings.filter((timing) => timing.outline)).toEqual([])
    for (const timing of timings) expect(timing.frames).toBeLessThanOrEqual(2)
  } finally {
    await electronApp.close()
  }
})
