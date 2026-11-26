import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, still } from './support'

/*
 * Althar's own tab, in a real window: after an update from 0.8.0 it has its
 * quiet dot; opened, What's new says the jump and the dot goes; Coming next
 * is a press away; and once closed, the quick settings' version line opens
 * it again. The screenshots are this change's evidence (test-results/news-*.png).
 */

test('Althar’s tab: news after an update, What’s new and Coming next, and the version line back to it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    // The window last looked at 0.8.0's news: this Althar is an update from it.
    await page.evaluate(() => window.localStorage.setItem('althar.news', JSON.stringify({ seen: '0.8.0' })))
    await page.reload()

    const nav = page.getByRole('navigation', { name: 'Projects' })
    const tab = nav.getByRole('button', { name: 'Althar, what’s new in this version' })
    await expect(tab).toBeVisible()
    await still(page)
    await page.locator('header').first().screenshot({ path: 'test-results/news-tab.png', scale: 'css' })

    await tab.click()
    await expect(page.getByLabel(/^Updated from 0\.8\.0 to /)).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Althar', exact: true })).toHaveAttribute('aria-current', 'page')
    await still(page)
    await page.screenshot({ path: 'test-results/news-whats-new.png', scale: 'css' })

    await page.getByRole('button', { name: 'See what’s coming next' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Shape what’s next' })).toBeVisible()
    // The phone's picture loops; it's shot once the ask is on it.
    await page.waitForFunction(() => {
      const ask = document.querySelector('[data-picture="phone"] [class*="notice"]')
      return ask !== null && Number(getComputedStyle(ask).opacity) === 1
    })
    await still(page)
    await page.screenshot({ path: 'test-results/news-coming-next.png', scale: 'css' })

    // Closed, it's gone; the version line in the quick settings opens it again.
    await nav.getByRole('button', { name: 'Close Althar' }).click()
    await expect(nav.getByRole('button', { name: 'Althar', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Althar settings' }).click()
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'What’s new' }).click()
    await expect(nav.getByRole('button', { name: 'Althar', exact: true })).toHaveAttribute('aria-current', 'page')
  } finally {
    await electronApp.close()
  }
})
