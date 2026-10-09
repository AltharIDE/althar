import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { chooseFolder, launch } from './support'

/*
 * Several accounts per agent (ADR-012), as the person sees them: added on
 * the start, signed in and named in the list, and named where one runs out.
 * Claude Code's usual account is out for an hour here (ALTHAR_FAKE_OUT);
 * the one added isn't. A project doesn't rotate through an agent's accounts
 * until the person turns that on, so the work goes to another agent.
 */

test('adds an account to an agent, and names the one that ran out when a task moves on', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_OUT: 'claude-code@usual:3600' })
  try {
    const claude = page.getByRole('list', { name: 'Agents on this Mac' }).getByRole('listitem').filter({ hasText: 'Claude Code' }).first()
    await claude.getByRole('button', { name: 'Add an account' }).click()
    await page.screenshot({ path: 'test-results/accounts-adding.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Sign in in Terminal' }).click()
    // The scripted agent is signed in at once: the new account is named in its line.
    const name = page.getByRole('textbox', { name: 'Name this account' })
    await expect(name).toHaveValue('Account 2')
    await name.fill('work')
    await page.screenshot({ path: 'test-results/accounts-naming.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Add account', exact: true }).click()
    const accounts = page.getByRole('list', { name: 'Claude Code accounts' })
    await expect(accounts.getByText('work', { exact: true })).toBeVisible()
    await expect(accounts.getByText('main', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/accounts-added.png', animations: 'disabled' })

    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Open a folder/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByLabel('What should change').fill('Add a retry to the checkout call')
    await page.getByLabel('Anything the lead should know').fill('[lead:finish]')
    await page.getByRole('button', { name: /^Review:/ }).click()
    await page.getByRole('button', { name: 'No review' }).click()
    await page.getByRole('button', { name: 'Start the task' }).click()

    // The project doesn't rotate: Codex took the step over and finished it.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Open task/ }).click()
    await expect(page.getByText(/^Claude Code \(main\) reached its usage limit, until .+\. Codex takes over(, on .+)?\.$/)).toBeVisible()
    await expect(page.getByText('Did the task.')).toBeVisible()
    await page.screenshot({ path: 'test-results/accounts-moved.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
