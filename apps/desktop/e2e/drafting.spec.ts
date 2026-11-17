import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * A task's card shows from the moment the coordinator begins drafting it,
 * not once its plan is in: the scripted coordinator calls draft_task and
 * propose_plan as Claude Code does, its input streamed a field at a time,
 * slowly (`[coordinator:slowly]`), so each moment can be seen. The card fills
 * in as it is written, then the plan's card takes its place; held while it
 * was drafted, the plan comes held.
 */

test('shows a task as it is drafted, then its plan, held as it was while drafted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Add a retry to the checkout call. [coordinator:plan] [coordinator:slowly]')
    await box.press('Enter')

    // The card from the draft's first moment, before its title is written: nothing to start, only Hold.
    await expect(conversation.getByText('Putting a team together')).toBeVisible()
    await expect(conversation.getByText(/^Starts in/)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/drafting-1-begun.png' })
    // Its title as written, then who leads it as it is chosen.
    await expect(conversation.getByText('Add a retry to the checkout call', { exact: true })).toBeVisible()
    await expect(conversation.getByText('Choosing a lead')).toBeVisible()
    await page.screenshot({ path: 'test-results/drafting-2-lead.png' })
    // In dark, with reduced motion: the lead's node stands still while it's chosen.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: 'test-results/drafting-2-lead-dark.png' })
    // Held while drafted.
    await conversation.getByRole('button', { name: 'Hold' }).click()
    await expect(conversation.getByText('Held · starts when you say')).toBeVisible()

    // The plan's card takes its place, once, held: it doesn't start on its own.
    await expect(conversation.getByText('Held', { exact: true })).toBeVisible()
    await expect(conversation.getByText('Putting a team together')).toHaveCount(0)
    await expect(conversation.getByText('Add a retry to the checkout call', { exact: true })).toHaveCount(1)
    await expect(conversation.getByText(/^Starts in/)).toHaveCount(0)
    await expect(conversation.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/drafting-3-planned-dark.png' })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: 'test-results/drafting-3-planned.png' })
  } finally {
    await electronApp.close()
  }
})
