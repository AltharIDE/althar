import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, type Page } from '@playwright/test'

import { launch, openFirstProject, shown, sizeWindow, startTask, still } from '../e2e/support'
import { repository } from '../tests/repository'

/*
 * A manual measurement of a long thread, after ADEMark's A11 (TESTS.md, "Long
 * Thread"): a task's thread of 2,000 messages, 1,000 exchanges, one reply in
 * five with a code block, the last saying LONGTHREAD-END. Written to the
 * store while the app is closed, rather than made through the app, so it is
 * quick to make again. Then, five times each:
 *
 * - Open: from a short thread, switching to the long one, the time until
 *   LONGTHREAD-END shows and two frames have drawn after it, in ms.
 * - Scroll: 20 wheel events at 60 Hz towards the top, the frame gaps over
 *   33 ms while they last, and the worst frame.
 * - Switch: back to the short thread and to the long one again, each the time
 *   until what it ends on shows and two frames have drawn.
 *
 * Each first with the thread's latest page alone, as it opens, then once the
 * whole thread has been read, scrolled back to its first message, as the
 * person's long threads are once they have read back through them. Not a
 * test: no time here is a budget. `bun run measure:long-thread` builds the
 * app and runs it, writing test-results/long-thread.json.
 */

/** Exchanges: two messages each. */
const EXCHANGES = Number(process.env.EXCHANGES ?? 1000)
const REPEATS = 5
const END = 'LONGTHREAD-END'
const SHORT_END = 'SHORT-THREAD-END'

const say = (what: string) => process.stderr.write(`${what}\n`)

const hex = () => randomUUID().replaceAll('-', '')

const reply = (i: number) =>
  [
    `Step ${i} of the long thread: read the small file and carry on with the next part of the work.`,
    ...(i % 5 === 0 ? ['```ts', `export const step${i} = (n: number) => n * ${i}`, '```'] : []),
    ...(i === EXCHANGES ? [END] : []),
  ].join('\n')

