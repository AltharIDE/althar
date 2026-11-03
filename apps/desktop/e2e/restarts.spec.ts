import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, shown, startTask, still } from './support'

/*
 * A step Althar stopped while it ran, through the app's own quit and its own
 * start of a runtime that died (main.ts): quitting and opening Althar again
 * carries the step on by itself, however soon; the runtime killed twice while
 * the step runs pauses it, with a card that says so and offers only what
 * fits. The lead is the scripted fake, which works until it is stopped
 * (`[lead:wait]`). The running app keeps its store locked, so the store is
 * read only once it has quit. The screenshots are this change's own evidence
 * (test-results/restarts-*.png).
 */

const CARRIED = 'Carried on after Althar restarted.'
const CRASHED = 'Althar stopped unexpectedly twice while this step ran.'

/** Runs `read` on the store in `home`, once the app has quit. */
const inStore = <A>(home: string, read: (store: DatabaseSync) => A): A => {
  const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'))
  try {
    return read(store)
  } finally {
    store.close()
  }
}

/** What the store in `home` says of the restarts: the launches with no end recorded, the lines carrying the step on, and the calls on the person. */
const restarts = (home: string) =>
  inStore(home, (store) => ({
    unended: store.prepare('SELECT count(*) AS n FROM runtime_instances WHERE ended_at IS NULL').get()?.n,
    carried: store
      .prepare(`SELECT count(*) AS n FROM thread_items WHERE kind = 'notice' AND json_extract(content, '$.title') = ?`)
      .get(CARRIED)?.n,
    calls: store.prepare(`SELECT kind, state, json_extract(payload, '$.why') AS why FROM attention_requests WHERE kind = 'stuck'`).all(),
  }))

/** Quits as the person does, and waits for the app to go. */
const quit = async (electronApp: ElectronApplication) => {
  const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
  await electronApp.evaluate(({ app }) => app.quit())
  await exited
}

/** The runtime's process, as Electron lists it. */
const runtimePid = (electronApp: ElectronApplication) =>
  electronApp.evaluate(
    ({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === 'Althar runtime')?.pid,
  )

/** Kills the runtime, as a crash would, and waits for the app to start another. */
const crash = async (electronApp: ElectronApplication) => {
  const pid = await runtimePid(electronApp)
  expect(pid).toBeDefined()
  process.kill(pid ?? 0, 'SIGKILL')
  await expect.poll(async () => [undefined, pid].includes(await runtimePid(electronApp))).toBe(false)
}

/** Opens the task in a window whose app was opened again. */
const openTask = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Projects' }).getByText('meridian').click()
  // The project's tab shows where the person was: the task, or its work with a way into it.
  const open = shown(page, /Open task/).first()
  const carried = shown(page, CARRIED).first()
  await expect(open.or(carried)).toBeVisible()
  if (await open.isVisible()) await open.click()
}

/** Starts a task whose lead works until stopped, and opens it. */
const working = async (electronApp: ElectronApplication, page: Page, home: string) => {
  await openFirstProject(electronApp, page, repository(home))
  await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
  await startTask(page, 'Keep the session alive', '[lead:wait]')
  await page.getByRole('button', { name: /Open task/ }).click()
  await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible()
}

test('Quitting and opening Althar again twice in a row carries the step on each time, asking nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const first = await launch(home)
  try {
    await working(first.electronApp, first.page, home)
  } finally {
    await quit(first.electronApp)
  }
  for (const times of [1, 2]) {
    const { electronApp, page } = await launch(home)
    try {
      await expect(page.getByText('Nothing needs you')).toBeVisible()
      await openTask(page)
      await expect(shown(page, CARRIED)).toHaveCount(times)
      await expect(shown(page, CRASHED)).toHaveCount(0)
    } finally {
      await quit(electronApp)
    }
    expect(restarts(home)).toEqual({ unended: 0, carried: times, calls: [] })
  }
})

test('A runtime killed twice while the step runs pauses it, offering only what fits; one an earlier version paused carries on at the next launch', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const first = await launch(home)
  try {
    const { electronApp, page } = first
    await working(electronApp, page, home)
    // Killed once: the app starts the runtime again, and it carries the step on.
    await crash(electronApp)
    await expect(shown(page, CARRIED)).toBeVisible()
    // Killed again soon after: it waits on the person.
    await crash(electronApp)
    const card = shown(page, CRASHED).locator('xpath=ancestor::*[.//button[normalize-space()="Abandon this step"]][1]')
    await expect(card).toBeVisible()
    await expect(card.getByRole('button')).toHaveText([
      /^Start .+ again$/,
      'Continue with another model',
      'Abandon this step',
      'Report this',
    ])
    await still(page)
    await card.screenshot({ path: 'test-results/restarts-crashed.png', scale: 'css' })
  } finally {
    await quit(first.electronApp)
  }
  expect(restarts(home)).toMatchObject({ carried: 1, calls: [{ kind: 'stuck', state: 'open', why: 'restarted' }] })

  // An earlier version paused it the same way, though it couldn't tell crashes from quits: the next launch carries it on.
  inStore(home, (store) => store.exec("UPDATE thread_items SET content = json_remove(content, '$.crashed') WHERE kind = 'notice'"))
  const { electronApp, page } = await launch(home)
  try {
    await expect(page.getByText('Nothing needs you')).toBeVisible()
    await openTask(page)
    await expect(shown(page, CARRIED)).toHaveCount(2)
    await expect(shown(page, CRASHED)).toHaveCount(0)
  } finally {
    await quit(electronApp)
  }
  expect(restarts(home)).toEqual({ unended: 0, carried: 2, calls: [{ kind: 'stuck', state: 'withdrawn', why: 'restarted' }] })
})
