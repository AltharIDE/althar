import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * Light or dark, as Settings › Appearance says. Kept dark, the window opens
 * dark: its paper (what shows before the page draws, and round it as it
 * resizes) is the page's dark shade, and the page is dark from its first
 * frame, so it never flashes white. Changed in Settings, both follow at once.
 */

const paper = (electronApp: Awaited<ReturnType<typeof launch>>['electronApp']) =>
  electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getBackgroundColor()))

test('opens dark when kept dark, and follows Settings › Appearance at once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'profile'), { recursive: true })
  writeFileSync(join(home, 'profile', 'desktop.json'), JSON.stringify({ appearance: 'dark' }))
  const { electronApp, page } = await launch(home, {}, { scheme: 'system' })
  try {
    // The page took the scheme before it drew, and the window's paper under it is the page's dark.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await paper(electronApp)).toContain('#1C1A17')
    expect(await electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(28, 26, 23)')
    await page.screenshot({ path: 'test-results/appearance-dark-first-screen.png', scale: 'css', animations: 'disabled' })

    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Appearance' }).click()
    const choice = page.getByRole('main').getByRole('radiogroup', { name: 'Light or dark' })
    await expect(choice.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/appearance-dark-settings.png', scale: 'css', animations: 'disabled' })

    // Light, at once: the page and the window's paper.
    await choice.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => paper(electronApp)).toContain('#F4F2EC')
    await page.screenshot({ path: 'test-results/appearance-light-settings.png', scale: 'css', animations: 'disabled' })

    // As the system is: whatever the system says now, the page and the paper agree with it.
    await choice.getByRole('radio', { name: /^Match/ }).click()
    const dark = await electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)
    await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
    await expect.poll(() => paper(electronApp)).toContain(dark ? '#1C1A17' : '#F4F2EC')
  } finally {
    await electronApp.close()
  }
})
