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
 * place, nothing above them moved. In the coordinator's thread and a task's;
 * where a thought or a call comes first (`[thinks-after:4s]`,
 * `[reads-after:4s]`), and where the agent gives up instead
 * (`[fails-after:4s]`); where its turn ends with nothing said, interrupted
 * or done (`[ends-after:3s]`), Thinking goes. While the agent starts for what the person sent
 * (ALTHAR_FAKE_SLOW_START), it thinks just the same. After 30 seconds it
 * says it's longer than usual, still where motion is reduced. What the
 * person sent never reads as queued, with nothing to wait behind; sent while
 * it thinks, it waits in the composer's queue, with no Thinking of its own.
 * The screenshots it takes are this change's own evidence
 * (test-results/first-word-*.png).
 */

/**
 * Where the reply's name and the first thing under it stand, to the pixel,
 * from the top of the person's message above them: read at once, as the
 * thread scrolling to follow what is written moves all three alike.
 */
const placeOf = (thread: Locator) =>
  thread.evaluate((region) => {
    const articles = [...region.querySelectorAll('article')]
    const from = articles.findLast((article) => article.getAttribute('aria-label')?.startsWith('You') === true)?.getBoundingClientRect().top
    const name = articles.at(-1)?.querySelector('header')
    const first = name?.nextElementSibling
    if (from === undefined || name == null || first == null) throw new Error('No reply to place')
    return { name: Math.round(name.getBoundingClientRect().top - from), first: Math.round(first.getBoundingClientRect().top - from) }
  })

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

/** From now on, frame by frame, whatever the window shows saying Queued: when, where, and what. */
const watchQueued = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { queuedSeen: Array<string>; queuedWatch?: number }
    if (seen.queuedWatch !== undefined) cancelAnimationFrame(seen.queuedWatch)
    seen.queuedSeen = []
    const from = performance.now()
    const shown = (element: Element | null) => {
      for (let at = element; at !== null; at = at.parentElement) if (Number(getComputedStyle(at).opacity) === 0) return false
      return element !== null && element.getClientRects().length > 0
    }
    const look = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.includes('Queued') !== true || !shown(node.parentElement)) continue
        const where = node.parentElement?.closest('[aria-label]')?.getAttribute('aria-label') ?? ''
        seen.queuedSeen.push(`${Math.round(performance.now() - from)}ms ${where}: ${node.textContent}`)
      }
      seen.queuedWatch = requestAnimationFrame(look)
    }
    look()
  })
const queuedSeen = (page: Page) => page.evaluate(() => (window as unknown as { queuedSeen: Array<string> }).queuedSeen)

/** What the agent is thinking where its reply will start. */
const thinkingIn = (thread: Locator) => thread.getByRole('status').filter({ hasText: 'Thinking' })

/** The animations running on something and in it, by name: none, where motion is reduced. */
const moving = (locator: Locator) =>
  locator.evaluate((element) =>
    element
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running')
      .map((animation) => (animation instanceof CSSAnimation ? animation.animationName : 'animation')),
  )

/** The words the fake agent answers with, after its wait. */
const ANSWER = 'Looked into it: the payment call has no retry'

/**
 * Sends, and follows the reply from its first sign to the first thing it
 * shows, which must take its place: its words, or a thought or a call ahead
 * of them, under the name that stood there, starting where Thinking did.
 */
const handedOff = async (page: Page, thread: Locator, words: string, name: string, first: 'words' | 'other' = 'words') => {
  await watchQueued(page)
  await say(page, words)
  const thinking = thinkingIn(thread)
  await expect(thinking).toBeVisible()
  // Its beat, then its fade.
  await page.waitForTimeout(700)
  await shoot(page, thread, `${name}-thinking`)
  // How long, once that's worth saying.
  await expect(thinking).toContainText(/Thinking\s*[3-5]s/, { timeout: 6_000 })
  await shoot(page, thread, `${name}-counted`)
  const before = await placeOf(thread)
  await expect(thinking).toHaveCount(0, { timeout: 10_000 })
  // The name stays where it stood, and what it shows first starts where Thinking was: its words, or a thought or a call.
  expect(await placeOf(thread)).toEqual(before)
  if (first === 'words') await expect(thread.getByRole('article').last().locator('header + *')).toContainText(ANSWER)
  await page.waitForTimeout(300)
  await shoot(page, thread, `${name}-${first === 'words' ? 'words' : 'first'}`)
  expect(await queuedSeen(page)).toEqual([])
}

/**
 * Interrupted before its first word, then done without one: each time
 * Thinking goes, stays gone with nothing running, and the composer takes
 * a new message rather than adding to a queue.
 */
const endsQuietly = async (page: Page, thread: Locator, name: string) => {
  const thinking = thinkingIn(thread)
  const idle = page.getByRole('textbox', { name: /^Tell .* something/ })
  await say(page, 'Why is checkout slow? [answers-after:20s]')
  await expect(thinking).toBeVisible()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: /^Interrupt the/ }).click()
  await expect(thinking).toHaveCount(0, { timeout: 5_000 })
  await expect(idle).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(thinking).toHaveCount(0)
  await shoot(page, thread, `${name}-interrupted`)
  await say(page, 'And refunds? [ends-after:3s]')
  await expect(thinking).toBeVisible()
  await expect(thinking).toHaveCount(0, { timeout: 8_000 })
  await expect(idle).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(thinking).toHaveCount(0)
  await shoot(page, thread, `${name}-ended-empty`)
}

/** A task's lead, done: its thread, open on its conversation. */
const readyTask = async (page: Page) => {
  await startTask(page, 'Add a retry to checkout')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Open task/ }).click()
  await toConversation(page)
  return page.getByRole('region', { name: 'Thread' })
}

