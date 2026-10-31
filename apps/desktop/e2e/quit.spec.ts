import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { type ElectronApplication, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, mainWindow, openFirstProject, still, startTask } from './support'

/** Quit asks, as it does for a person: the other specs' apps quit without asking (support.ts). */
const ASKS = { ALTHAR_QUIT_WITHOUT_ASKING: '0' }

/*
 * Quit with a lead at work (DEV-118): it says what it will stop and asks
 * first. Cancel keeps it working; Quit anyway stops it and records the turn
 * as interrupted, and the next launch carries the task on. A second Quit while the question is
 * open is the person's yes. The lead is the scripted fake, which works until
 * it is stopped (`[lead:wait]`). The screenshots are this change's own
 * evidence (test-results/quit-*.png).
 */

/** Quits with work running, as a second Quit does: it says yes to the question the first asks. */
const quitAnyway = async (electronApp: ElectronApplication) => {
  const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
  await electronApp.evaluate(({ app }) => app.quit())
  await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await exited
}

test('Quit with a lead at work asks first; Cancel keeps it working, Quit anyway stops it and records it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const first = await launch(home, ASKS)
  try {
    const { electronApp, page } = first
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    // Quit asks, and names what it would stop.
    await electronApp.evaluate(({ app }) => app.quit())
    const dialog = page.getByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toContainText('Quitting stops 1 lead at work.')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await still(page)
    await dialog.screenshot({ path: 'test-results/quit-asks.png', scale: 'css' })

    // Cancel keeps it working: the window is as it was, and the lead still runs.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    // Asked again, Quit anyway stops the work and the app goes.
    await electronApp.evaluate(({ app }) => app.quit())
    await expect(dialog).toBeVisible()
    const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
    await dialog.getByRole('button', { name: 'Quit anyway' }).click()
    await exited
  } finally {
    await first.electronApp.close().catch(() => undefined)
  }

  // The lead's turn was stopped and recorded as interrupted, none left open.
  const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
  try {
    const turns = store.prepare('SELECT state, count(*) AS n FROM turn_deliveries GROUP BY state').all()
    expect(turns).toContainEqual({ state: 'interrupted', n: 1 })
    expect(turns.map((turn) => turn.state)).not.toContain('delivered')
  } finally {
    store.close()
  }

  // Opened again, nothing waits on the person: Althar carries the task on from where it was stopped.
  const { electronApp, page } = await launch(home, ASKS)
  try {
    await expect(page.getByText('Nothing needs you')).toBeVisible()
    await expect(page.getByText('1 task moving in 1 project.')).toBeVisible()
  } finally {
    await quitAnyway(electronApp)
  }
})

test('Quit twice in a row quits without asking again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, ASKS)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    await electronApp.evaluate(({ app }) => app.quit())
    await expect(page.getByRole('dialog', { name: 'Quit Althar?' })).toBeVisible()
    const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined)
    await exited
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})

test('Quit asks even when the runtime has not said what is at work, and says it may stop some', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  // The runtime is given no time to answer, as when it is too busy to.
  const { electronApp, page } = await launch(home, { ...ASKS, ALTHAR_QUIT_ASK_WAIT: '1' })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    await electronApp.evaluate(({ app }) => app.quit())
    const dialog = page.getByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toContainText('Quitting may stop work that is under way.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
  } finally {
    await quitAnyway(electronApp)
  }
})

test('Keep working in the background closes the windows and leaves the lead working', async () => {
  test.skip(
    process.platform !== 'darwin',
    'closing the last window quits elsewhere unless it is chosen; run on the Mac, where the menu bar or the island is always there',
  )
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, ASKS)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    await electronApp.evaluate(({ app }) => app.quit())
    const dialog = page.getByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog.getByRole('button', { name: 'Keep working in the background' })).toBeVisible()
    await still(page)
    await dialog.screenshot({ path: 'test-results/quit-background.png', scale: 'css' })
    await dialog.getByRole('button', { name: 'Keep working in the background' }).click()

    // Every window of Althar's own closes, and the app stays.
    await expect.poll(() => page.isClosed()).toBe(true)
    expect(electronApp.process().exitCode).toBeNull()

    // Opened again, as from the dock, the lead is still at work: nothing was stopped.
    await electronApp.evaluate(({ app }) => app.emit('activate'))
    const again = await mainWindow(electronApp)
    await expect(again.getByText('1 task moving in 1 project.')).toBeVisible()
    await expect(again.getByRole('dialog')).toHaveCount(0)
  } finally {
    await quitAnyway(electronApp)
  }
})

test('Closing the last window with work running asks once, and quits only when the person says so', async () => {
  test.skip(process.platform === 'darwin', 'closing the last window quits only off a Mac')
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, ASKS)
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()

    await page.close()
    const asked = await mainWindow(electronApp)
    const dialog = asked.getByRole('dialog', { name: 'Quit Althar?' })
    await expect(dialog).toContainText('Quitting stops 1 lead at work.')
    // Not answered by the window closing twice over: it stays until the person answers.
    await asked.waitForTimeout(1500)
    await expect(dialog).toBeVisible()
    expect(electronApp.process().exitCode).toBeNull()
  } finally {
    await quitAnyway(electronApp)
  }
})
