import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * The window's own chrome, as Linux gets it: a menu for its accelerators only
 * — Electron would draw its bar above the window, so the app hides it, and
 * the tabs' strip is the window — and the strip's own buttons reach the window itself through the
 * preload and the main process. What each button asks for is caught in the
 * main process rather than judged by a window manager, which a bare virtual
 * display has none of; the close really closes.
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
    // A menu for its accelerators only: zoom, full screen and quit are reachable, and its bar is hidden on the window.
    const menu = await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? null)
    expect(menu).toEqual(['File', 'Edit', 'View'])
    const bar = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isMenuBarVisible()))
    expect(bar).toBe(false)

    // Before there is any project there are no tabs: the first screen's own bar carries the window's own buttons, so the window can still be closed.
    await expect(page.getByRole('button', { name: 'Close the window' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Minimize the window' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toBeVisible()

    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // Catch what each button asks for, keep the maximized state, and tell the window, so the toggle and the third button's name are judged.
    await electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.windowCalls = []
      let maximized = false
      BrowserWindow.prototype.minimize = () => globalThis.windowCalls!.push('minimize')
      BrowserWindow.prototype.maximize = function () {
        maximized = true
        globalThis.windowCalls!.push('maximize')
        this.webContents.send('althar:maximized', true)
      }
      BrowserWindow.prototype.unmaximize = function () {
        maximized = false
        globalThis.windowCalls!.push('unmaximize')
        this.webContents.send('althar:maximized', false)
      }
      BrowserWindow.prototype.isMaximized = () => maximized
    })
    const calls = () => electronApp.evaluate(() => globalThis.windowCalls)

    await page.getByRole('button', { name: 'Minimize the window' }).click()
    await expect.poll(calls).toEqual(['minimize'])
    await page.getByRole('button', { name: 'Maximize the window' }).click()
    await expect.poll(calls).toEqual(['minimize', 'maximize'])
    // Maximized, the third button restores the window.
    await page.getByRole('button', { name: 'Restore the window' }).click()
    await expect.poll(calls).toEqual(['minimize', 'maximize', 'unmaximize'])
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toBeVisible()

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

test('closes from the first screen, before any project', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the system menu bar and traffic lights')
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    // The close really closes: it is the last window and there is no project yet, so the app goes with it.
    const closed = new Promise<void>((resolve) => page.on('close', () => resolve()))
    const exited = new Promise<void>((resolve) => electronApp.process().once('exit', () => resolve()))
    await page.getByRole('button', { name: 'Close the window' }).click()
    await closed
    await exited
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})

test('maximizes and restores from the failure screen, before any project', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the system menu bar and traffic lights')
  // The failure screen comes after the wait for the runtime's port, which never comes here.
  test.setTimeout(60_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, { ALTHAR_NO_RUNTIME: '1' })
  try {
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toBeVisible({ timeout: 30_000 })
    // Catch what the button asks for, and tell the window, so the third button's name is judged.
    await electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.windowCalls = []
      let maximized = false
      BrowserWindow.prototype.maximize = function () {
        maximized = true
        globalThis.windowCalls!.push('maximize')
        this.webContents.send('althar:maximized', true)
      }
      BrowserWindow.prototype.unmaximize = function () {
        maximized = false
        globalThis.windowCalls!.push('unmaximize')
        this.webContents.send('althar:maximized', false)
      }
      BrowserWindow.prototype.isMaximized = () => maximized
    })
    const calls = () => electronApp.evaluate(() => globalThis.windowCalls)
    await page.getByRole('button', { name: 'Maximize the window' }).click()
    await expect.poll(calls).toEqual(['maximize'])
    await page.getByRole('button', { name: 'Restore the window' }).click()
    await expect.poll(calls).toEqual(['maximize', 'unmaximize'])
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toBeVisible()
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})
