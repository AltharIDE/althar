import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, showPanes, sizeWindow, startTask, still, toConversation } from './support'

/*
 * Memory critical (ALTHAR_FAKE_PRESSURE), one agent may work of the person's
 * three: Up next says which tasks that holds back and until when, and how
 * many may work, which opens This Mac; the one held there starts anyway from
 * its row, and the other's own view says the same.
 */

test('says in Up next and on a held task what memory holds back, and starts one anyway', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_PRESSURE: 'memory' })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repository(projects))
    // The person's number: three at a time.
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = settings.getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    for (const n of ['2', '3']) {
      await page.keyboard.press('ArrowRight')
      await expect(slider).toHaveAttribute('aria-valuenow', n)
    }
    await page.keyboard.press('Escape')
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()

    // One at work; memory lets no other start, so the next two are held back, which the person's three would have running.
    await startTask(page, 'Translate the welcome emails', '[lead:wait]')
    await expect(page.getByRole('article', { name: 'Translate the welcome emails', exact: true })).toContainText('Running')
    // Its agent at work, the runtime reads the computer: memory short, one may work for now. Only then does more start.
    const meter = page.getByRole('button', { name: /^CPU \d+%, MEM \d+%$/ })
    const load = page.getByRole('dialog', { name: /’s load$/ })
    await meter.click()
    await expect(load.getByText('1 at a time until memory frees up')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(load).toHaveCount(0)
    await startTask(page, 'Add a worker as easily as connecting a home', '[lead:wait]')
    await startTask(page, 'Show receipts in the customer portal', '[lead:wait]')
    await showPanes(page, { conversation: false, board: true })
    const next = page.getByRole('region', { name: 'The project’s work' }).getByRole('region', { name: 'Up next' })
    await expect(next.getByText('Held back until memory frees up')).toBeVisible()
    await expect(next.locator('[data-row]')).toContainText([
      'Add a worker as easily as connecting a home',
      'Show receipts in the customer portal',
    ])
    await expect(next.getByText(/agents? busy/)).toHaveCount(0)
    // Nothing pointed at or focused from the layout menu: the board as it stands.
    await page.mouse.move(800, 600)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await still(page)
    await page.screenshot({ path: 'test-results/held-back-board-light.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await still(page)
    await page.screenshot({ path: 'test-results/held-back-board-dark.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

    // How many may work, of the number, opens This Mac from the bar: the same agents, and why fewer.
    await next.getByRole('button', { name: '1 of 3 at a time' }).click()
    await expect(load.getByText('1 at a time until memory frees up')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(load).toHaveCount(0)

    // Narrow, its words stay whole.
    await sizeWindow(electronApp, page, 900, 760)
    await still(page)
    await next.screenshot({ path: 'test-results/held-back-narrow.png', scale: 'css', animations: 'disabled' })
    await sizeWindow(electronApp, page, 1440, 900)

    // The first held starts anyway from its row: in Running at once, and at work.
    // Reached by its title, from the keyboard: its line turns into Start anyway as it does under the pointer.
    const first = next.locator('[data-row]').filter({ hasText: 'Add a worker as easily as connecting a home' })
    await first.getByRole('button', { name: 'Add a worker as easily as connecting a home', exact: true }).focus()
    await still(page)
    await next.screenshot({ path: 'test-results/held-back-start-anyway.png', scale: 'css', animations: 'disabled' })
    await first.getByRole('button', { name: 'Start anyway' }).click()
    const running = page.getByRole('region', { name: 'The project’s work' }).getByRole('region', { name: 'Running' })
    await expect(running.getByRole('button', { name: 'Add a worker as easily as connecting a home', exact: true })).toBeVisible()
    await expect(next.locator('[data-row]')).toHaveCount(1)
    // Two at work now: still one may for now, so the other is held back yet.
    await expect(next.getByText('Held back until memory frees up')).toBeVisible()

    // The other's own view says the same over its composer and in its header, and starts it anyway from there.
    await next.getByRole('button', { name: 'Show receipts in the customer portal', exact: true }).click()
    await toConversation(page)
    const header = page.getByRole('banner', { name: 'Show receipts in the customer portal' })
    await expect(header.getByText('Held back until memory frees up')).toBeVisible()
    const chip = page.getByRole('button', { name: /^Held back, until memory frees up/ })
    await chip.click()
    const behind = page.getByRole('dialog', { name: 'Behind this task' })
    await expect(behind.getByText('Until memory frees up')).toBeVisible()
    await page.mouse.move(800, 300)
    await still(page)
    await page.screenshot({ path: 'test-results/held-back-task.png', scale: 'css', animations: 'disabled' })
    await behind.getByRole('button', { name: 'Start anyway' }).click()
    // At once, and as the runtime starts it: no longer held back.
    await expect(header.getByText('Held back until memory frees up')).toHaveCount(0)
    await expect(chip).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
