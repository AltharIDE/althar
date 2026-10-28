import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, planTask, projectSettings, shown } from './support'

/*
 * An agent out of usage, as the person sees it. The fake agents are out as
 * ALTHAR_FAKE_OUT says: for an hour, with the reset in their error, or
 * for good, saying none. The project moves work on, as projects do unless
 * told to wait, or to ask.
 */

/**
 * Opens a project, set to ask about usage limits where given, and starts a
 * task led by Claude Code, without a review, whose lead reports at once,
 * with the agents out as `out` says. The coordinator that plans it runs on
 * an agent too: out of usage, it would move on, or wait, itself, and Althar
 * would know an agent is out before the task's lead tried it; with every
 * agent out, it couldn't plan at all. So it plans the task while they all
 * have usage, and the plan is held; Althar opened again with them out, the
 * person starts it.
 */
const startWhileOut = async (out: string, { asks = false, waits = false }: { readonly asks?: boolean; readonly waits?: boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const planning = await launch(home)
  try {
    await openFirstProject(planning.electronApp, planning.page, repo)
    await expect(planning.page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await planTask(planning.page, 'Add a retry to the checkout call')
    await planning.page.getByRole('button', { name: 'Hold' }).click()
    await expect(planning.page.getByRole('region', { name: 'Conversation' }).getByText('Held. Starts when you say')).toBeVisible()
  } finally {
    await planning.electronApp.close()
  }
  // Opened again on the home: its tab goes back to the project, where the plan waits.
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_OUT: out })
  await page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('button', { name: /^meridian/ })
    .click()
  await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
  if (waits) {
    await projectSettings(page, 'Rules')
    await page.getByRole('button', { name: 'moves to the next agent free', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Wait for the reset' }).click()
    await expect(page.getByRole('listitem', { name: 'Limits' })).toContainText('When an account runs out, the work waits for the reset')
    await backToWork(page)
  }
  if (asks) {
    await projectSettings(page, 'Rules')
    await page.getByRole('button', { name: 'moves to the next agent free', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Ask me' }).click()
    const limits = page.getByRole('listitem', { name: 'Limits' })
    await expect(limits).toContainText(
      'When an account runs out, the work waits for you to move it to a model that’s free, or to wait for the reset.',
    )
    await limits.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/limit-ask-rules.png', animations: 'disabled' })
    await backToWork(page)
  }
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  return { electronApp, page }
}

const openTask = async (page: Page) => {
  // A task that needs the person is answered from its card.
  await page.getByRole('button', { name: /^(Open task|Answer)/ }).click()
  await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
}

test('hands the task to the next free agent when its lead is out of usage', async () => {
  const { electronApp, page } = await startWhileOut('claude-code:3600')
  try {
    // Codex took the step over and finished it.
    await expect(shown(page, 'Ready', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/limit-moved-card.png', animations: 'disabled' })
    await openTask(page)
    await expect(
      shown(page, /^Claude Code ran out of usage while working on the task, until .+\. Codex takes the work over(, on .+)?\.$/),
    ).toBeVisible()
    await expect(shown(page, /Checkout retries once when the payment call fails/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-moved.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('waits for the reset where no other agent is free, and says so on its card, the board and the task', async () => {
  const { electronApp, page } = await startWhileOut('claude-code:3600,codex:3600')
  try {
    // Althar learns an agent is out when it tries it: Claude Code first, then Codex, which it waits for.
    const held = /Codex is out of usage until /
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText(held)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/limit-waits-card.png', animations: 'disabled' })
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(page.getByRole('region', { name: 'The project’s work' }).getByText(held)).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-waits-board.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await expect(
      shown(page, /^Claude Code ran out of usage while working on the task, until .+\. Codex takes the work over(, on .+)?\.$/),
    ).toBeVisible()
    // It moves work on, but nothing else was free: it says so, and that the person can pick another model.
    await expect(
      shown(
        page,
        /^Codex ran out of usage while working on the task\. No other model was free, so the work waits until .+, when Codex is back\. Pick one on the task to carry on now\.$/,
      ),
    ).toBeVisible()
    // Its header says so too, rather than that it is idle.
    await expect(shown(page, held)).toBeVisible()
    await expect(shown(page, 'Idle', { exact: true })).toHaveCount(0)
    // And the task offers what could carry it on, though nothing is free now.
    await expect(
      shown(
        page,
        /^Codex ran out of usage while working on the task\. No other model was free, so the work waits until .+, when it's back\./,
      ),
    ).toBeVisible()
    await expect(page.getByText('No other model is free now.')).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-waits.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('asks the person when the reset isn’t known and no other agent is free', async () => {
  const { electronApp, page } = await startWhileOut('claude-code,codex')
  try {
    await expect(page.getByText('Needs you', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await openTask(page)
    await expect(
      page.getByText(/^Claude Code ran out of usage while working on the task\. Codex takes the work over(, on .+)?\.$/),
    ).toBeVisible()
    await expect(
      page.getByText(
        "Codex ran out of usage while working on the task and didn't say when it's back. Pick another model to carry on, or try Codex again.",
      ),
    ).toBeVisible()
    // Telling an agent that is out anything would hit the same limit. Claude Code ran out first, and nothing else is free: it is tried again.
    await expect(page.getByText('Out of usage', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tell the lead' })).toHaveCount(0)
    await expect(page.getByText('No other model is free now.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Continue with/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try Codex again' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wait until/ })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/limit-call.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('asks the person where the project says to, on the home too, and moves the step to the model they pick', async () => {
  const { electronApp, page } = await startWhileOut('claude-code:3600', { asks: true })
  try {
    await expect(page.getByText('Needs you', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    // The home lists it, for a person who is elsewhere.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    const call = page.getByRole('article', { name: 'Add a retry to the checkout call' })
    await expect(call.getByText('Out of usage', { exact: true })).toBeVisible()
    await expect(call.getByText(/^Claude Code ran out of usage while working on the task\. It's back at .+\./)).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-ask-home.png', animations: 'disabled' })
    await call.getByRole('button', { name: 'Open' }).click()

    // In the task: the models free now, and waiting for the reset.
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wait until / })).toBeVisible()
    await shown(
      page,
      /^Claude Code ran out of usage while working on the task\. It's back at .+\. Pick another model to carry on now, or wait until then\.$/,
    )
      .locator('xpath=ancestor::div[1]')
      .screenshot({ path: 'test-results/limit-ask-call.png', scale: 'css' })
    await page.getByRole('button', { name: 'Choose another model' }).click()
    await expect(page.getByRole('menuitemradio', { name: /via Codex/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-ask.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Continue with/ }).click()
    await expect(shown(page, 'Switched from Claude Code to Codex.')).toBeVisible({ timeout: 15_000 })
    await expect(shown(page, /Checkout retries once when the payment call fails/).first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await electronApp.close()
  }
})

test('lets the person hand a step held for the reset to another model, from the task', async () => {
  const { electronApp, page } = await startWhileOut('claude-code:3600', { waits: true })
  try {
    // The project waits for resets: the step is held, and its card says what ran out, on which step, and until when.
    const held = /Claude Code is out of usage until /
    await expect(page.getByRole('region', { name: 'Conversation' }).getByText(held)).toBeVisible({ timeout: 15_000 })
    await page
      .getByRole('article', { name: /Add a retry to the checkout call/ })
      .first()
      .screenshot({ path: 'test-results/limit-held-card.png', scale: 'css' })
    await page.getByRole('button', { name: /^Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
    await expect(shown(page, held)).toBeVisible()
    await page
      .locator('header[aria-label="Add a retry to the checkout call"]')
      .screenshot({ path: 'test-results/limit-held-header.png', scale: 'css' })
    // The thread says it, and offers the models that could carry it on now, though nothing waits on the person.
    await expect(
      shown(
        page,
        /^Claude Code ran out of usage while working on the task\. The work waits until .+, when Claude Code is back\. To carry on now, pick another model on the task\.$/,
      ),
    ).toBeVisible()
    const offer = shown(
      page,
      /^Claude Code ran out of usage while working on the task\. This project waits for usage to reset, so the work waits until /,
    )
    await expect(offer).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wait until / })).toBeVisible()
    await offer.locator('xpath=ancestor::div[1]').screenshot({ path: 'test-results/limit-held-offer.png', scale: 'css' })
    await page.getByRole('button', { name: 'Choose another model' }).click()
    await expect(page.getByRole('menuitemradio', { name: /via Codex/ })).toBeVisible()
    await page.keyboard.press('Escape')
    // Kept waiting, it folds, and still opens again to move it on after all.
    await page.getByRole('button', { name: /^Wait until / }).click()
    const waiting = shown(page, /^Waiting until /)
    await expect(waiting).toBeVisible()
    await waiting.locator('xpath=..').screenshot({ path: 'test-results/limit-held-waiting.png', scale: 'css' })
    await page.getByRole('button', { name: 'Pick another model' }).click()
    await page.getByRole('button', { name: /^Continue with/ }).click()
    // Handed to Codex, it carries on there now, and the reset brings nothing back.
    await expect(shown(page, /Checkout retries once when the payment call fails/).first()).toBeVisible({ timeout: 15_000 })
    await expect(shown(page, held)).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
