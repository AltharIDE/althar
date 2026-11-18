import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

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
    // One bar, one set of buttons.
    await expect(page.getByRole('button', { name: 'Close the window' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Minimize the window' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toHaveCount(1)

    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // The tabs' bar draws them now; the first screen's overlay is gone, not a second bar.
    await expect(page.getByRole('button', { name: 'Close the window' })).toHaveCount(1)

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

test('on KDE: one bar, the strip’s, with KDE’s buttons in KWin’s order at its end, after the gear', async () => {
  test.skip(process.platform !== 'linux', 'the desktops a Linux window sits on')
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // KWin's buttons as the person has them, in the home's own kwinrc: none of this computer's config is read.
  const config = join(home, '.config')
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'kwinrc'), '[org.kde.kdecoration2]\nButtonsOnLeft=MS\nButtonsOnRight=IAX\n')
  const kde = { XDG_CURRENT_DESKTOP: 'KDE', KDE_FULL_SESSION: 'true', KDE_SESSION_VERSION: '6' }
  const { electronApp, page } = await launch(
    home,
    { ...kde, XDG_CONFIG_HOME: config, XDG_CONFIG_DIRS: join(home, 'xdg') },
    { scheme: 'system' },
  )
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // One set of buttons, drawn by the strip (a window with KWin's frame would draw none), in KWin's order: minimize, maximize, close.
    const strip = page.locator('header').filter({ has: page.getByRole('button', { name: 'Close the window' }) })
    await expect(strip).toHaveCount(1)
    const buttons = strip.getByRole('button', { name: /^(Minimize|Maximize|Close) the window$/ })
    await expect(buttons).toHaveCount(3)
    expect(await buttons.evaluateAll((all) => all.map((one) => one.getAttribute('aria-label')))).toEqual([
      'Minimize the window',
      'Maximize the window',
      'Close the window',
    ])
    // In KDE's manner, at the strip's end, after Althar's gear.
    await expect(strip.locator('[data-side="end"]')).toHaveClass(/kde/)
    const gear = (await strip.getByRole('button', { name: 'Althar settings' }).boundingBox())?.x ?? Infinity
    const minimize = (await strip.getByRole('button', { name: 'Minimize the window' }).boundingBox())?.x ?? -Infinity
    expect(minimize).toBeGreaterThan(gear)

    for (const scheme of ['light', 'dark'] as const) {
      await electronApp.evaluate(({ nativeTheme }, source) => {
        nativeTheme.themeSource = source
      }, scheme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      await still(page)
      await strip.screenshot({ path: `test-results/window-kde-bar-${scheme}.png`, scale: 'css', animations: 'disabled' })
    }
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
    // The launch's veil is decoration over the first screen until the launch has opened, then lets the pointer through.
    // Waiting for that is waiting for the window to be usable, as a person waits for the launch to open.
    await page.waitForFunction(() => {
      const veil = document.querySelector('[class*="veil"]')
      return veil === null || getComputedStyle(veil).pointerEvents === 'none'
    })
    // The window goes as it is clicked, so there is nothing after the click to wait for.
    await page.getByRole('button', { name: 'Close the window' }).click({ noWaitAfter: true })
    await closed
    await exited
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})

test('maximizes and restores from the failure screen, before any project', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the system menu bar and traffic lights')
  // The failure screen comes after the wait for the runtime's port, which never comes here.
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, { ALTHAR_NO_RUNTIME: '1' })
  try {
    await expect(page.getByRole('button', { name: 'Maximize the window' })).toBeVisible()
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
