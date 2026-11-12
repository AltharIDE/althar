import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, showPanes, shown, startTask, still } from './support'

/*
 * Tasks started while every place is taken wait in the board's Up next, in the
 * order they will start, above the plans, not in Running: nothing of them has
 * had an agent. With one agent at a time, held by a server a finished task
 * left running, three tasks wait, one plan is held and one counts down. Up
 * next is one order: the person drags the held plan to the top, which starts
 * it there, and the first that waited past the plan counting down, which
 * starts that plan ahead of it. When the server is stopped, the plan put
 * first moves to Running by itself. Shots: test-results/upnext-*.png.
 */

test('lists the tasks that wait for a free agent in Up next, in the order they start, above the plans', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
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
    await expect(settings).toHaveCount(0)
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    // Its server is running before the next task is asked for: a task started before that would take the place itself
    // and leave only two waiting, whatever the test then counted. The place holder shows only over a task that waits,
    // so the task's own thread says it ran the command that keeps the place.
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('button', { name: /ran 1 command/ })).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    // Each waits before the next is asked for, so a plan left counting down is caught where it happens rather than as a
    // row in the wrong place later.
    await startTask(page, 'Add a retry', '[lead:wait]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(1)
    await startTask(page, 'Tidy the docs', '[lead:finish]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(2)
    await startTask(page, 'Rename the helper', '[lead:finish]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(3)
    // A plan the person holds, and one counting down, are not started either.
    await planTask(page, 'Hold this plan', '[lead:wait]')
    // Its card is the last in the conversation, once it is there: the waiting tasks' cards have a Hold of their own. Exactly: the
    // plan up next on the board beside is named for it.
    await expect(shown(page, 'Hold this plan', { exact: true }).last()).toBeVisible()
    await page.getByRole('button', { name: 'Hold', exact: true }).last().click()
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText('Held', { exact: true })).toBeVisible()
    await planTask(page, 'Plan the release')

    await showPanes(page, { conversation: false, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    const running = work.getByRole('region', { name: 'Running' })
    await expect(next.getByText('Planned', { exact: true })).toBeVisible()
    await still(page)
    await page.screenshot({ path: 'test-results/upnext-board.png', animations: 'disabled' })

    await tabs.getByRole('button', { name: /^Home/ }).click()
    await still(page)
    await page.screenshot({ path: 'test-results/upnext-home.png', animations: 'disabled' })
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    // Up next lists the three in the order they started, then the plan on its countdown, then the held one; none is in Running.
    const rows = next.getByRole('listitem')
    await expect(rows).toHaveCount(5)
    await expect(rows.nth(0)).toContainText('Add a retry')
    await expect(rows.nth(1)).toContainText('Tidy the docs')
    await expect(rows.nth(2)).toContainText('Rename the helper')
    await expect(rows.nth(3)).toContainText('Plan the release')
    await expect(rows.nth(4)).toContainText('Hold this plan')
    await expect(running.getByRole('article')).toHaveCount(0)

    // Presses a row's grip and drags it, a step at a time, to a point, letting go there.
    const drag = async (title: string, to: { x: number; y: number }) => {
      await rows.filter({ hasText: title }).hover()
      const grip = await next.getByRole('button', { name: `Move ${title} in the line` }).boundingBox()
      if (grip === null) throw new Error(`${title} has no grip`)
      const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let step = 1; step <= 10; step++)
        await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10)
      await page.mouse.up()
      await page.mouse.move(1400, 880)
    }
    // The held plan, across Planned to the top: it starts there, and once the runtime has it, it is next in line, not held.
    const top = await rows.nth(0).boundingBox()
    if (top === null) throw new Error('Up next isn’t laid out')
    await drag('Hold this plan', { x: top.x + 20, y: top.y + 4 })
    await expect(rows.nth(0)).toContainText('Hold this plan')
    await expect(rows.nth(0)).toContainText('Next in line')
    await expect(rows.nth(1)).toContainText('Add a retry')
    await expect(rows.nth(4)).toContainText('Plan the release')
    await expect(rows).toHaveCount(5)
    // The first that waited, past the plan at the bottom: the plan starts ahead of it, so the line keeps the order put, and
    // nothing is planned now.
    const bottom = await rows.nth(4).boundingBox()
    if (bottom === null) throw new Error('Up next isn’t laid out')
    await drag('Add a retry', { x: bottom.x + 20, y: bottom.y + bottom.height + 20 })
    await expect(rows.nth(4)).toContainText('Add a retry')
    await expect(rows.nth(4)).toContainText('5th in line')
    await expect(rows.nth(3)).toContainText('Plan the release')
    await expect(rows.nth(3)).toContainText('4th in line')
    await expect(next.getByText('Planned', { exact: true })).toHaveCount(0)
    await expect(next.getByText('In your order')).toBeVisible()
    await still(page)
    await next.screenshot({ path: 'test-results/upnext-reordered.png', scale: 'css', animations: 'disabled' })
    // It is the runtime's order, not the drop's: the board, drawn again from it, says the same.
    await showPanes(page, { conversation: true, board: false })
    await showPanes(page, { conversation: false, board: true })
    await expect(rows.nth(0)).toContainText('Hold this plan')
    await expect(rows.nth(1)).toContainText('Tidy the docs')
    await expect(rows.nth(2)).toContainText('Rename the helper')
    await expect(rows.nth(3)).toContainText('Plan the release')
    await expect(rows.nth(4)).toContainText('Add a retry')

    // The place frees: the plan put first starts by itself, and moves to Running, where it keeps the place; the rest wait on
    // in the order put.
    await showPanes(page, { conversation: true, board: false })
    await page
      .getByRole('button', { name: /^Keeping a place/ })
      .first()
      .click()
    await page.getByRole('dialog', { name: 'Keeping a place' }).getByRole('button', { name: /^Stop/ }).click()
    await showPanes(page, { conversation: false, board: true })
    await expect(running.getByRole('button', { name: 'Hold this plan' })).toBeVisible()
    await expect(rows.nth(0)).toContainText('Tidy the docs')
    await expect(rows.nth(2)).toContainText('Plan the release')
    await expect(rows.nth(3)).toContainText('Add a retry')
    await still(page)
    await page.screenshot({ path: 'test-results/upnext-started.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
