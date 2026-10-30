import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { launch, mainWindow } from './support'

/*
 * A profile another runtime has open (DEV-115): the CLI, or another Althar.
 * The window says so and that Althar can open again once that one closes; the
 * runtime isn't restarted, no crash report is sent and no error dialog
 * shows; Try again opens the profile once it is free. A second launch of the
 * app brings the first forward and ends, while an Althar on a profile of its
 * own runs beside it.
 */

const electronPath = createRequire(import.meta.url)('electron') as string
const app = join(import.meta.dirname, '..')

/**
 * How many times the main process has started the runtime, seen it exit, and heard from it that the profile is held,
 * from the app's log (which keeps every launch's).
 */
const runtimeLines = (home: string) => {
  const log = readFileSync(join(home, 'profile', 'logs', 'main.log'), 'utf8')
  const count = (line: string) => log.split(line).length - 1
  return {
    started: count('Runtime started'),
    exited: count('Runtime exited'),
    held: count('Profile is open in another Althar'),
  }
}

test('a profile another runtime has open is said, not crashed over, and Try again opens it once it is free', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-held-'))

  // A profile made by an earlier run, then held as the CLI holds it: exclusive, from its first statement until it closes.
  const before = await launch(home)
  await expect(before.page.getByText('Claude Code').first()).toBeVisible()
  await before.electronApp.close()
  const earlier = runtimeLines(home)
  const other = new DatabaseSync(join(home, 'profile', 'althar.sqlite'))
  other.exec('PRAGMA locking_mode = EXCLUSIVE')
  other.exec('BEGIN IMMEDIATE')
  other.exec('COMMIT')

  const { electronApp, page } = await launch(home)
  let held = true
  try {
    await expect(page.getByRole('heading', { name: 'Althar is open somewhere else', level: 1 })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Another copy of Althar is using this profile.')
    await expect(page.getByRole('alert')).toContainText('Once it closes, Althar can open again.')
    await page.screenshot({ path: 'test-results/profile-in-use.png' })

    // Main makes none of the restarts it would have: the runtime started once, found the profile held, and hasn't exited.
    await expect.poll(() => runtimeLines(home).held).toBe(earlier.held + 1)
    expect(runtimeLines(home)).toEqual({ started: earlier.started + 1, exited: earlier.exited, held: earlier.held + 1 })
    await expect(page.getByRole('heading', { name: 'Althar is open somewhere else', level: 1 })).toBeVisible()

    // Still held: trying again says the same.
    await page.getByRole('button', { name: 'Try again' }).click()
    // The old runtime's exit and the new one's start are logged as each happens, in either order.
    await expect.poll(() => runtimeLines(home).exited).toBe(earlier.exited + 1)
    await expect.poll(() => runtimeLines(home).started).toBe(earlier.started + 2)
    // The new runtime has found it held, so letting go of it now can't let that one open it before Try again.
    await expect.poll(() => runtimeLines(home).held).toBe(earlier.held + 2)
    // Nothing else started or stopped meanwhile: the first runtime waited for Try again, and nothing restarted it.
    expect(runtimeLines(home)).toEqual({ started: earlier.started + 2, exited: earlier.exited + 1, held: earlier.held + 2 })
    await expect(page.getByRole('heading', { name: 'Althar is open somewhere else', level: 1 })).toBeVisible()

    // Closed, it opens.
    other.close()
    held = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Claude Code').first()).toBeVisible()
  } finally {
    if (held) other.close()
    await electronApp.close()
  }
})

test('a second launch on the same profile brings the first forward and ends, while another profile opens beside it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-twice-'))
  const { electronApp, page } = await launch(home)
  try {
    await expect(page.getByText('Claude Code').first()).toBeVisible()
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide()
    })

    // The app as a person starts it again: on the same profile and window folder, it asks the first to come forward and exits.
    const code = await new Promise<number | null>((resolve, reject) => {
      const second = execFile(electronPath, [app], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ALTHAR_PROFILE: join(home, 'profile'), ALTHAR_QUIET: '1' },
      })
      second.on('error', reject)
      second.on('exit', resolve)
    })
    expect(code).toBe(0)
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) => window.webContents.getURL().endsWith('/renderer/index.html') && window.isVisible(),
          ),
        ),
      )
      .toBe(true)
    // It never started a runtime of its own: the first still has the one it began with.
    expect(runtimeLines(home).started).toBe(1)

    // Another profile is another Althar: both are open together.
    const otherHome = mkdtempSync(join(tmpdir(), 'althar-beside-'))
    const beside = await launch(otherHome)
    try {
      await expect(beside.page.getByText('Claude Code').first()).toBeVisible()
      await expect(page.getByText('Claude Code').first()).toBeVisible()
      expect(await mainWindow(beside.electronApp)).not.toBe(page)
    } finally {
      await beside.electronApp.close()
    }
  } finally {
    await electronApp.close()
  }
})
