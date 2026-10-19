import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask } from './support'

/*
 * The board's lanes in a real window, as it narrows: those that don't fit
 * collapse to rails by themselves, Settled first; beside the conversation,
 * Up next too. Needs you, collapsed by the person while it was empty, opens
 * by itself when a question arrives, and the focus on its rail goes to its
 * head. The question comes from a task planned beforehand, whose lead asks
 * first (`[lead:ask]`), once its countdown runs out. The screenshots it takes
 * are this change's own evidence (test-results/lanes-*.png).
 */

test('collapses the lanes that don’t fit, and opens Needs you when something arrives in it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  // Althar's own window: not always the first, where the menu bar's windows are made too.
  const window = await electronApp.browserWindow(page)
  const sized = async (width: number) => {
    await window.evaluate((made, wide) => made.setSize(wide, 760), width)
    await page.waitForTimeout(500)
  }
  try {
    await sized(1440)
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // A task planned, which starts by itself after its countdown and asks the person first.
    await planTask(page, 'Cache the rates', '[lead:ask] [lead:finish]')

    // Wide, the four lanes fit.
    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    await expect(work.getByText('Cache the rates')).toBeVisible()
    await expect(work.getByRole('button', { name: /^Expand/ })).toHaveCount(0)
    await work.screenshot({ path: 'test-results/lanes-wide.png', scale: 'css' })

    // At the window's narrowest, Settled collapses, rather than the board scrolling sideways.
    await sized(880)
    await expect(work.getByRole('button', { name: 'Expand Settled, 0' })).toBeVisible()
    await expect(work.getByRole('button', { name: /^Expand/ })).toHaveCount(1)
    // Once the lanes have eased to their new widths, nothing is off to the side.
    await expect.poll(() => work.evaluate((board) => board.scrollWidth <= board.clientWidth)).toBe(true)
    await work.screenshot({ path: 'test-results/lanes-narrow.png', scale: 'css' })

    // The person collapses Needs you while it's empty, from the keyboard: the focus goes to its rail.
    await work.getByRole('button', { name: 'Collapse Needs you' }).focus()
    await page.keyboard.press('Enter')
    const rail = work.getByRole('button', { name: 'Expand Needs you, 0' })
    await expect(rail).toBeFocused()
    await work.screenshot({ path: 'test-results/lanes-needs-you-collapsed.png', scale: 'css' })

    // The question arrives: Needs you opens by itself, and its head takes the focus from the rail that went.
    await expect(work.getByRole('button', { name: 'Needs you stays open while something waits on you' })).toBeFocused({ timeout: 60_000 })
    await expect(work.getByRole('button', { name: /^Expand Needs you/ })).toHaveCount(0)
    await expect(work.getByRole('button', { name: /^Expand/ })).toHaveCount(1)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/lanes-needs-you-arrived.png', scale: 'css' })

    // Beside the conversation, at the window's narrowest: Running and Needs you keep the room.
    await page.getByRole('radio', { name: 'Home' }).click()
    const beside = page.getByRole('region', { name: 'The project’s work' })
    await expect(beside.getByRole('button', { name: 'Expand Settled, 0' })).toBeVisible()
    await expect(beside.getByRole('button', { name: /^Expand Up next/ })).toBeVisible()
    await expect(beside.getByRole('button', { name: /^Expand (Running|Needs you)/ })).toHaveCount(0)
    // Once the lanes have eased to their new widths, nothing is off to the side.
    await expect.poll(() => beside.evaluate((board) => board.scrollWidth <= board.clientWidth)).toBe(true)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/lanes-beside-narrow.png', scale: 'css' })

    // Widened again, what fits opens by itself.
    await sized(1440)
    await expect(beside.getByRole('button', { name: /^Expand Up next/ })).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/lanes-beside-wide.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
