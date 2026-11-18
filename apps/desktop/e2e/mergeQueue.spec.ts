import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes, toConversation } from './support'

/*
 * Merged on a branch that merges through its merge queue, a task's pull
 * request plays its merge through at once: Merge answers the press, then goes
 * up into In the merge queue, while GitHub still holds the merge and before
 * any read says it is queued (The UI is instant). With ALTHAR_E2E_FRAMES
 * set, it keeps frames of it playing in test-results/merge-queue/, to make a
 * recording of.
 */

/** A project with a ready task whose pull request merges through its queue, GitHub holding its merge until `answers` is written. */
const ready = async (frames: string | null, plan = '') => {
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
  if (frames !== null) mkdirSync(frames, { recursive: true })
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 820))
  await openFirstProject(electronApp, page, repo)
  await connectGitHub(page)
  await say(page, `Cap parallel agents per machine. ${plan}[coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`)
  // A small change starts at once.
  if (plan === '') await page.getByRole('button', { name: 'Start now' }).click()
  await expect(page.getByText('PR #1')).toBeVisible()
  await page.getByRole('button', { name: /Open task/ }).click()
  await page
    .getByRole('radiogroup', { name: 'Face' })
    .getByRole('radio', { name: /Outputs/ })
    .click()
  await page.getByRole('button', { name: 'Mark ready for review' }).click()
  return { electronApp, page, answers }
}

/** Takes frames of `clip` while `taking()`, where `frames` is a folder to keep them in. */
const filming = (page: Page, frames: string | null, clip: { x: number; y: number; width: number; height: number } | undefined) => {
  let taking = frames !== null
  const taken = (async () => {
    for (let n = 0; taking && n < 60; n++)
      await page.screenshot({ path: `${frames}/${String(n).padStart(3, '0')}.png`, scale: 'css', ...(clip === undefined ? {} : { clip }) })
  })()
  return async () => {
    // The frames go on a moment past it, for the dot to arrive.
    if (frames !== null) await new Promise((done) => setTimeout(done, 900))
    taking = false
    await taken
  }
}

const framesOf = (name: string) => (process.env.ALTHAR_E2E_FRAMES === undefined ? null : `test-results/${name}`)

test('a merge into its merge queue goes up into it at once, while its host still holds the merge', async () => {
  const frames = framesOf('merge-queue')
  const { electronApp, page, answers } = await ready(frames)
  try {
    const merge = page.getByRole('button', { name: 'Accept and merge' })
    await expect(merge).toBeEnabled()
    // Merge's change, in Outputs: what plays.
    const card = page.locator('article').filter({ has: merge }).last()
    const box = await card.boundingBox()
    const stop = filming(
      page,
      frames,
      box === null ? undefined : { x: box.x - 12, y: box.y - 40, width: box.width + 24, height: Math.min(box.height, 220) + 52 },
    )
    await merge.click()
    // In its queue, GitHub still holding the merge: nothing waited on it.
    await expect(page.getByText('In the merge queue').first()).toBeVisible()
    await stop()
    writeFileSync(answers, '')
    await expect(page.getByText('In the merge queue').first()).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('merged from its card in Needs you, it goes up into its merge queue on the board at once', async () => {
  const frames = framesOf('merge-queue-board')
  const { electronApp, page, answers } = await ready(frames)
  try {
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await showPanes(page, { conversation: false, board: true })
    const lane = (name: string) => page.getByRole('region', { name })
    const merge = lane('Needs you').getByRole('button', { name: /^Accept and merge/ })
    await expect(merge).toBeEnabled()
    const box = await lane('Needs you').boundingBox()
    const running = await lane('Running').boundingBox()
    const stop = filming(
      page,
      frames,
      box === null || running === null
        ? undefined
        : {
            x: Math.min(box.x, running.x) - 8,
            y: Math.min(box.y, running.y) - 8,
            width: Math.max(box.x + box.width, running.x + running.width) - Math.min(box.x, running.x) + 16,
            height: 300,
          },
    )
    await merge.click()
    // At work in its queue, GitHub still holding the merge.
    await expect(lane('Running').getByText('In the merge queue')).toBeVisible()
    await stop()
    writeFileSync(answers, '')
  } finally {
    await electronApp.close()
  }
})

test('merged from its small change card in the thread, it goes up into its merge queue there at once', async () => {
  const frames = framesOf('merge-queue-thread')
  const { electronApp, page, answers } = await ready(frames, '[coordinator:plan-small] ')
  try {
    await toConversation(page)
    const merge = page.getByRole('region', { name: 'Thread' }).getByRole('button', { name: 'Merge', exact: true }).last()
    await expect(merge).toBeEnabled()
    await merge.scrollIntoViewIfNeeded()
    const box = await merge.boundingBox()
    const stop = filming(page, frames, box === null ? undefined : { x: Math.max(0, box.x - 420), y: box.y - 230, width: 560, height: 290 })
    await merge.click()
    // In its queue, GitHub still holding the merge.
    await expect(
      page
        .getByRole('region', { name: 'Thread' })
        .getByText(/In the (merge )?queue/)
        .last(),
    ).toBeVisible()
    await stop()
    writeFileSync(answers, '')
  } finally {
    await electronApp.close()
  }
})
