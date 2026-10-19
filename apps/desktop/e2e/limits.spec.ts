import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, planTask, projectSettings } from './support'

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
const startWhileOut = async (out: string, { asks = false }: { readonly asks?: boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const planning = await launch(home)
  try {
    await openFirstProject(planning.electronApp, planning.page, repo)
    await expect(planning.page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await planTask(planning.page, 'Add a retry to the checkout call')
    await planning.page.getByRole('button', { name: 'Hold' }).click()
    await expect(planning.page.getByText('Held. Starts when you say')).toBeVisible()
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
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/limit-moved-card.png', animations: 'disabled' })
    await openTask(page)
    await expect(page.getByText(/^Claude Code reached its usage limit, until .+\. Codex takes over\.$/)).toBeVisible()
    await expect(page.getByText(/Checkout retries once when the payment call fails/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-moved.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('waits for the reset where no other agent is free, and says so on its card, the board and the task', async () => {
  const { electronApp, page } = await startWhileOut('claude-code:3600,codex:3600')
  try {
    // Althar learns an agent is out when it tries it: Claude Code first, then Codex, which it waits for.
    await expect(page.getByText(/^Waits for Codex, back at /)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/limit-waits-card.png', animations: 'disabled' })
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(page.getByText(/^Waits for Codex, back at /)).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-waits-board.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Add a retry to the checkout call' }).click()
    await expect(page.getByText(/^Claude Code reached its usage limit, until .+\. Codex takes over\.$/)).toBeVisible()
    await expect(page.getByText(/^Codex reached its usage limit, until .+\. The step waits until then\.$/)).toBeVisible()
    // Its header says so too, rather than that it is idle.
    await expect(page.getByText(/^Waits for Codex, back at /)).toBeVisible()
    await expect(page.getByText('Idle', { exact: true })).toHaveCount(0)
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
    await expect(page.getByText(/^Claude Code reached its usage limit\. Codex takes over\.$/)).toBeVisible()
    await expect(page.getByText("Codex reached its usage limit and didn't say when it resets.")).toBeVisible()
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
    await expect(call.getByText(/^Claude Code reached its usage limit, until .+\.$/)).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-ask-home.png', animations: 'disabled' })
    await call.getByRole('button', { name: 'Open' }).click()

    // In the task: the models free now, and waiting for the reset.
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wait until / })).toBeVisible()
    await page.getByRole('button', { name: 'Choose another model' }).click()
    await expect(page.getByRole('menuitemradio', { name: /via Codex/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-ask.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Continue with/ }).click()
    await expect(page.getByText('Switched from Claude Code to Codex.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Checkout retries once when the payment call fails/).first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await electronApp.close()
  }
})
