import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openMadeProject, say, still, toFirstProject } from './support'

/*
 * A plan card's pickers open beside the row that was pressed and stay there, in the real layout: with the conversation at its
 * narrowest, beside the board, where a picker wider than the row would hang over the board. Pressed at the row's right end, the
 * model and effort picker lies within the row; picking in it, and scrolling, move it not.
 */

test("a plan card's pickers stay within their row beside the board, through picking and scrolling", async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  repository(projects)
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await toFirstProject(page)
    await page
      .getByRole('list', { name: 'Repositories for the project' })
      .getByRole('checkbox', { name: /meridian/ })
      .click()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await openMadeProject(page)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // The conversation at its narrowest, as the person can drag it.
    const edge = page.getByRole('separator', { name: 'Width of the conversation' })
    await edge.focus()
    await page.keyboard.press('Home')
    await say(page, 'Rework how the cache expires. [coordinator:plan-effort] [coordinator:plan-no-review] [lead:finish]')
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const plan = conversation.locator('[data-rhythm="card"]').filter({
      has: page.getByText('Rework how the cache expires', { exact: true }),
    })
    await plan.getByRole('button', { name: 'Hold', exact: true }).click()
    await expect(plan.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    await still(page)

    const within = async (panel: ReturnType<typeof page.getByRole>, row: ReturnType<typeof page.getByRole>) => {
      const [p, r, c] = await Promise.all([panel.boundingBox(), row.boundingBox(), conversation.boundingBox()])
      if (p === null || r === null || c === null) throw new Error('nothing to measure')
      // Inside its row, and so inside the conversation, not over the board.
      expect(p.x).toBeGreaterThanOrEqual(r.x - 1)
      expect(p.x + p.width).toBeLessThanOrEqual(r.x + r.width + 1)
      expect(p.x + p.width).toBeLessThanOrEqual(c.x + c.width + 1)
      return p
    }

    const lead = page.getByRole('button', { name: /^Lead for this task: .*Large High$/ })
    await expect(lead).toBeVisible()
    const row = conversation.locator('li', { hasText: 'Implement' })
    const at = (await row.boundingBox())!
    // Pressed near the row's right end.
    await page.mouse.click(at.x + at.width - 40, at.y + at.height / 2)
    const picker = page.getByRole('dialog', { name: /Lead for this task model and effort/ })
    await expect(picker).toBeVisible()
    await still(page)
    const first = await within(picker, row)
    await page.screenshot({ path: 'test-results/lead-picker-narrow-open.png', animations: 'disabled', scale: 'css' })

    // An effort picked, then the conversation scrolled: it hasn't moved.
    await picker.getByRole('radio', { name: 'Low' }).click()
    await expect(page.getByRole('button', { name: /^Lead for this task: .*Large Low$/ })).toBeVisible()
    await conversation.hover()
    await page.mouse.wheel(0, 60)
    await still(page)
    const after = await within(picker, row)
    expect(after.x).toBeCloseTo(first.x, 0)
    await page.screenshot({ path: 'test-results/lead-picker-narrow-after-effort.png', animations: 'disabled', scale: 'css' })
    // And a model picked: the same.
    await picker.getByRole('radio', { name: /Claude Small/ }).click()
    await expect(page.getByRole('button', { name: /^Lead for this task: Claude Small/ })).toBeVisible()
    await still(page)
    expect((await within(picker, row)).x).toBeCloseTo(first.x, 0)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
  } finally {
    await electronApp.close()
  }
})
