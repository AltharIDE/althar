import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say, showPanes } from './support'

/*
 * Tasks wait for their blockers, in a real window with the fake agents: the
 * coordinator plans one task after another (`[after:<slug>]`). The one that
 * waits says so on its row in Up next, in its header, whose words open what
 * it waits for, and on its plan card, a stop before its lead; its countdown
 * ends and it doesn't start. Once the task it waits for is abandoned, it is
 * the person's, in Needs you, and Start now from its header starts it.
 */

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/blockers-${name}.png`, animations: 'disabled' })

test('a task that waits for another says so everywhere, and comes to the person once that one is abandoned', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await showPanes(page, { conversation: true, board: true })
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const work = page.getByRole('region', { name: 'The project’s work' })

    // The first, held: it doesn't start while this runs. The second waits for it.
    await planTask(page, 'Pair a device')
    await conversation.getByRole('button', { name: 'Hold' }).click()
    await expect(conversation.getByText('Held', { exact: true })).toBeVisible()
    await say(page, 'Reconnect on wake. [coordinator:plan-no-review] [after:pair-a-device] [lead:finish]')

    // Its plan card: what it waits for, a stop before its lead, and when it starts, where the clock was.
    await expect(conversation.getByText('Pair a device merges')).toBeVisible()
    await expect(conversation.getByText('Starts when it merges')).toBeVisible()
    // Its row in Up next says when it starts.
    await expect(work.getByText('Starts when Pair a device merges')).toBeVisible()
    await page.mouse.move(1400, 880)
    await shot(page, '1-waits')

    // Its page: its header says the same, and opens what it waits for.
    await work.getByText('Reconnect on wake', { exact: true }).click()
    const header = page.getByRole('button', { name: /^Starts when Pair a device merges/ })
    await expect(header).toBeVisible()
    await header.click()
    await expect(page.getByRole('button', { name: 'Start now, without waiting' })).toBeVisible()
    await shot(page, '2-page')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    // The one it waits for is abandoned.
    await work.getByText('Pair a device', { exact: true }).click()
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /Abandon/ })
      .click()
    const asked = page.getByRole('dialog', { name: 'Abandon this task?' })
    await asked.getByRole('button', { name: 'Abandon task' }).click()
    await expect(asked).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    // It is the person's now, in Needs you, saying which, and out of Up next.
    const needs = work.getByRole('region', { name: /^Needs you/ })
    await expect(needs.getByText('Pair a device was abandoned')).toBeVisible()
    await expect(work.getByText('Starts when Pair a device merges')).toHaveCount(0)
    await page.mouse.move(1400, 880)
    await shot(page, '3-abandoned')
    // The board alone: its card in Needs you says which task was abandoned, under its title.
    await showPanes(page, { conversation: false, board: true })
    await expect(needs.getByText('Blocker abandoned')).toBeVisible()
    await page.mouse.move(700, 600)
    await shot(page, '4-board')

    // Its page: Start now, without waiting, and it starts.
    await needs.getByText('Reconnect on wake', { exact: true }).click()
    await page.getByRole('button', { name: /^Pair a device was abandoned/ }).click()
    await page.getByRole('button', { name: 'Start now, without waiting' }).click()
    await expect(page.getByRole('button', { name: /^Pair a device was abandoned/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await expect(needs.getByText('Pair a device was abandoned')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
