import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, startTask, still, toConversation, showPanes } from './support'

/* A finished preview leaves capacity free; real work names the place it holds. */

test('says over the composer why the task waits, opens who holds the place, and moves it to the front and frees the place from there', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repository(projects))
    // One agent at a time.
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = settings.getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    // The finished preview takes no place; the next lead runs, and two wait for it.
    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await startTask(page, 'Add a retry', '[lead:wait]')
    await expect(page.getByRole('article', { name: 'Add a retry', exact: true })).toContainText('Running')
    await startTask(page, 'Check links', '[lead:wait]')
    await expect(page.getByText(/^Waiting · 1 agent busy$/)).toHaveCount(1)
    await startTask(page, 'Tidy the docs', '[lead:wait]')
    await expect(page.getByText(/^Waiting · 1 agent busy$/)).toHaveCount(2)
    await page
      .getByText(/^Waiting · 1 agent busy$/)
      .last()
      .scrollIntoViewIfNeeded()
    await still(page)
    await page.screenshot({ path: 'test-results/slots-holders-light.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await still(page)
    await page.screenshot({ path: 'test-results/slots-holders-dark.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await sizeWindow(electronApp, page, 880, 700)
    const holderLine = page.getByText(/^Waiting · 1 agent busy$/).last()
    await holderLine.scrollIntoViewIfNeeded()
    await expect(holderLine).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/slots-holders-narrow.png', scale: 'css', animations: 'disabled' })
    await sizeWindow(electronApp, page, 1440, 900)

    // The second in line, opened from the board.
    await showPanes(page, { conversation: false, board: true })
    const next = page.getByRole('region', { name: 'The project’s work' }).getByRole('region', { name: 'Up next' })
    const places = next.getByText('1 of 1 agent places in use', { exact: true })
    await places.click()
    const holders = next.getByRole('list', { name: 'Agents using a place' })
    await expect(holders.getByText('Add a retry', { exact: true })).toBeVisible()
    await expect(holders.getByText(/Lead.*In a turn/)).toBeVisible()
    await expect(holders.getByRole('listitem')).toHaveCount(1)
    await still(page)
    await next.screenshot({ path: 'test-results/up-next-places-light.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await sizeWindow(electronApp, page, 880, 700)
    await still(page)
    await next.screenshot({ path: 'test-results/up-next-places-dark.png', scale: 'css', animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await sizeWindow(electronApp, page, 1440, 900)
    await expect(next.getByRole('listitem').nth(1)).toContainText('Tidy the docs')
    await next.getByRole('button', { name: 'Tidy the docs', exact: true }).click()
    await toConversation(page)

    // The chip says it waits, and where it stands, not who holds the place.
    const chip = page.getByRole('button', { name: 'Waiting for a place, 2nd in Up next' })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText(/^Waiting for a place\s*2nd in Up next$/)
    const composer = page
      .locator('form')
      .filter({ has: page.getByRole('textbox') })
      .last()
    // The chip floats over the composer's top edge: a shot of the two together.
    const shoot = async (path: string) => {
      const [top, box] = await Promise.all([chip.boundingBox(), composer.boundingBox()])
      if (top === null || box === null) throw new Error('The chip isn’t laid out')
      const y = Math.min(top.y, box.y) - 12
      await page.screenshot({
        path,
        clip: { x: box.x - 12, y, width: box.width + 24, height: box.y + box.height + 12 - y },
        scale: 'css',
        animations: 'disabled',
      })
    }
    await page.mouse.move(1400, 300)
    await still(page)
    await shoot('test-results/waiting-chip.png')

    // It opens who holds the place by title, with the way to the front.
    await chip.click()
    const behind = page.getByRole('dialog', { name: 'Behind this task' })
    await expect(behind.getByText('Add a retry')).toBeVisible()
    await still(page)
    await behind.screenshot({ path: 'test-results/waiting-open.png', scale: 'css', animations: 'disabled' })
    await page.keyboard.press('Escape')

    // At the window's narrowest, the chip still sits whole on the composer's edge, over nothing else.
    await sizeWindow(electronApp, page, 880, 700)
    await still(page)
    const [edge, field] = await Promise.all([chip.boundingBox(), composer.boundingBox()])
    if (edge === null || field === null) throw new Error('The chip isn’t laid out')
    expect(edge.x).toBeGreaterThanOrEqual(field.x)
    expect(edge.x + edge.width).toBeLessThanOrEqual(field.x + field.width)
    expect(await chip.evaluate((one) => one.scrollWidth <= one.clientWidth)).toBe(true)
    await shoot('test-results/waiting-narrow.png')

    // To the front of the line, from here.
    await chip.click()
    await behind.getByRole('button', { name: 'Move to the front of the line' }).click()
    await expect(page.getByRole('button', { name: 'Waiting for a place, First in Up next' })).toBeVisible()
    await expect(behind.getByRole('button', { name: 'Move to the front of the line' })).toHaveCount(0)

    // Open the named holder and stop it: the first task in line starts.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: false, board: true })
    await page.getByRole('region', { name: 'Running' }).getByRole('button', { name: 'Add a retry', exact: true }).click()
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page.getByRole('menuitem', { name: /Stop the task/ }).click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: false, board: true })
    await expect(page.getByRole('region', { name: 'Running' }).getByText('Tidy the docs')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
