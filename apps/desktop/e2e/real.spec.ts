import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'

/*
 * The app with a real agent, as a process started from the runtime's utility
 * process: the path the fake agent, which runs in the runtime's own process,
 * never takes. It uses the agent's own sign-in on this machine, so it runs
 * only when asked: ALTHAR_REAL_AGENT=claude-code (or codex).
 */

const agent = process.env.ALTHAR_REAL_AGENT
const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

test.skip(agent === undefined, 'Set ALTHAR_REAL_AGENT to run it against a real agent')

test('a real agent leads a task and answers', async () => {
  test.setTimeout(180_000)
  const name = names[agent ?? ''] ?? agent ?? ''
  const home = mkdtempSync(join(tmpdir(), 'althar-real-'))
  const repo = repository(home)
  const { ALTHAR_FAKE_AGENTS: _, ...env } = process.env
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: { ...env, ALTHAR_PROFILE: join(home, 'profile'), ALTHAR_WORKTREES: join(home, 'worktrees') },
  })
  try {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
    }, repo)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Say hello')
    await page
      .getByLabel('Anything the lead should know')
      .fill('Reply with the single word "ready" and nothing else. Do not run any tools.')
    // The agent's first model, from every model, by agent.
    await page.getByRole('button', { name: /^Lead:/ }).click()
    await page.getByRole('button', { name: /All models/ }).click()
    const models = page.getByRole('dialog')
    await models.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
    await models.getByRole('button', { name: /^Use / }).first().click()
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Say hello', level: 1 })).toBeVisible()
    await expect(page.getByText(/^ready\.?$/i)).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('Idle', { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `test-results/real-${agent}.png` })
  } finally {
    await app.close()
  }
})
