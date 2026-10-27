import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, startTask } from './support'

/*
 * The line up next, in a real window with the fake agent and the fake
 * GitHub: with one agent at a time, held by a server a finished task left
 * running, three reviews of someone else's pull requests and a quick task
 * wait in Up next, not Running, though none has a plan's first step. The
 * person drags the quick task to the front, to the back, and to the front
 * again let go outside the lane, starts a drag they cancel with Escape, and
 * moves the review last in line to the front from its own view; when the server stops, the line starts
 * in the person's order. Shots: test-results/line-*.png.
 */

const PULLS = ['Retry checkout once', 'Cache the partner list', 'Log refunds by partner']

test('lists reviews and a quick task waiting for an agent in Up next, and starts them in the order the person puts them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const repo = repository(projects)
  const git = (...args: Array<string>) =>
    execFileSync('git', args, { cwd: repo, env: { ...process.env, ...author } })
      .toString()
      .trim()
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', remote])
  git('remote', 'add', 'origin', 'https://github.test/meridian/api.git')
  git('push', '-q', remote, 'main')
  // Someone else's pull requests, each a commit of its own, on the remote as its head.
  const pulls = PULLS.map((title, index) => {
    git('checkout', '-q', '--detach', 'main')
    writeFileSync(join(repo, `change-${index + 1}.ts`), `export const change = ${index + 1}\n`)
    git('add', '.')
    git('commit', '-q', '-m', title)
    const headSha = git('rev-parse', 'HEAD')
    git('push', '-q', remote, `${headSha}:refs/pull/${index + 1}/head`)
    git('checkout', '-q', 'main')
    return { title, author: 'ninemate', headSha }
  })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote, ALTHAR_FAKE_PULLS: JSON.stringify(pulls) })
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await connectGitHub(page)
    // One agent at a time.
    const tabs = page.getByRole('navigation', { name: 'Projects' })
    await page.getByRole('button', { name: /^Althar settings/ }).click()
    const settings = page.getByRole('dialog', { name: 'Quick settings' })
    const slider = settings.getByRole('slider', { name: 'Agents at once' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await page.keyboard.press('Escape')
    await tabs.getByRole('button', { name: /^meridian/ }).click()

    // A task whose server keeps the one place, then three reviews and a quick task, all waiting for it.
    await startTask(page, 'Serve the prototype', '[lead:serve] [lead:finish]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 30_000 })
    for (const [index] of PULLS.entries()) {
      await say(page, `Review https://github.test/meridian/api/pull/${index + 1} [coordinator:review]`)
      await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(index + 1, { timeout: 20_000 })
    }
    // The quick task's lead keeps at it once it starts, so it keeps the place.
    await say(page, 'Try the double jump. [coordinator:start] [lead:wait]')
    await expect(page.getByText(/^Waiting: 1 of 1 agents busy/)).toHaveCount(4, { timeout: 20_000 })

    await page.getByRole('radio', { name: /^Board/ }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })
    const next = work.getByRole('region', { name: 'Up next' })
    const running = work.getByRole('region', { name: 'Running' })
    const rows = next.getByRole('listitem')
    // Each waits up next, in the order it started, none of them in Running.
    await expect(rows).toHaveCount(4)
    for (const [index, title] of PULLS.entries()) await expect(rows.nth(index)).toContainText(title)
    await expect(rows.nth(3)).toContainText('Try the double jump')
    await expect(rows.nth(0)).toContainText('Next in line')
    await expect(rows.nth(3)).toContainText('4th in line')
    await expect(running.getByRole('article')).toHaveCount(0)
    await expect(next.getByText('Drag to change the order')).toHaveCount(0)
    await page.mouse.move(1400, 880)
    await page.waitForTimeout(400)
    await work.screenshot({ path: 'test-results/line-board.png', scale: 'css', animations: 'disabled' })

    // A shot of the line mid-drag. Not on Linux: under X, a shot has the window report X's own pointer, which no button
    // holds, and the line takes it for a release it missed, ending the drag Playwright's mouse still holds.
    const midDrag = async (path: string) => {
      if (process.platform !== 'linux') await next.screenshot({ path, scale: 'css', animations: 'disabled' })
    }

    // The person drags the quick task by its grip to the front: the rows make room, and it says it is next as it goes.
    await rows.nth(3).hover()
    const grip = next.getByRole('button', { name: /^Move Try the double jump.* in the line$/ })
    const from = await grip.boundingBox()
    const top = await rows.nth(0).boundingBox()
    if (from === null || top === null) throw new Error('The line isn’t laid out')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++)
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - ((from.y - top.y + 10) * step) / 10)
    await expect(rows.nth(0)).toContainText('Try the double jump')
    await expect(rows.nth(0)).toContainText('Next in line')
    await midDrag('test-results/line-dragging.png')
    await page.mouse.up()
    await expect(next.getByRole('button', { name: 'Back to oldest first' })).toBeVisible()
    await expect(rows.nth(1)).toContainText(PULLS[0] ?? '')
    await expect(rows.nth(1)).toContainText('2nd in line')
    await page.mouse.move(1400, 880)
    await page.waitForTimeout(400)
    await next.screenshot({ path: 'test-results/line-dropped.png', scale: 'css', animations: 'disabled' })

    const JUMP = 'Try the double jump'
    const inOrder = async (titles: ReadonlyArray<string>) => {
      for (const [index, title] of titles.entries()) await expect(rows.nth(index)).toContainText(title)
    }
    // Presses a row's grip, to drag it from there.
    const grab = async (title: string) => {
      await rows.filter({ hasText: title }).hover()
      const box = await next.getByRole('button', { name: new RegExp(`^Move ${title}.* in the line$`) }).boundingBox()
      if (box === null) throw new Error(`${title} has no grip`)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const glide = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      for (let step = 1; step <= 10; step++)
        await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10)
    }
    const reviews = PULLS.map((title, index) => `Review #${index + 1}: ${title}`)

    // Down across the whole line: it goes to the back, and stays there once the runtime says the order.
    const bottom = await rows.nth(3).boundingBox()
    if (bottom === null) throw new Error('The line isn’t laid out')
    const down = await grab(JUMP)
    await glide(down, { x: down.x, y: bottom.y + bottom.height - 4 })
    await inOrder([...reviews, JUMP])
    await expect(rows.nth(3)).toContainText('4th in line')
    await midDrag('test-results/line-dragging-down.png')
    await page.mouse.up()
    await page.waitForTimeout(2500)
    await inOrder([...reviews, JUMP])

    // Up again, let go outside the lane, above it at the window's edge: it goes where the row showed it, the front.
    const above = await next.getByText('Starts when an agent is free').boundingBox()
    if (above === null) throw new Error('The line has no divider')
    const up = await grab(JUMP)
    await glide(up, { x: 4, y: above.y - 30 })
    await inOrder([JUMP, ...reviews])
    await page.mouse.up()
    await page.waitForTimeout(2500)
    await inOrder([JUMP, ...reviews])

    // Escape mid-drag puts the row back; the release after it, and hovering the grips later, move nothing.
    const first = await rows.nth(0).boundingBox()
    if (first === null) throw new Error('The line isn’t laid out')
    const cancelled = await grab(reviews[2] ?? '')
    await glide(cancelled, { x: cancelled.x, y: first.y + 4 })
    await inOrder([reviews[2] ?? '', JUMP, reviews[0] ?? '', reviews[1] ?? ''])
    await page.keyboard.press('Escape')
    await inOrder([JUMP, ...reviews])
    await page.mouse.up()
    await glide({ x: cancelled.x, y: first.y + 4 }, { x: cancelled.x, y: cancelled.y })
    await glide({ x: cancelled.x, y: cancelled.y }, { x: cancelled.x, y: first.y + 4 })
    await page.waitForTimeout(2500)
    await inOrder([JUMP, ...reviews])
    await expect(page.getByRole('region', { name: 'Up next' })).toBeVisible()

    // The last review, 4th in line, goes to the front from its own view.
    await rows
      .nth(3)
      .getByRole('button', { name: `Review #3: ${PULLS[2] ?? ''}`, exact: true })
      .click()
    await page.getByRole('button', { name: /^Waiting for a place/ }).click({ timeout: 15_000 })
    const behind = page.getByRole('dialog', { name: 'Behind this task' })
    const front = behind.getByRole('button', { name: 'Move to the front of the line' })
    await expect(front).toBeVisible()
    await page.waitForTimeout(300)
    await behind.screenshot({ path: 'test-results/line-task.png', scale: 'css', animations: 'disabled' })
    await front.click()
    await expect(front).toHaveCount(0)

    // The place frees: the line starts in the person's order, the review they put first (which reads in a turn), then the quick
    // task, which keeps the place; the two older reviews wait on, oldest first.
    await behind
      .getByRole('button', { name: /^Stop what/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Back to meridian' }).click()
    await page.getByRole('radio', { name: /^Board/ }).click()
    await expect(running.getByRole('button', { name: `Review #3: ${PULLS[2] ?? ''}`, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(running.getByRole('button', { name: /^Try the double jump/ })).toBeVisible({ timeout: 20_000 })
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(PULLS[0] ?? '')
    await expect(rows.nth(0)).toContainText('Next in line')
    await expect(rows.nth(1)).toContainText(PULLS[1] ?? '')
    await page.mouse.move(1400, 880)
    await page.waitForTimeout(400)
    await work.screenshot({ path: 'test-results/line-started.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
