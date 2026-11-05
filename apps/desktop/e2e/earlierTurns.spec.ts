import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, shown, startTask, still, toConversation } from './support'

/*
 * Scrolling back through a long thread, with the runtime's own paging: 200
 * exchanges (400 turns) more in both the coordinator's thread and a task's, written to
 * the store while the app is closed. Scrolling towards the top brings each
 * earlier page in by itself, the turn on show stays where it was, and the
 * thread ends at its beginning with no divider above it. A sweep up through
 * the whole rendered thread measures its frames, for the change's report.
 * The screenshots are this change's evidence (test-results/history-*.png).
 */

/** Exchanges between the person and an agent: two items each, so four pages of them. */
const TURNS = 200

/** The items a thread reads at once, as the renderer asks for them (`PAGE` in @althar/contracts). */
const PAGE = 100

const hex = () => randomUUID().replaceAll('-', '')

/** Replies of a few lengths, so pages differ in height as real ones do. */
const reply = (i: number) =>
  [`History turn ${i}`, ...Array.from({ length: i % 4 }, (_, line) => `A kept line ${line + 1} of a long conversation.`)].join('\n\n')

const seed = (home: string) => {
  const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'))
  try {
    // The person's own message to the coordinator, whose author and state the seeded ones take.
    const said = store.prepare('SELECT author_actor_id AS author, disposition, state FROM user_inputs LIMIT 1').get()!
    const threads = store.prepare(`SELECT id, project_id, kind FROM threads WHERE kind IN ('coordinator', 'task')`).all()
    const input = store.prepare(
      'INSERT INTO user_inputs (id, project_id, thread_id, sequence, command_id, disposition, body, author_actor_id, state, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const item = store.prepare(
      'INSERT INTO thread_items (id, project_id, thread_id, sequence, kind, user_input_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const at = new Date().toISOString()
    const items: Record<string, number> = {}
    for (const { id, project_id, kind } of threads) {
      const [thread, project] = [String(id), String(project_id)]
      let next = Number(store.prepare('SELECT coalesce(max(sequence), 0) AS n FROM thread_items WHERE thread_id = ?').get(thread)?.n)
      let asked = Number(store.prepare('SELECT coalesce(max(sequence), 0) AS n FROM user_inputs WHERE thread_id = ?').get(thread)?.n)
      for (let i = 1; i <= TURNS; i++) {
        const inputId = `input_${hex()}`
        const body = `Question ${i}`
        input.run(
          inputId,
          project,
          thread,
          ++asked,
          `cmd_${hex()}`,
          String(said.disposition),
          body,
          String(said.author),
          String(said.state),
          at,
        )
        item.run(`item_${hex()}`, project, thread, ++next, 'user_message', inputId, JSON.stringify({ text: body }), at)
        item.run(`item_${hex()}`, project, thread, ++next, 'agent_message', null, JSON.stringify({ text: reply(i) }), at)
      }
      items[String(kind)] = Number(store.prepare('SELECT count(*) AS n FROM thread_items WHERE thread_id = ?').get(thread)?.n)
    }
    // How many items each thread has, so how many pages it reads back to its beginning.
    return items
  } finally {
    store.close()
  }
}

/** Puts the thread's scroller `top` pixels down, and says where its first visible turn was then, before the scroll is handled. */
const scrollTo = (thread: Locator, top: number) =>
  thread.evaluate((element, to) => {
    let box = element.parentElement!
    while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
    box.scrollTop = to
    const edge = box.getBoundingClientRect().top
    const item = [...element.querySelectorAll<HTMLElement>('[data-item]')].find((one) => one.getBoundingClientRect().bottom > edge)!
    return { id: item.dataset.item!, top: item.getBoundingClientRect().top }
  }, top)

/**
 * Scrolls back page by page to the start of a thread of `total` items, which opened on its latest page, saying how far
 * the turn on show moved as each earlier page came in, in px.
 */
const backToTheStart = async (page: Page, thread: Locator, total: number) => {
  const moved: number[] = []
  const items = thread.locator('[data-item]')
  for (let earlier = Math.ceil(total / PAGE) - 1; earlier > 0; earlier--) {
    const had = await items.count()
    const before = await scrollTo(thread, 200)
    await expect.poll(() => items.count()).toBeGreaterThan(had)
    await expect(thread.getByText('Loading…')).toHaveCount(0)
    await still(page)
    const after = await thread.locator(`[data-item="${before.id}"]`).evaluate((one) => one.getBoundingClientRect().top)
    moved.push(Math.abs(after - before.top))
  }
  return moved
}

/** Scrolls from the bottom to the top 40 px a frame and reports the frames' times, in ms. */
const sweep = (thread: Locator) =>
  thread.evaluate(
    (element) =>
      new Promise<{ frames: number; items: number; p95: number; worst: number }>((resolve) => {
        let box = element.parentElement!
        while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement!
        box.scrollTop = box.scrollHeight
        const times: number[] = []
        let last = performance.now()
        const step = (now: number) => {
          times.push(now - last)
          last = now
          if (box.scrollTop <= 0) {
            const sorted = times.slice(1).sort((a, b) => a - b)
            resolve({
              frames: sorted.length,
              items: element.querySelectorAll('[data-item]').length,
              p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]!),
              worst: Math.round(sorted.at(-1)!),
            })
            return
          }
          box.scrollTop -= 40
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
  )

test('task and coordinator threads scroll back through 400 turns without the turn on show moving', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-history-'))
  let app = await launch(home)
  await openFirstProject(app.electronApp, app.page, repository(home))
  await startTask(app.page, 'History scrolling')
  await expect(shown(app.page, 'Ready', { exact: true }).first()).toBeVisible()
  await app.electronApp.close()
  const items = seed(home)
  expect(Object.keys(items).sort()).toEqual(['coordinator', 'task'])
  app = await launch(home)
  const { page } = app
  try {
    await page.getByRole('navigation', { name: 'Projects' }).getByText('meridian').click()
    const coordinator = page.locator('section[data-arrivals]').filter({ visible: true }).first()
    await expect(coordinator.getByText(`History turn ${TURNS}`, { exact: true })).toBeVisible()
    await still(page)
    const coordinatorOpened = await coordinator.locator('[data-item]').count()
    const coordinatorMoved = await backToTheStart(page, coordinator, items.coordinator!)
    await expect(coordinator.getByText('History scrolling [coordinator:plan-no-review] [lead:finish]')).toBeAttached()
    await scrollTo(coordinator, 0)
    await still(page)
    await page.screenshot({ path: 'test-results/history-coordinator-start.png', scale: 'css' })
    const coordinatorFrames = await sweep(coordinator)

    await shown(page, /Open task/)
      .first()
      .click()
    await toConversation(page)
    const task = page.locator('section[data-arrivals]').filter({ visible: true }).first()
    await expect(task.getByText(`History turn ${TURNS}`, { exact: true })).toBeVisible()
    await still(page)
    const taskOpened = await task.locator('[data-item]').count()
    const taskMoved = await backToTheStart(page, task, items.task!)
    await scrollTo(task, 0)
    await still(page)
    await page.screenshot({ path: 'test-results/history-task-start.png', scale: 'css' })
    const taskFrames = await sweep(task)

    // What the scroll-back measured, beside the run's results, for the report.
    await test.info().attach('history', {
      body: JSON.stringify({ coordinatorOpened, taskOpened, coordinatorMoved, taskMoved, coordinatorFrames, taskFrames }),
      contentType: 'application/json',
    })
    // Opening a thread reads only its latest page (100 items, here 50 exchanges), however long it is.
    expect(coordinatorOpened).toBeLessThanOrEqual(51)
    expect(taskOpened).toBeLessThanOrEqual(51)
    // Each thread came back through several pages, to its first turn, and nothing is left loading.
    expect(coordinatorMoved.length).toBeGreaterThanOrEqual(2)
    expect(taskMoved.length).toBeGreaterThanOrEqual(2)
    await expect(task.getByText('Question 1', { exact: true })).toBeAttached()
    await expect(page.getByText('Loading…')).toHaveCount(0)
    for (const moved of [...coordinatorMoved, ...taskMoved]) expect(moved).toBeLessThan(2)
  } finally {
    await app.electronApp.close()
  }
})
