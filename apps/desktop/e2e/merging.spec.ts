import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say } from './support'

/*
 * Merged in its task, and Back pressed at once, a task's card is out of
 * Needs you on the board, saying Merging, while GitHub merges it (three
 * seconds here, as the real one takes), and in Settled as soon as GitHub
 * says it merged: not after Althar listens to the pull request again. It
 * logs how long each took; the screenshots are this change's evidence
 * (test-results/merging-*.png).
 */

const MERGE_TAKES = 3_000

test('a task merged in its task view settles on the board as soon as GitHub merges it, merging meanwhile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE: remote,
    ALTHAR_FAKE_LATENCY: JSON.stringify({ merge: MERGE_TAKES }),
  })
  const title = 'Cap parallel agents per machine'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)

    await say(page, `${title}. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`)
    await page.getByRole('button', { name: 'Start now' }).click({ timeout: 20_000 })
    await expect(page.getByText('PR #1')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()

    // Merge, then Back at once, to the board.
    const pressed = Date.now()
    await page.getByRole('button', { name: 'Accept and merge' }).click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    const lane = (name: string) => page.getByRole('region', { name })
    const merging = lane('Running').getByRole('article').filter({ hasText: title })
    await expect(merging.getByText('Merging')).toBeVisible()
    const shown = Date.now() - pressed
    await expect(lane('Needs you').getByText(title)).toHaveCount(0)
    await merging.screenshot({ path: 'test-results/merging-card.png', animations: 'disabled', scale: 'css' })

    await expect(lane('Settled').getByText(title)).toBeVisible({ timeout: 30_000 })
    const settled = Date.now() - pressed
    await expect(lane('Running').getByText(title)).toHaveCount(0)
    await lane('Settled').screenshot({ path: 'test-results/merging-settled.png', animations: 'disabled', scale: 'css' })
    process.stdout.write(
      `Merging shown ${shown} ms after Merge; settled on the board ${settled} ms after, ${settled - MERGE_TAKES} ms after GitHub's ${MERGE_TAKES} ms merge\n`,
    )
    // GitHub's own time, and a second at most besides.
    expect(settled).toBeLessThan(MERGE_TAKES + 1_000)
  } finally {
    await electronApp.close()
  }
})
