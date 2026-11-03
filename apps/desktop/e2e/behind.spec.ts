import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, toConversation } from './support'

/*
 * What goes on behind a task, in a real window with the fake agent and the
 * fake GitHub (ADR-022): the dev server its lead left running (`[lead:serve]`)
 * and the draft pull request it listens to, over its composer, each stopped
 * from its list.
 */

test('shows over the composer the server its lead left running and the pull request it listens to, and stops each', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    const box = page.getByRole('textbox', { name: /^(Tell the coordinator something|Add to the queue)/ })
    await box.fill('Rate-limit refunds per partner. [coordinator:plan-no-review] [coordinator:plan] [lead:serve] [lead:finish] [lead:edit]')
    await box.press('Enter')
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // One chip floats over the composer: what its lead left running, with where it answers, and what it listens to.
    const chip = page.getByRole('button', { name: /Listening to PR #1$/ })
    await expect(chip).toContainText('localhost:5173')
    await expect(chip).toContainText('PR #1')
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/behind.png', animations: 'disabled' })

    // It opens all of it: the server, where it answers, and Stop.
    await chip.click()
    const list = page.getByRole('dialog', { name: 'Behind this task' })
    await expect(list.getByRole('button', { name: 'Open localhost:5173' })).toBeVisible()
    await page.screenshot({ path: 'test-results/behind-open.png', animations: 'disabled' })
    await list.getByRole('button', { name: /^Stop (?!listening)/ }).click()
    await expect(chip).not.toContainText('localhost:5173')

    // The pull request: what it listens for, and Stop; nothing said there after reaches the thread.
    await expect(list.getByText('meridian/api')).toBeVisible()
    await list.getByRole('button', { name: 'Stop listening to PR #1' }).click()
    await expect(chip).toHaveCount(0)
    await page.screenshot({ path: 'test-results/behind-quiet.png', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
