import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The window's own chrome, as Linux gets it: no application menu — the tabs'
 * strip is the window — and the strip's own buttons reach the window itself
 * through the preload and the main process. What each button asks for is
 * caught in the main process rather than judged by a window manager, which a
 * bare virtual display has none of; the close really closes.
 */

declare global {
  // What the window's own buttons reached, in the main process.
  var windowCalls: Array<string> | undefined
}

test('draws the window’s own chrome off a Mac, and its buttons reach the window', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the system menu bar and traffic lights')
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    // No application menu at all: no File Edit View Window, and nothing on Alt.
    expect(await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull()

    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // Catch what each button asks for, and keep the maximized state, so the toggle is judged.
    await electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.windowCalls = []
      let maximized = false
      BrowserWindow.prototype.minimize = () => globalThis.windowCalls!.push('minimize')
      BrowserWindow.prototype.maximize = () => {
        maximized = true
        globalThis.windowCalls!.push('maximize')
      }
      BrowserWindow.prototype.unmaximize = () => {
        maximized = false
        globalThis.windowCalls!.push('unmaximize')
      }
      BrowserWindow.prototype.isMaximized = () => maximized
    })
    const calls = () => electronApp.evaluate(() => globalThis.windowCalls)

    await page.getByRole('button', { name: 'Minimize the window' }).click()
    await expect.poll(calls).toEqual(['minimize'])
    await page.getByRole('button', { name: 'Maximize the window' }).click()
    await expect.poll(calls).toEqual(['minimize', 'maximize'])
    await page.getByRole('button', { name: 'Maximize the window' }).click()
    await expect.poll(calls).toEqual(['minimize', 'maximize', 'unmaximize'])

    // The close really closes: it is the last window, so the app goes with it.
    const closed = new Promise<void>((resolve) => page.on('close', () => resolve()))
    const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
    await page.getByRole('button', { name: 'Close the window' }).click()
    await closed
    await exited
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})
