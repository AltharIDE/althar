import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask } from './support'

/*
 * Several accounts per agent (ADR-012), as the person sees them: added in
 * Settings, signed in and named in the list. Claude Code's usual account
 * is out for an hour here (ALTHAR_FAKE_OUT); the one added isn't. The
 * default strategy moves its lead to that account, with no quota notice.
 */

test('adds an account and keeps work on the requested agent without quota notices', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_OUT: 'claude-code@usual:3600' })
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // Another account, added in Settings › Agents, on Claude Code's tab.
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'Agents' }).click()
    const accounts = page.getByRole('list', { name: 'Claude Code accounts' })
    await expect(accounts.getByText('main', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add an account' }).click()
    await page.screenshot({ path: 'test-results/accounts-adding.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Sign in from a terminal' }).click()
    // The scripted agent is signed in at once: the new account is named in its line.
    const name = page.getByRole('textbox', { name: 'Name this account' })
    await expect(name).toHaveValue('Account 2')
    await name.fill('work')
    await page.screenshot({ path: 'test-results/accounts-naming.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Add account', exact: true }).click()
    await expect(accounts.getByText('work', { exact: true })).toBeVisible()
    await expect(accounts.getByText('main', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/accounts-added.png', animations: 'disabled' })
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await tabs.getByRole('button', { name: /^meridian/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The coordinator on Codex, from the composer: on Claude Code, the first agent, it would run out itself and
    // move on, and the task's lead would skip the exhausted account before this test tried it.
    await page.getByRole('button', { name: /^Coordinator:/ }).click()
    await page.getByRole('radio', { name: /, via Codex\b/ }).click()
    await page.keyboard.press('Escape')
    await startTask(page, 'Add a retry to the checkout call')

    // The default strategy uses Claude Code's other account and finishes without a quota notice.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Open task/ }).click()
    await expect(page.getByRole('heading', { name: 'Add a retry to the checkout call', level: 1 })).toBeVisible()
    await expect(page.getByText(/ran out of usage while working on the task/)).toHaveCount(0)
    await expect(page.getByText(/Checkout retries once when the payment call fails/).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/accounts-moved.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
  // Confirm the same agent used the connected account, rather than silently moving the task to another agent.
  const store = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
  try {
    const lead = store
      .prepare(`
      SELECT s.agent_id AS agent, a.name AS account FROM provider_sessions s
      JOIN threads t ON t.id = s.thread_id JOIN agent_accounts a ON a.id = s.account_id
      WHERE t.kind = 'task' AND s.agent_id = 'claude-code'
      ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`)
      .get()
    expect(lead).toEqual({ agent: 'claude-code', account: 'work' })
  } finally {
    store.close()
  }
})
