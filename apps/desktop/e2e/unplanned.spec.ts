import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, showPanes, still } from './support'

/*
 * A task the coordinator drafted whose plan never came says so, rather than
 * sizing for ever: its card in the conversation says it has no plan, with
 * Plan it and Discard, and the board says the same where it said Stopped,
 * with Resume. Discarded, its card says so, and it leaves Up next.
 */

test('a draft whose plan never came says so, offers to plan or discard it, and leaves Up next once discarded', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Explore the team view. [coordinator:plan] [coordinator:plan-fails]')
    await box.press('Enter')

    // Its plan refused, it says it has none, with nothing still going on, and its card stays once the turn is over.
    await expect(conversation.getByText('No plan yet')).toBeVisible()
    await expect(conversation.getByRole('button', { name: 'Plan it' })).toBeVisible()
    await expect(conversation.getByText(/Sizing it/)).toHaveCount(0)
    await expect(conversation.getByText('Putting a team together')).toHaveCount(0)

    await showPanes(page, { conversation: true, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    // On the board, the same: no plan yet, to plan, rather than stopped, to resume.
    await expect(next.getByText('No plan yet')).toBeVisible()
    await expect(next.getByRole('button', { name: 'Plan it' })).toBeVisible()
    await expect(next.getByRole('button', { name: 'Resume' })).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-1-no-plan.png', animations: 'disabled' })

    // Discarded from its card: it says so at once, and it leaves Up next.
    await conversation.getByRole('button', { name: 'Discard' }).click()
    await expect(conversation.getByText('Discarded', { exact: true })).toBeVisible()
    await expect(next.getByText('Explore the team view')).toHaveCount(0)
    await expect(next.getByText('No plan yet')).toHaveCount(0)
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-2-discarded.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

/*
 * As the person saw it: a task planned from Prototype on another model, held,
 * and a draft whose plan never came, both then discarded by the coordinator.
 * The held plan names Prototype, not Change; once discarded, each card says
 * so where it was, and neither stays Up next as held or stopped.
 */
test('a held Prototype plan and a draft with no plan, both discarded by the coordinator, say so and leave Up next', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const meridian = repository(home, 'meridian')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, meridian)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    const conversation = page.getByRole('region', { name: 'Conversation' })
    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    const say = async (words: string) => {
      await box.fill(words)
      await box.press('Enter')
    }

    // Planned from Prototype, its lead on another model than the preset's own, and held.
    await say('Explore the roles. [coordinator:plan] [coordinator:plan-prototype] [coordinator:slowly]')
    await conversation.getByRole('button', { name: 'Hold' }).click()
    await expect(conversation.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    await expect(conversation.getByText('Held', { exact: true })).toBeVisible()
    await expect(conversation.getByText('Prototype', { exact: true })).toBeVisible()
    await expect(conversation.getByText('Change', { exact: true })).toHaveCount(0)

    // Then a draft whose plan never comes.
    await say('Explore the team. [coordinator:plan] [coordinator:plan-fails]')
    await expect(conversation.getByText('No plan yet')).toBeVisible()

    await showPanes(page, { conversation: true, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    await expect(next.getByText('Explore the roles')).toBeVisible()
    await expect(next.getByText('No plan yet')).toBeVisible()
    // Both cards in sight, the held plan's first.
    const roles = conversation.getByText('Explore the roles', { exact: true }).first()
    await roles.evaluate((title) => title.scrollIntoView({ block: 'start' }))
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-3-held-and-unplanned.png', animations: 'disabled' })

    // The coordinator discards both: each card says so where it was, and Up next has neither.
    await say('Discard them. [coordinator:discard] [discard:explore-the-roles] [discard:explore-the-team]')
    await expect(conversation.getByText('Discarded', { exact: true })).toHaveCount(2)
    await expect(conversation.getByText('Prototype', { exact: true })).toBeVisible()
    await expect(conversation.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)
    await expect(conversation.getByText('No plan yet')).toHaveCount(0)
    await expect(next.getByText('Explore the roles')).toHaveCount(0)
    await expect(next.getByText('Explore the team')).toHaveCount(0)
    await expect(next.getByText(/Held\. Starts when you say/)).toHaveCount(0)
    await expect(next.getByRole('button', { name: 'Resume' })).toHaveCount(0)
    await roles.evaluate((title) => title.scrollIntoView({ block: 'start' }))
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-4-both-discarded.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
