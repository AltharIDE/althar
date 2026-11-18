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
