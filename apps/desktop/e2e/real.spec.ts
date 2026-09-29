import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'

/*
 * The app with a real agent, as a process started from the runtime's utility
 * process: the path the fake agent, which runs in the runtime's own process,
 * never takes. It uses the agent's own sign-in on this machine, so it runs
 * only when asked: CHARRETTE_REAL_AGENT=claude-code (or codex).
 */

const agent = process.env.CHARRETTE_REAL_AGENT
const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

test.skip(agent === undefined, 'Set CHARRETTE_REAL_AGENT to run it against a real agent')

test('a real agent leads a task and answers', async () => {
  test.setTimeout(180_000)
  const name = names[agent ?? ''] ?? agent ?? ''
  const home = mkdtempSync(join(tmpdir(), 'charrette-real-'))
  const repo = repository(home)
  const { CHARRETTE_FAKE_AGENTS: _, ...env } = process.env
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: { ...env, CHARRETTE_PROFILE: join(home, 'profile'), CHARRETTE_WORKTREES: join(home, 'worktrees') },
  })
  try {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
    }, repo)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await page.getByLabel('What should change').fill('Say hello')
    await page
      .getByLabel('Anything the lead should know')
      .fill('Reply with the single word "ready" and nothing else. Do not run any tools.')
    await page.getByRole('combobox', { name: 'Lead' }).click()
    await page.getByRole('option', { name }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()
    await expect(page.getByRole('heading', { name: 'Say hello', level: 1 })).toBeVisible()
    await expect(page.getByText(/^ready\.?$/i)).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('Idle', { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `test-results/real-${agent}.png` })
  } finally {
    await app.close()
  }
})
