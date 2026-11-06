import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

test('leaves window controls to the system before and after opening a project', async () => {
  test.skip(process.platform === 'darwin', 'macOS overlays the system traffic lights')
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    const menu = await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? null)
    expect(menu).toEqual(['File', 'Edit', 'View'])
    const bar = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isMenuBarVisible()))
    expect(bar).toBe(false)
    await expect(page.getByRole('button', { name: 'Close the window' })).toHaveCount(0)
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Close|Minimize|Maximize) the window$/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/native-window.png', scale: 'css' })
    // A system close reaches BrowserWindow.close; no renderer button or IPC is involved.
    const closed = page.waitForEvent('close')
    const window = await electronApp.browserWindow(page)
    await window.evaluate((window) => window.close())
    await closed
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})

test('leaves controls to the system when the runtime cannot start', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home, { ALTHAR_NO_RUNTIME: '1' })
  try {
    await expect(page.getByRole('heading', { name: 'Althar couldn’t open' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Close|Minimize|Maximize) the window$/ })).toHaveCount(0)
  } finally {
    await electronApp.close().catch(() => undefined)
  }
})
