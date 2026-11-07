import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say, still } from './support'

/*
 * Clearing the coordinator's chat in a real project, against the real
 * runtime and the fake agent. Clearing the view: the bar's Clear, then Show
 * earlier, Back to now and Undo, and /clear as the fast path to the same
 * question; the task planned meanwhile stays in the view. Forgetting: the
 * context ring's Clear chat…, which opens the question on the warning; the
 * conversation goes and the task stays; the next message is answered by a
 * session that has nothing of the conversation but the project's records.
 * The screenshots it takes are this change's evidence
 * (test-results/clear-chat-*.png).
 */

const ANSWER = 'Looked into it: the payment call has no retry'

const opened = async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const launched = await launch(home)
  await openFirstProject(launched.electronApp, launched.page, repository(projects))
  return launched
}

/** The conversation, with two exchanges in it, a planned task, and a context a third full. */
const talked = async (page: Page) => {
  const conversation = page.getByRole('region', { name: 'Conversation' })
  await say(page, 'Why is checkout slow?')
  await expect(conversation.getByText(ANSWER)).toHaveCount(1)
  await planTask(page, 'Add a retry to checkout')
  await expect(conversation.getByText('Add a retry to checkout', { exact: true })).toBeVisible()
  await say(page, 'And refunds? [context:33]')
  await expect(conversation.getByText(ANSWER)).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Interrupt the coordinator' })).toHaveCount(0)
  return conversation
}

const shoot = async (page: Page, name: string, area: Locator) => {
  await still(page)
  await area.screenshot({ path: `test-results/clear-chat-${name}.png`, animations: 'disabled' })
}

test('clears the view from the bar and /clear, reads the earlier conversation, and undoes it', async () => {
  const { electronApp, page } = await opened()
  try {
    const conversation = await talked(page)
    const bar = page.getByRole('region', { name: 'Coordinator' })
    await shoot(page, 'bar', bar)

    await bar.getByRole('button', { name: 'Clear', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Clear chat' })
    await expect(dialog.getByRole('radio', { name: /Clear only the view/ })).toBeChecked()
    await shoot(page, 'dialog-view', dialog)
    await dialog.getByRole('button', { name: 'Clear the view' }).click()

    // The conversation goes from the view; the task at work stays, under the line that says where it was cleared.
    await expect(page.getByText('Cleared', { exact: true })).toBeVisible()
    await expect(conversation.getByText(ANSWER)).toHaveCount(0)
    await expect(conversation.getByText('Add a retry to checkout', { exact: true })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Clear', exact: true })).toBeFocused()
    await shoot(page, 'cleared', conversation)

    // Nothing was said by the coordinator on its own; its next word answers what it is asked, and shows from the clear.
    await say(page, 'Where were we?')
    await expect(conversation.getByText(ANSWER)).toHaveCount(1)
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(1)

    // The earlier conversation is read in the thread's place.
    await page.getByRole('button', { name: 'Show earlier' }).click()
    await expect(page.getByText('Earlier conversation')).toBeVisible()
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(2)
    await expect(conversation.getByText('Why is checkout slow?')).toBeVisible()
    await shoot(page, 'earlier', conversation)
    await page.getByRole('button', { name: 'Back to now' }).click()
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(1)

    // It is the thread's: a reload of the window reads the same.
    await page.reload()
    await expect(page.getByText('Cleared', { exact: true })).toBeVisible()
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(1)

    // Undo brings the whole thread back.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Cleared', { exact: true })).toHaveCount(0)
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(3)

    // /clear asks the same question, on the same kind, and is not said to the coordinator.
    await say(page, '/clear')
    await expect(dialog.getByRole('radio', { name: /Clear only the view/ })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(3)
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toBeFocused()

    // Cleared again, the view is clear: the question says so and has forgetting ready.
    await bar.getByRole('button', { name: 'Clear', exact: true }).click()
    await dialog.getByRole('button', { name: 'Clear the view' }).click()
    await expect(page.getByText('Cleared', { exact: true })).toBeVisible()
    await bar.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(dialog.getByRole('radio', { name: /Clear only the view\s*The view is already clear\./ })).toBeDisabled()
    await expect(dialog.getByRole('radio', { name: /Forget the conversation too/ })).toBeChecked()
    await shoot(page, 'dialog-already-clear', dialog)
  } finally {
    await electronApp.close()
  }
})

test('forgets the conversation from the context ring, and the next message starts afresh from the project’s records', async () => {
  const { electronApp, page } = await opened()
  try {
    const conversation = await talked(page)

    const ring = page.getByRole('button', { name: /^Context \d+% used$/ })
    await ring.hover()
    const panel = page.getByRole('dialog', { name: 'Context' })
    await expect(panel.getByRole('button', { name: 'Clear chat…' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Compact' })).toBeVisible()
    await shoot(page, 'ring-foot', panel)
    await panel.getByRole('button', { name: 'Clear chat…' }).click()

    // Opened from the ring, the question starts on the warning, and nothing is forgotten until its red button is pressed.
    const dialog = page.getByRole('dialog', { name: 'Clear chat' })
    await expect(dialog.getByRole('radio', { name: /Forget the conversation too/ })).toBeChecked()
    await expect(dialog.getByRole('radio', { name: /Forget the conversation too/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(conversation.getByText(ANSWER)).toHaveCount(2)
    await shoot(page, 'dialog-forget', dialog)
    await dialog.getByRole('button', { name: 'Clear and forget' }).click()

    // The conversation is gone, the task stays, and the thread says where the fresh session begins.
    await expect(page.getByText('Fresh session', { exact: true })).toBeVisible()
    await expect(conversation.getByText(ANSWER)).toHaveCount(0)
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(0)
    await expect(conversation.getByText('Add a retry to checkout', { exact: true })).toBeVisible()
    await expect(ring).toHaveCount(0)
    await shoot(page, 'forgotten', conversation)

    // It is gone for good: a reload reads the same, and Undo is nowhere to be found.
    await page.reload()
    await expect(page.getByText('Fresh session', { exact: true })).toBeVisible()
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)

    // The next message is answered by a session of its own: the coordinator says nothing before it.
    await say(page, 'Where were we?')
    await expect(conversation.getByText(ANSWER)).toHaveCount(1)
    await expect(conversation.getByRole('article', { name: /^You/ })).toHaveCount(1)
    await expect(page.getByText('Fresh session', { exact: true })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
