import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, toConversation } from './support'

/*
 * Between sending and the first word back, in a real window with the fake
 * agent slow to answer (`[answers-after:6s]`): the reply's name, thinking
 * where its words will start, then how long; then its words in that very
 * place, nothing above them moved. In the coordinator's thread and a task's,
 * and where the agent gives up instead (`[fails-after:4s]`). What the person
 * sent never reads as queued, with nothing to wait behind. The screenshots
 * it takes are this change's own evidence (test-results/first-word-*.png).
 */

/** Where something's top stands in the window, to the pixel. */
const top = (locator: Locator) => locator.evaluate((element) => Math.round(element.getBoundingClientRect().top))

/** The person's last message and what follows it, at 1×. */
const shoot = async (page: Page, thread: Locator, name: string) => {
  const from = await thread.getByRole('article', { name: /^You/ }).last().boundingBox()
  const to = await thread.getByRole('article').last().boundingBox()
  if (from === null || to === null) throw new Error('Nothing to shoot')
  const x = Math.min(from.x, to.x) - 20
  const right = Math.max(from.x + from.width, to.x + to.width) + 20
  const clip = { x, y: from.y - 16, width: right - x, height: to.y + to.height + 20 - (from.y - 16) }
  await page.screenshot({ path: `test-results/first-word-${name}.png`, clip, scale: 'css', animations: 'disabled' })
}

/** From now on, whether anything in the window says Queued. */
const watchQueued = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { queuedSeen: boolean }
    seen.queuedSeen = false
    new MutationObserver(() => {
      if (document.body.innerText.includes('Queued')) seen.queuedSeen = true
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
const queuedSeen = (page: Page) => page.evaluate(() => (window as unknown as { queuedSeen: boolean }).queuedSeen)

/** Sends, and follows the reply from its first sign to its first words, which must take its place. */
const answered = async (page: Page, thread: Locator, words: string, name: string) => {
  await watchQueued(page)
  await say(page, `${words} [answers-after:6s]`)
  const thinking = thread.getByRole('status').filter({ hasText: 'Thinking' })
  await expect(thinking).toBeVisible()
  // Its beat, then its fade.
  await page.waitForTimeout(700)
  await shoot(page, thread, `${name}-thinking`)
  // How long, once that's worth saying.
  await expect(thinking).toContainText(/Thinking\s*[3-5]s/, { timeout: 5_000 })
  await shoot(page, thread, `${name}-counted`)
  const reply = thread.getByRole('article').last()
  const before = { name: await top(reply.locator('header')), line: await top(thinking) }
  const said = thread.getByText('Looked into it: the payment call has no retry')
  await expect(said).toBeVisible({ timeout: 10_000 })
  await expect(thinking).toHaveCount(0)
  // The name stays where it stood, and the words start where Thinking was.
  expect(await top(thread.getByRole('article').last().locator('header'))).toBe(before.name)
  expect(await top(said)).toBe(before.line)
  await page.waitForTimeout(300)
  await shoot(page, thread, `${name}-words`)
  expect(await queuedSeen(page)).toBe(false)
}

test('holds the reply’s place, thinking, until its first words take it: in the coordinator’s thread and a task’s', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await answered(page, conversation, 'Why is checkout slow?', 'coordinator')

    // Where the agent gives up, what it said takes Thinking's place, under the same name.
    await say(page, 'And refunds? [fails-after:4s]')
    await expect(conversation.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible()
    await expect(conversation.getByText(/couldn't answer/)).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByRole('status').filter({ hasText: 'Thinking' })).toHaveCount(0)
    await page.waitForTimeout(300)
    await shoot(page, conversation, 'coordinator-failed')

    // A task's lead, asked again once it's done.
    await startTask(page, 'Add a retry to checkout')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await answered(page, page.getByRole('region', { name: 'Thread' }), 'Why does the retry wait a second?', 'task')
  } finally {
    await electronApp.close()
  }
})
