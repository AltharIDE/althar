import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { _electron as electron, expect, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { mainWindow, say } from './support'

/*
 * The app with a real agent, as a process started from the runtime's utility
 * process: the path the fake agent, which runs in the runtime's own process,
 * never takes. The agent coordinates, told in plain words what to plan, and
 * leads the task it planned. It uses the agent's own sign-in on this
 * machine, so it runs only when asked: ALTHAR_REAL_AGENT=claude-code (or
 * codex).
 */

const agent = process.env.ALTHAR_REAL_AGENT
const names: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

test.skip(agent === undefined, 'Set ALTHAR_REAL_AGENT to run it against a real agent')

/** The agent's first model, from every model, by agent, in the picker whose button `picker` names. */
const firstModelOf = async (page: Page, picker: RegExp, name: string) => {
  await page.getByRole('button', { name: picker }).click()
  await page.getByRole('button', { name: /All models/ }).click()
  const models = page.getByRole('dialog')
  await models.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
  await models.getByRole('button', { name: /^Use / }).first().click()
}

test('a real agent plans a task, leads it and answers', async () => {
  test.setTimeout(300_000)
  const name = names[agent ?? ''] ?? agent ?? ''
  const home = mkdtempSync(join(tmpdir(), 'althar-real-'))
  const repo = repository(home)
  const { ALTHAR_FAKE_AGENTS: _, ...env } = process.env
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: {
      ...env,
      ALTHAR_PROFILE: join(home, 'profile'),
      ALTHAR_WORKTREES: join(home, 'worktrees'),
      ALTHAR_CODE_HOME: home,
      ALTHAR_QUIT_WITHOUT_ASKING: '1',
    },
  })
  try {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as typeof dialog.showOpenDialog
    }, repo)
    const page = await mainWindow(app)
    await page.getByRole('button', { name: /Add a folder/ }).click()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The coordinator on the agent, from the composer, told in plain words what to plan.
    await firstModelOf(page, /^Coordinator:/, name)
    await say(
      page,
      'Plan a task titled "Say hello", with no review. Its lead should reply with the single word "ready" and nothing else, and not run any tools or change any files.',
    )

    // Its plan, held to be looked at: led by the same agent, and with no review, should the coordinator have planned one.
    await page.getByRole('button', { name: 'Hold' }).click({ timeout: 120_000 })
    await firstModelOf(page, /^Lead for this task:/, name)
    const skip = page.getByRole('button', { name: 'Skip', exact: true })
    if ((await skip.count()) > 0) await skip.first().click()
    await page.getByRole('button', { name: 'Start', exact: true }).click()

    await page.getByRole('button', { name: /Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Say hello', level: 1 })).toBeVisible()
    await expect(page.getByText(/^ready\.?$/i)).toBeVisible({ timeout: 120_000 })
    // Its lead has finished: the task waits on the person.
    await expect(page.getByText('Ready to accept', { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `test-results/real-${agent}.png` })

    // The plan's windows, read just now: the peek says no age, and Claude Code's are what its own sessions said, not the usage endpoint's.
    await page.getByRole('button', { name: /^Plan usage/ }).click()
    const peek = page.getByRole('dialog', { name: 'Plan usage' })
    await peek.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    await expect(peek.getByText(/^read /)).toHaveCount(0)
    await peek.screenshot({ path: `test-results/real-${agent}-plan.png`, scale: 'css' })
  } finally {
    await app.close()
  }
  // The store, once the app has let go of it.
  if (agent === 'claude-code') {
    const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
    try {
      expect(store.prepare(`SELECT source FROM plan_usage_readings WHERE agent_id = 'claude-code'`).get()).toMatchObject({
        source: 'acp_extension',
      })
    } finally {
      store.close()
    }
  }
})
