import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes, toConversation } from './support'

/*
 * Ship takes a route (code hosts, "Ship takes a route"), in a real window with the fake agent and the fake GitHub
 * (ADR-022): what the person's turn committed waits for Ship, which names its route on the Change card; set to Merged
 * from its chevron and pressed, it sends the commit up, marks the draft ready and waits on the check main requires,
 * greyed in place with no Push or Mark ready beside it, and merges once that check passes. The screenshots are this
 * change's evidence (test-results/ship-route-*.png).
 */

const branchHead = (remote: string, branch: string) =>
  execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim()

test('Ship to merged waits in place on a required check, nothing to press beside it, and merges once it passes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  // The fake GitHub's check runs until the spec writes this file, once the card has shown Ship waiting on it.
  const passes = join(home, 'checks-pass')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE: remote,
    ALTHAR_FAKE_CHECKS: JSON.stringify([{ name: 'test', state: 'running' }]),
    ALTHAR_FAKE_CHECKS_PASS: passes,
    ALTHAR_FAKE_RULES: JSON.stringify({ requiredChecks: ['test'], needs: [] }),
  })
  const title = 'Add a retry to the checkout call'
  const branch = 'althar/add-a-retry-to-the-checkout-call'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    // Its plan runs, with no review, and its draft pull request opens.
    await say(page, `${title}. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`)
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    const opened = branchHead(remote, branch)

    // The person asks its lead for a tweak: what that turn commits waits for Ship.
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(page, 'Make it retry twice. [lead:finish]')
    const header = page.locator(`header[aria-label="${title}"]`)
    await expect(header.getByText('1 commit not shipped')).toBeVisible()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()

    // The Change card offers Ship, naming its route (no reviewer, so no review; as far as a push, the task ending in a draft),
    // and no Push beside it.
    await expect(page.getByRole('button', { name: 'Ship push', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Push 1 commit' })).toHaveCount(0)
    await expect(page.getByText('Ship them')).toBeVisible()
    await expect(page.getByText('Push them')).toHaveCount(0)

    // As far as merged, from its chevron: the route on the button follows at once.
    await page.getByRole('button', { name: 'How far it goes' }).click()
    await page.getByRole('menuitemradio', { name: /Merged/ }).click()
    if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape')
    const toMerged = page.getByRole('button', { name: 'Ship push, then ready, then merge', exact: true })
    await expect(toMerged).toBeVisible()
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/ship-route-before.png', animations: 'disabled', scale: 'css' })

    // Pressed: the commit goes up, the draft is marked ready, and Ship waits in place on the check main requires, greyed,
    // with nothing to press beside it.
    await toMerged.click()
    const waiting = page.getByRole('button', { name: /^Merges once checks pass/ })
    await expect(waiting).toBeVisible()
    await expect(waiting).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('button', { name: /^Ship push/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Push \d+ commits?$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark ready for review' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Accept and merge/ })).toHaveCount(0)
    expect(branchHead(remote, branch)).not.toBe(opened)
    // The header says the stop too, as the board's card does: not the opening of a pull request, which is open already.
    await expect(header.getByText('Merges once checks pass')).toBeVisible()
    await expect(page.getByText('Opening the pull request')).toHaveCount(0)
    await page.mouse.move(1400, 300)
    await page.screenshot({ path: 'test-results/ship-route-waiting.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: false, board: true })
    const card = page.getByRole('region', { name: 'Running' }).getByRole('article').filter({ hasText: title })
    await expect(card.getByText('Merges once checks pass')).toBeVisible()
    await card.screenshot({ path: 'test-results/ship-route-board.png', animations: 'disabled', scale: 'css' })

    // The check passes: it merges, and the task settles.
    writeFileSync(passes, '')
    await expect(page.getByRole('region', { name: 'Settled' }).getByText(title)).toBeAttached()
  } finally {
    await electronApp.close()
  }
})
