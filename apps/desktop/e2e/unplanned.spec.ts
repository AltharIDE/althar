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

    // Plan it asks the coordinator, in the person's words; its turn over with still no plan, Plan it is offered again.
    await conversation.getByRole('button', { name: 'Plan it' }).click()
    await expect(conversation.getByText(/^Plan “Explore the team view” \(explore-the-team-view\)/)).toBeVisible()
    await expect(conversation.getByRole('button', { name: 'Plan it' })).toBeVisible()
    await expect(conversation.getByText('No plan yet')).toBeVisible()

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

/*
 * As the person saw it: they said something while the coordinator was still
 * drafting, steering it, and the drafts' cards were drawn after the
 * conversation, below their message, then moved. A draft's card stays where
 * it was drafted, above what was said since, while it is sized and once its
 * plan didn't come.
 */
test('a draft’s card stays where it was drafted, above a message sent while its plan was on its way', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home, 'meridian'))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // What they said went to the coordinator at once, mid-turn.
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    const group = page.getByRole('radiogroup', { name: 'When I send while an agent is working' })
    await group.getByRole('radio', { name: 'Steer the agent' }).click()
    await expect(group.getByRole('radio', { name: 'Steer the agent' })).toBeChecked()
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: 'Close Settings' }).click()

    const conversation = page.getByRole('region', { name: 'Conversation' })
    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue|Steer)/ })
    const say = async (words: string) => {
      await box.fill(words)
      await box.press('Enter')
    }
    await say('Explore the team. [coordinator:plan] [coordinator:plan-fails] [coordinator:slowly]')
    const title = conversation.getByText('Explore the team', { exact: true }).first()
    await expect(title).toBeVisible()
    // A task now, its plan streaming, they say something.
    await expect(conversation).toContainText(/Choosing a (lead|reviewer)/)
    await say('you dont need to split these')
    // The message itself, not the preview of it the conversation shows once it has scrolled.
    const message = conversation.locator('p:not([data-thread-preview])', { hasText: /^you dont need to split these$/ })
    await expect(message).toBeVisible()
    const above = async () => {
      const card = await title.boundingBox()
      const said = await message.boundingBox()
      return card !== null && said !== null && card.y < said.y
    }
    expect(await above()).toBe(true)
    // Its plan didn't come: its card says so, still above the message.
    await expect(conversation.getByText('No plan yet')).toBeVisible()
    await expect(conversation.getByText('Explore the team', { exact: true })).toHaveCount(1)
    expect(await above()).toBe(true)
    await title.evaluate((one) => one.scrollIntoView({ block: 'start' }))
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-5-stays-above-message.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

/*
 * Two drafts in one turn, as the person's five were: the first planned, the
 * second left with no plan. They steer while the second's plan is on its
 * way; each card keeps its own place above their message, and shows once,
 * through becoming a plan and through saying no plan came.
 */
test('two drafts keep their own places above a message sent between them, one planned and one with no plan', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(home, 'meridian'))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Tasks/ })
      .click()
    const group = page.getByRole('radiogroup', { name: 'When I send while an agent is working' })
    await group.getByRole('radio', { name: 'Steer the agent' }).click()
    await expect(group.getByRole('radio', { name: 'Steer the agent' })).toBeChecked()
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: 'Close Settings' }).click()

    const conversation = page.getByRole('region', { name: 'Conversation' })
    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue|Steer)/ })
    const say = async (words: string) => {
      await box.fill(words)
      await box.press('Enter')
    }
    await say('Explore the team. [coordinator:plan] [coordinator:plan-another-fails] [coordinator:slowly]')
    const first = conversation.getByText('Explore the team', { exact: true })
    const second = conversation.getByText('Explore the team, the rest', { exact: true })
    // Held while drafted, as the person held theirs: it comes as a held plan, and nothing starts.
    await expect(first).toBeVisible()
    await conversation.getByRole('button', { name: 'Hold' }).first().click()
    // The first planned, the second a task with its plan streaming: they say something.
    await expect(second).toBeVisible()
    await expect(conversation).toContainText(/Choosing a (lead|reviewer)/)
    await say('you dont need to split these')
    // The message itself, not the preview of it the conversation shows once it has scrolled.
    const message = conversation.locator('p:not([data-thread-preview])', { hasText: /^you dont need to split these$/ })
    await expect(message).toBeVisible()
    const order = async () => {
      const [a, b, said] = await Promise.all([first.boundingBox(), second.boundingBox(), message.boundingBox()])
      return a !== null && b !== null && said !== null && a.y < b.y && b.y < said.y
    }
    expect(await order()).toBe(true)
    // The second's plan didn't come: it says so, in its place; the first shows its plan, in its own. Each once.
    await expect(conversation.getByText('No plan yet')).toHaveCount(1)
    await expect(conversation.getByRole('button', { name: 'Plan it' })).toHaveCount(1)
    await expect(first).toHaveCount(1)
    await expect(second).toHaveCount(1)
    await expect(conversation.getByRole('button', { name: 'Start', exact: true })).toHaveCount(1)
    expect(await order()).toBe(true)
    await first.evaluate((one) => one.scrollIntoView({ block: 'start' }))
    await still(page)
    await page.screenshot({ path: 'test-results/unplanned-6-two-drafts.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
