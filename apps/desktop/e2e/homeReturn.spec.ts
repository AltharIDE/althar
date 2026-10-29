import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * Going back to the home, from a project's tab or from a task, is instant:
 * the home is there in the frame after the click, never the outline of one
 * being read; the first visit too, as the window reads the home ahead. Timed as going back to a
 * project's tab is (`switching.spec.ts`): from the click to the frame
 * painted with the home's projects in it, with a runtime as busy as one with
 * agents at work, for a home with work running and work waiting.
 */

/** What the outline of the home being read is called, as `HomePending` says. */
const READING = 'Reading what waits and what runs'

/** How long a busy runtime takes to answer, in ms: more than the router's glance before the outline shows. */
const BUSY = 250

/**
 * Clicks the home's tab and times it, in the window itself: from the click to
 * the first frame painted with the home's projects in it, in ms and in frames
 * (the one it is painted in, from 1), and whether the outline of the home
 * being read showed on the way.
 */
const timeHome = (page: Page) =>
  page.evaluate(
    ({ reading }) =>
      new Promise<{ ms: number; frames: number; outline: boolean }>((resolve) => {
        const tab = [...document.querySelectorAll('nav[aria-label="Projects"] button')].find((button) =>
          button.textContent?.trim().startsWith('Home'),
        ) as HTMLElement | undefined
        if (tab === undefined) throw new Error('No tab for the home')
        let outline = false
        const seen = () => {
          if (document.querySelector(`[aria-label="${reading}"]`) !== null) outline = true
        }
        const watching = new MutationObserver(seen)
        watching.observe(document.body, { childList: true, subtree: true })
        const shown = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && element.offsetParent !== null
        const ready = () =>
          [...document.querySelectorAll('aside[aria-labelledby]')].some(
            (aside) =>
              shown(aside) && document.getElementById(aside.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() === 'Projects',
          )
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
    { reading: READING },
  )

test('going back to the home is instant, without the outline', async () => {
  test.setTimeout(240_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  const project = page.getByRole('heading', { name: 'meridian', level: 1 })
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(project).toBeVisible()
    // Its address: its tab goes back to the task last open in it, and each round starts on the project itself.
    const at = await page.evaluate(() => location.hash.split('?')[0] ?? '')
    // Work running, and work waiting on the person, so the home has something of each.
    for (const title of ['Add a retry to checkout', 'Name the limits better', 'Log the refunds'])
      await startTask(page, title, '[lead:wait]')
    await startTask(page, 'Tidy the receipts', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible({ timeout: 60_000 })

    // The home, the first time: what it waits on is never read yet.
    const first = await timeHome(page)
    await expect(page.getByRole('heading', { name: 'Tidy the receipts', level: 4 })).toBeVisible()
    // A task, opened from the home: its address, to go back to it each round.
    await page.getByRole('button', { name: 'Review' }).click()
    await expect(page.getByRole('complementary', { name: 'Projects' })).toBeHidden()
    const task = await page.evaluate(() => location.hash)

    // A runtime as busy as one with agents at work answers slower than a glance: every call to it here waits a while first.
    await page.evaluate((late) => {
      // oxlint-disable-next-line typescript/unbound-method -- applied to the port it was called on
      const post = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
        setTimeout(() => post.apply(this, args), late)
      } as MessagePort['postMessage']
    }, BUSY)

    // To the home from the project's tab, and from a task, round after round, with the work going on meanwhile.
    const timings: Array<{ from: string; ms: number; frames: number; outline: boolean }> = []
    for (let round = 0; round < 5; round += 1) {
      await page.evaluate((hash) => (location.hash = hash), at)
      await expect(project).toBeVisible()
      await page.waitForTimeout(800)
      timings.push({ from: 'project', ...(await timeHome(page)) })
      await page.waitForTimeout(300)
      await page.evaluate((hash) => (location.hash = hash), task)
      await expect(page.getByRole('complementary', { name: 'Projects' })).toBeHidden()
      await page.waitForTimeout(800)
      timings.push({ from: 'task', ...(await timeHome(page)) })
      await page.waitForTimeout(300)
    }
    const ms = timings.map((timing) => Math.round(timing.ms))
    process.stdout.write(`first home: ${JSON.stringify({ ...first, ms: Math.round(first.ms) })}\n`)
    process.stdout.write(`home timings: ${JSON.stringify(timings.map((timing) => ({ ...timing, ms: Math.round(timing.ms) })))}\n`)
    process.stdout.write(`median ${ms.toSorted((a, b) => a - b)[Math.floor(ms.length / 2)]} ms, max ${Math.max(...ms)} ms\n`)
    await test.info().attach('home timings', { body: JSON.stringify({ first, timings }, null, 2), contentType: 'application/json' })

    // No outline on any return, the first included, and each painted within a couple of frames of the click.
    expect(first.outline).toBe(false)
    expect(timings.filter((timing) => timing.outline)).toEqual([])
    for (const timing of timings) expect(timing.frames).toBeLessThanOrEqual(2)
  } finally {
    await electronApp.close()
  }
})
