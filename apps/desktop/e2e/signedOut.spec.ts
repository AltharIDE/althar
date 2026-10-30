import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, still, toConversation } from './support'

/*
 * A signed-out agent's error, in a real window with the fake agent
 * (`[signed-out]`, `[lead:signed-out]`): it says so plainly, and Sign in
 * again opens Settings on that agent, its sign-in started; back on the
 * project, Try again gives the turn what the person said again. A plan
 * step whose lead is signed out asks at once, with Sign in again first. The
 * screenshots it takes are this change's own evidence
 * (test-results/signed-out-*.png).
 */

/** One element, at 1×. */
const shoot = (target: Locator, name: string) =>
  target.screenshot({ path: `test-results/signed-out-${name}.png`, scale: 'css', animations: 'disabled' })

/** The person's last message and what follows it, at 1×. */
const shootTurn = async (page: Page, thread: Locator, name: string) => {
  const from = await thread.getByRole('article', { name: /^You/ }).last().boundingBox()
  const to = await thread.getByRole('article').last().boundingBox()
  if (from === null || to === null) throw new Error('Nothing to shoot')
  const x = Math.min(from.x, to.x) - 20
  const right = Math.max(from.x + from.width, to.x + to.width) + 20
  const clip = { x, y: from.y - 16, width: right - x, height: to.y + to.height + 20 - (from.y - 16) }
  await page.screenshot({ path: `test-results/signed-out-${name}.png`, clip, scale: 'css', animations: 'disabled' })
}

const opened = async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const launched = await launch(home)
  await openFirstProject(launched.electronApp, launched.page, repository(projects))
  return launched
}

test('a signed-out coordinator leads to its sign-in in Settings, and back to trying again', async () => {
  const { electronApp, page } = await opened()
  try {
    const conversation = page.getByRole('region', { name: 'Conversation' })
    await say(page, 'Why is checkout slow? [signed-out]')
    await expect(conversation.getByText(/is signed out\./)).toBeVisible()
    await still(page)
    await shootTurn(page, conversation, 'coordinator')

    await conversation.getByRole('button', { name: 'Sign in again' }).click()
    // Settings, on the agent, its sign-in started where its account is.
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    const accounts = page.getByRole('list', { name: /accounts$/ })
    await expect(accounts.getByRole('button', { name: 'Cancel signing in' })).toBeVisible()
    await still(page)
    await shoot(page.getByRole('tabpanel', { name: /Claude Code/ }), 'settings')

    // Back on the project, where it was, Try again sends what the person said again.
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /meridian/ })
      .first()
      .click()
    await conversation.getByRole('button', { name: 'Try again' }).click()
    // Still signed out here, the fake agent fails the turn again: it went again, with what the person said, and the first try
    // folds into the turn's work.
    await expect(conversation.getByText(/^Worked for/)).toBeVisible()
    await expect(conversation.getByRole('button', { name: 'Sign in again' })).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('a step whose lead is signed out asks at once, with Sign in again first', async () => {
  const { electronApp, page } = await opened()
  try {
    await startTask(page, 'Fix the heading', '[lead:signed-out]')
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    const thread = page.getByRole('region', { name: 'Thread' })
    const call = thread.getByRole('button', { name: 'Sign in again' })
    await expect(call).toBeVisible()
    // Signed out, its lead can't be told anything.
    await expect(thread.getByRole('button', { name: 'Tell the lead' })).toHaveCount(0)
    await still(page)
    // Down to the call's own buttons, under the round, across the thread.
    const from = await thread.getByRole('article', { name: /^You/ }).last().boundingBox()
    const across = await thread.boundingBox()
    const to = await call.boundingBox()
    if (from === null || across === null || to === null) throw new Error('Nothing to shoot')
    const clip = { x: across.x, y: from.y - 16, width: across.width + 40, height: to.y + to.height + 28 - (from.y - 16) }
    await page.screenshot({ path: 'test-results/signed-out-step.png', clip, scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
