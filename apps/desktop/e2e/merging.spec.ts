import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say } from './support'

/*
 * Merged in its task, and Back pressed at once, a task's card is out of
 * Needs you on the board, saying Merging, while GitHub merges it (held
 * here until the board has shown it, as the real one takes a few seconds),
 * and in Settled once GitHub says it merged. That GitHub's answer settles it, not Althar listening to the pull
 * request again, is the runtime's to show, where a test says when a read
 * comes (changes.test.ts: though reading it back still says open); here the
 * window shows what the runtime says. The screenshots are this change's
 * evidence (test-results/merging-*.png).
 */

test('a task merged in its task view settles on the board as soon as GitHub merges it, merging meanwhile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  // The fake GitHub's merge waits for this file, which the spec writes once the board has shown it merging.
  const merged = join(home, 'merge-goes-on')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE: remote,
    ALTHAR_FAKE_HELD: JSON.stringify({ merge: merged }),
  })
  const title = 'Cap parallel agents per machine'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    await say(page, `${title}. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`)
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()

    // Merge, then Back at once, to the board.
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const lane = (name: string) => page.getByRole('region', { name })
    const merging = lane('Running').getByRole('article').filter({ hasText: title })
    await expect(merging.getByText('Merging')).toBeVisible()
    await expect(lane('Needs you').getByText(title)).toHaveCount(0)
    await merging.screenshot({ path: 'test-results/merging-card.png', animations: 'disabled', scale: 'css' })
    writeFileSync(merged, '')

    // Put in Settled, it travels there from Running and shows when it lands (ADR-068): it is there when placed.
    await expect(lane('Settled').getByText(title)).toBeAttached()
    await expect(lane('Settled').getByText(title)).toBeVisible()
    await expect(lane('Running').getByText(title)).toHaveCount(0)
    await lane('Settled').screenshot({ path: 'test-results/merging-settled.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