const seed = (home: string) => {
  const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'))
  try {
    const said = store.prepare('SELECT author_actor_id AS author, disposition, state FROM user_inputs LIMIT 1').get()!
    const threadOf = (title: string) =>
      store
        .prepare(
          `SELECT threads.id AS id, threads.project_id AS project FROM threads JOIN tasks ON tasks.id = threads.task_id WHERE threads.kind = 'task' AND tasks.title = ?`,
        )
        .get(title)!
    const input = store.prepare(
      'INSERT INTO user_inputs (id, project_id, thread_id, sequence, command_id, disposition, body, author_actor_id, state, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const item = store.prepare(
      'INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const at = new Date().toISOString()
    const fill = (title: string, exchanges: number, last: (i: number) => string) => {
      const { id, project } = threadOf(title)
      const [thread, projectId] = [String(id), String(project)]
      let next = Number(store.prepare('SELECT coalesce(max(sequence), 0) AS n FROM thread_items WHERE thread_id = ?').get(thread)?.n)
      let asked = Number(store.prepare('SELECT coalesce(max(sequence), 0) AS n FROM user_inputs WHERE thread_id = ?').get(thread)?.n)
      store.exec('BEGIN')
      for (let i = 1; i <= exchanges; i++) {
        const inputId = `input_${hex()}`
        const body = `Question ${i}: carry on with the next step.`
        input.run(
          inputId,
          projectId,
          thread,
          ++asked,
          `cmd_${hex()}`,
          String(said.disposition),
          body,
          String(said.author),
          String(said.state),
          at,
        )
        item.run(`item_${hex()}`, projectId, thread, ++next, 'user_message', inputId, JSON.stringify({ text: body }), at)
        item.run(`item_${hex()}`, projectId, thread, ++next, 'agent_message', null, JSON.stringify({ text: last(i) }), at)
      }
      store.exec('COMMIT')
      return thread
    }
    return {
      long: fill('Long thread', EXCHANGES, reply),
      short: fill('Short thread', 3, (i) => (i === 3 ? `A short reply.\n${SHORT_END}` : 'A short reply.')),
    }
  } finally {
    store.close()
  }
}

/**
 * Goes to a thread by its route, the time from then until `marker` shows in the window and two frames have drawn after
 * it, in ms.
 */
const go = (page: Page, threadId: string, marker: string) =>
  page.evaluate(
    async ({ threadId, marker }) => {
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
      const showing = () => {
        const found = document.evaluate(`//*[contains(text(), '${marker}')]`, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE)
        for (let i = 0; i < found.snapshotLength; i++) {
          const rect = (found.snapshotItem(i) as HTMLElement).getBoundingClientRect()
          if (rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight) return true
        }
        return false
      }
      const start = performance.now()
      location.hash = `#/threads/${threadId}`
      while (!showing()) await frame()
      await frame()
      await frame()
      return Math.round(performance.now() - start)
    },
    { threadId, marker },
  )

/** The scroller of the thread on show. */
const scrollerBox = (page: Page) =>
  page.evaluate(() => {
    const thread = [...document.querySelectorAll<HTMLElement>('section[data-arrivals]')].find((one) => one.getClientRects().length > 0)!
    let box = thread.parentElement!
    while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
    const rect = box.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })

/** What is drawn of the thread on show: its elements, the messages among them, and the heap. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const thread = [...document.querySelectorAll<HTMLElement>('section[data-arrivals]')].find((one) => one.getClientRects().length > 0)!
    return {
      elements: thread.querySelectorAll('*').length,
      documentElements: document.querySelectorAll('*').length,
      heapMb: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6),
    }
  })

/** 20 wheel events at 60 Hz towards the top: the frame gaps over 33 ms while they last, and the worst frame. */
const wheel = async (page: Page) => {
  const { x, y } = await scrollerBox(page)
  await page.mouse.move(x, y)
  await page.evaluate(() => {
    const record = window as unknown as { gaps: number[]; recording: boolean }
    record.gaps = []
    record.recording = true
    let last = performance.now()
    const step = (now: number) => {
      record.gaps.push(now - last)
      last = now
      if (record.recording) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -120)
    await new Promise((resolve) => setTimeout(resolve, 1000 / 60))
  }
  await new Promise((resolve) => setTimeout(resolve, 1000 / 60))
  const gaps = await page.evaluate(() => {
    const record = window as unknown as { gaps: number[]; recording: boolean }
    record.recording = false
    return record.gaps.slice(1)
  })
  return { over33: gaps.filter((gap) => gap > 33).length, worst: Math.round(Math.max(...gaps)), frames: gaps.length }
}

/** Scrolls the thread on show to its bottom. */
const toBottom = (page: Page) =>
  page.evaluate(async () => {
    const thread = [...document.querySelectorAll<HTMLElement>('section[data-arrivals]')].find((one) => one.getClientRects().length > 0)!
    let box = thread.parentElement!
    while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
    for (let i = 0; i < 10; i++) {
      box.scrollTop = box.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  })

/** Scrolls back to the thread's first message, reading every earlier page: how long it took, in ms. */
const backToTheStart = (page: Page) =>
  page.evaluate(async () => {
    const thread = [...document.querySelectorAll<HTMLElement>('section[data-arrivals]')].find((one) => one.getClientRects().length > 0)!
    let box = thread.parentElement!
    while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
    const start = performance.now()
    const first = () =>
      document.evaluate(`.//*[text() = 'Question 1: carry on with the next step.']`, thread, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
        .singleNodeValue
    while (first() === null) {
      box.scrollTop = 0
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (performance.now() - start > 120_000) throw new Error('The thread never reached its first message')
    }
    return Math.round(performance.now() - start)
  })

const median = (values: ReadonlyArray<number>) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

const home = mkdtempSync(join(tmpdir(), 'althar-long-thread-'))
let app = await launch(home)
await openFirstProject(app.electronApp, app.page, repository(home))
say('setting up')
await startTask(app.page, 'Long thread')
await expect(shown(app.page, 'Ready', { exact: true }).first()).toBeVisible()
await startTask(app.page, 'Short thread')
await expect(shown(app.page, 'Ready', { exact: true }).nth(1)).toBeVisible()
await app.electronApp.close()
const threads = seed(home)
say('seeded')

app = await launch(home)
const { page } = app
page.on('pageerror', (error) => say(`page error: ${error.message.slice(0, 400)}`))
const results: Record<string, unknown> = { exchanges: EXCHANGES, messages: EXCHANGES * 2 }
try {
  // The window's size, where the computer lets it be set: the same for the runs compared, as recorded with them.
  await sizeWindow(app.electronApp, page, 1440, 900).catch(() => say('the window kept its own size'))
  results.window = await page.evaluate(() => [innerWidth, innerHeight])
  await page.getByRole('navigation', { name: 'Projects' }).getByText('meridian').click()
  await still(page)
  const round = async (name: string) => {
    const open: number[] = []
    const scroll: Array<{ over33: number; worst: number; frames: number }> = []
    const switches: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      say(`${name} ${i}: short`)
      await go(page, threads.short, SHORT_END)
      await still(page)
      say(`${name} ${i}: open`)
      open.push(await go(page, threads.long, END))
      await still(page)
      say(`${name} ${i}: wheel`)
      scroll.push(await wheel(page))
      say(`${name} ${i}: switch`)
      await toBottom(page)
      await still(page)
      switches.push(await go(page, threads.short, SHORT_END))
      await still(page)
      switches.push(await go(page, threads.long, END))
      await still(page)
    }
    results[name] = {
      openMs: open,
      openMedianMs: median(open),
      scroll,
      scrollGapsOver33Median: median(scroll.map((one) => one.over33)),
      scrollWorstMedianMs: median(scroll.map((one) => one.worst)),
      switchMs: switches,
      switchMedianMs: median(switches),
      drawn: await drawn(page),
    }
    process.stdout.write(`${name}: ${JSON.stringify(results[name])}\n`)
  }
  // The thread as it opens: its latest page, the first time, then from the screen the window keeps for it.
  await go(page, threads.short, SHORT_END)
  await still(page)
  results.coldOpenMs = await go(page, threads.long, END)
  await still(page)
  results.firstOpenMs = await go(page, threads.short, SHORT_END).then(() => go(page, threads.long, END))
  await still(page)
  await round('latestPage')
  // Every page read, back to its first message.
  say('back to the start')
  results.backToTheStartMs = await backToTheStart(page)
  await still(page)
  await toBottom(page)
  await still(page)
  await round('wholeThread')
} finally {
  await app.electronApp.close()
}
mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
writeFileSync(join(process.cwd(), 'test-results', process.env.OUT ?? 'long-thread.json'), JSON.stringify(results, null, 2))
process.stdout.write(`${JSON.stringify(results)}\n`)
