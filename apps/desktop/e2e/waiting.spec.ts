import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, sizeWindow, startTask, still, toConversation } from './support'

/*
 * Why a task waits, over its composer, in a real window with the fake agent:
 * with one agent at a time, held by a server a finished task left running,
 * two tasks wait in Up next. The second, opened from the board, says it waits
 * in a few words on the chip over its composer, at the window's widest and its
 * narrowest; the chip opens who holds the place, and from there it goes to the
 * front of the line, and the server is stopped, so it starts.
 * Shots: test-results/waiting-*.png.
 */

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

    // A task whose server keeps the one place, then two that wait for it.
    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await startTask(page, 'Add a retry', '[lead:wait]')
    await startTask(page, 'Tidy the docs', '[lead:wait]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(2)

    // The second in line, opened from the board.
    await page.getByRole('radio', { name: /^Board/ }).click()
    const next = page.getByRole('region', { name: 'The project’s work' }).getByRole('region', { name: 'Up next' })
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

    // It opens who holds the place: the task by its title, what keeps it, and Stop; and the way to the front.
    await chip.click()
    const behind = page.getByRole('dialog', { name: 'Behind this task' })
    await expect(behind.getByText('1 task is running; 1 of them only for a server it left running.')).toBeVisible()
    await expect(behind.getByText('Serve the prototype')).toBeVisible()
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

    // Stopping the server frees the place: it starts, and no longer waits.
    await behind.getByRole('button', { name: 'Stop what Serve the prototype left running' }).click()
    await expect(page.getByRole('button', { name: /^Waiting for a place/ })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
