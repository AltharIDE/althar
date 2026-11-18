import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say } from './support'

/*
 * Merged on a branch that merges through its merge queue, a task's pull
 * request plays its merge through at once: Merge answers the press, then goes
 * up into In the merge queue, while GitHub still holds the merge and before
 * any read says it is queued (The UI is instant). With ALTHAR_E2E_FRAMES
 * set, it keeps frames of it playing in test-results/merge-queue/, to make a
 * recording of.
 */

test('a merge into its merge queue goes up into it at once, while its host still holds the merge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  // The fake GitHub's merge waits for this file, written once the window has shown the merge in its queue.
  const answers = join(home, 'merge-answers')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_REMOTE: remote,
    ALTHAR_FAKE_QUEUE: '1',
    ALTHAR_FAKE_RULES: JSON.stringify({ requiredChecks: null, needs: [{ kind: 'merge_queue', state: 'met' }] }),
    ALTHAR_FAKE_HELD: JSON.stringify({ merge: answers }),
  })
  const frames = process.env.ALTHAR_E2E_FRAMES === undefined ? null : 'test-results/merge-queue'
  if (frames !== null) mkdirSync(frames, { recursive: true })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 820))
    await openFirstProject(electronApp, page, repo)
    await connectGitHub(page)
    await say(page, 'Cap parallel agents per machine. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
    await page.getByRole('button', { name: 'Start now' }).click()
    await expect(page.getByText('PR #1')).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await page.getByRole('button', { name: 'Mark ready for review' }).click()

    const merge = page.getByRole('button', { name: 'Accept and merge' })
    await expect(merge).toBeEnabled()
    // Merge's change, in Outputs: what plays.
    const card = page.locator('article').filter({ has: merge }).last()
    const box = await card.boundingBox()
    const clip = box === null ? undefined : { x: box.x - 12, y: box.y - 40, width: box.width + 24, height: Math.min(box.height, 220) + 52 }
    let taking = frames !== null
    const take = async () => {
      for (let n = 0; taking && n < 60; n++)
        await page.screenshot({
          path: `${frames}/${String(n).padStart(3, '0')}.png`,
          scale: 'css',
          ...(clip === undefined ? {} : { clip }),
        })
    }
    const taken = take()
    await merge.click()
    // In its queue, GitHub still holding the merge: nothing waited on it.
    await expect(page.getByText('In the merge queue').first()).toBeVisible()
    // The frames go on a moment past it, for the dot to arrive.
    if (frames !== null) await new Promise((done) => setTimeout(done, 900))
    taking = false
    await taken
    writeFileSync(answers, '')
    await expect(page.getByText('In the merge queue').first()).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
