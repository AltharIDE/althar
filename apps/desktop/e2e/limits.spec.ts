import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * An agent out of usage, as the person sees it. The fake agents are out as
 * ALTHAR_FAKE_OUT says: for an hour, with the reset in their error, or
 * for good, saying none. The project moves work on, as projects do unless
 * told to wait.
 */

/** Opens a project and starts a task led by Claude Code, without a review, whose lead reports at once. */
const startTask = async (out: string) => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_OUT: out })
  await chooseFolder(electronApp, repo)
  await page.getByRole('button', { name: /Open a folder/ }).click()
  await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByLabel('What should change').fill('Add a retry to the checkout call')
  await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
  await page.getByRole('button', { name: /^Review:/ }).click()
  await page.getByRole('button', { name: 'No review' }).click()
  await page.getByRole('button', { name: 'Start the task' }).click()
  return { electronApp, page }
}

const openTask = async (page: Page) => {
  // A task that needs the person is answered from its card.
  await page.getByRole('button', { name: /^(Open task|Answer)/ }).click()
  await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
}

test('hands the task to the next free agent when its lead is out of usage', async () => {
  const { electronApp, page } = await startTask('claude-code:3600')
  try {
    // Codex took the step over and finished it.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/limit-moved-card.png', animations: 'disabled' })
    await openTask(page)
    await expect(page.getByText(/^Claude Code reached its usage limit, until .+\. Codex takes over\.$/)).toBeVisible()
    await expect(page.getByText('Did the task.')).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-moved.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})

test('waits for the reset where no other agent is free, and says so on its card, the board and the task', async () => {
  const { electronApp, page } = await startTask('claude-code:3600,codex:3600')
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
  const { electronApp, page } = await startTask('claude-code,codex')
  try {
    await expect(page.getByText('Needs you', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await openTask(page)
    await expect(page.getByText(/^Claude Code reached its usage limit\. Codex takes over\.$/)).toBeVisible()
    await expect(page.getByText("Codex reached its usage limit and didn't say when it resets.")).toBeVisible()
    // Telling an agent that is out anything would hit the same limit: it is handed on, or tried again.
    await expect(page.getByRole('button', { name: 'Tell the lead' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try another agent' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try Codex again' })).toBeVisible()
    await page.screenshot({ path: 'test-results/limit-call.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