const opened = async (env: Record<string, string> = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const launched = await launch(home, env)
  await openFirstProject(launched.electronApp, launched.page, repository(projects))
  return launched
}

test('holds the reply’s place, thinking, until its first words take it: in the coordinator’s thread and a task’s', async () => {
  test.setTimeout(120_000)
  const { electronApp, page } = await opened()
  try {
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await handedOff(page, conversation, 'Why is checkout slow? [answers-after:6s]', 'coordinator')
    // A thought ahead of its words takes Thinking's place the same way.
    await handedOff(page, conversation, 'What does it do on a timeout? [thinks-after:4s]', 'coordinator-thought', 'other')
    await expect(conversation.getByRole('article').last()).toContainText(ANSWER, { timeout: 10_000 })

    // Where the agent gives up, what it said takes Thinking's place, under the same name.
    await say(page, 'And refunds? [fails-after:4s]')
    await expect(thinkingIn(conversation)).toBeVisible()
    await expect(conversation.getByText(/couldn't answer/)).toBeVisible({ timeout: 10_000 })
    await expect(thinkingIn(conversation)).toHaveCount(0)
    await page.waitForTimeout(300)
    await shoot(page, conversation, 'coordinator-failed')

    // Sent while it thinks, a message waits its turn in the composer's queue, where it can be changed: nothing thinks about it
    // yet, and the thread goes on thinking about the one before. Then it is read, and thought about, in turn.
    await say(page, 'And the docs? [answers-after:5s]')
    const thinking = thinkingIn(conversation)
    await expect(thinking).toBeVisible()
    await say(page, 'Then the changelog. [answers-after:1s]')
    const queue = page.getByRole('region', { name: 'Queued; the coordinator reads it next' })
    await expect(queue).toBeVisible()
    await expect(queue).toContainText('Then the changelog.')
    await expect(thinking).toHaveCount(1)
    await page.waitForTimeout(700)
    const from = await conversation.getByRole('article', { name: /^You/ }).last().boundingBox()
    const to = await queue.boundingBox()
    if (from === null || to === null) throw new Error('Nothing to shoot')
    const clip = { x: to.x - 20, y: from.y - 16, width: to.width + 40, height: to.y + to.height + 16 - (from.y - 16) }
    await page.screenshot({ path: 'test-results/first-word-coordinator-queued.png', clip, scale: 'css', animations: 'disabled' })
    await expect(queue).toHaveCount(0, { timeout: 10_000 })
    await expect(conversation.getByRole('article', { name: /^You/ }).last()).toContainText('Then the changelog.')
    await expect(conversation.getByText(ANSWER)).toHaveCount(3, { timeout: 10_000 })

    // A task's lead, asked again once it's done; and with a call ahead of its words.
    const thread = await readyTask(page)
    await handedOff(page, thread, 'Why does the retry wait a second? [answers-after:6s]', 'task')
    await handedOff(page, thread, 'Where does it give up? [reads-after:4s]', 'task-call', 'other')
    await expect(thread.getByRole('article').last()).toContainText(ANSWER, { timeout: 10_000 })
  } finally {
    await electronApp.close()
  }
})

test('thinks while the agent starts for what was said: the coordinator’s first, and a stopped task’s lead asked again', async () => {
  test.setTimeout(120_000)
  // Each agent takes four seconds to start a session, then a second to answer: the start is most of the wait.
  const { electronApp, page } = await opened({ ALTHAR_FAKE_SLOW_START: '4000' })
  try {
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await handedOff(page, conversation, 'Why is checkout slow? [answers-after:1s]', 'start-coordinator')

    await startTask(page, 'Keep the session alive', '[lead:wait]')
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByText('Implementing', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'More for this task' }).click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /Stop the task/ })
      .click()
    await expect(page.getByText('Stopped', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // Asked again, the stopped lead starts afresh to read it, and thinks all the while; its step goes on, its work first.
    await handedOff(page, page.getByRole('region', { name: 'Thread' }), 'Why does it wait? [answers-after:1s]', 'start-task', 'other')
  } finally {
    await electronApp.close()
  }
})

test('says it’s longer than usual after 30 seconds, and keeps still where motion is reduced: in a task’s thread and the coordinator’s', async () => {
  test.setTimeout(120_000)
  const { electronApp, page } = await opened()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const thread = await readyTask(page)
    await say(page, 'Why does the retry wait a second? [answers-after:45s]')
    await expect(thinkingIn(thread)).toBeVisible()

    // While the lead thinks on, the coordinator is asked too.
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await expect(conversation).toBeVisible()
    await say(page, 'Why is checkout slow? [answers-after:36s]')
    const thinking = thinkingIn(conversation)
    await expect(thinking).toContainText(/Thinking\s*3\d+s\s*longer than usual/, { timeout: 40_000 })
    expect(await moving(thinking)).toEqual([])
    await shoot(page, conversation, 'slow-coordinator')

    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await expect(thinkingIn(thread)).toContainText(/Thinking\s*3\d+s\s*longer than usual/)
    // Drawn again, it shows after its beat.
    await page.waitForTimeout(700)
    expect(await moving(thinkingIn(thread))).toEqual([])
    await shoot(page, thread, 'slow-task')

    // Where motion isn't reduced, the label shimmers on.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await moving(thinkingIn(thread))).not.toEqual([])
  } finally {
    await electronApp.close()
  }
})

test('lets go of Thinking when the turn ends with nothing said, interrupted or done: in the coordinator’s thread and a task’s', async () => {
  test.setTimeout(120_000)
  const { electronApp, page } = await opened()
  try {
    await endsQuietly(page, page.getByRole('region', { name: 'Conversation' }), 'coordinator')
    await endsQuietly(page, await readyTask(page), 'task')
  } finally {
    await electronApp.close()
  }
})
