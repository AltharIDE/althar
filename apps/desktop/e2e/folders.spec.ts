import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { launch, openFirstProject, say } from './support'

/*
 * A finished task's folder (ADR-055), in a real window with the fake agent,
 * on a profile and worktrees of the test's own: a quick task that committed
 * a change is marked Done; Settings › Work on this Mac lists its folder as
 * one that can go, and Clean up removes it; its thread says so as a line,
 * and what it changed still reads. Run brings the folder back, its header
 * saying so while it is set up again, and runs once it is; cleaned up
 * again, a message to its lead brings it back before the lead starts. Its
 * repository's install takes a few seconds, so its coming back shows. The
 * screenshots it takes are this change's own evidence
 * (test-results/folders-*.png).
 */

/** A page that answers on a port of its own and says where. */
const SERVER = `const server = require('node:http').createServer((_, res) => res.end('ok'))
server.listen(0, () => console.log('Listening on http://localhost:' + server.address().port + '/'))
`

const TITLE = 'Sketch a status page prototype'

test('a finished task’s folder goes from Settings, its work still reads, and it comes back as it runs or is written to', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // An install with a package of its own, offline, that takes a few seconds; and a page to run.
  mkdirSync(join(repo, 'status'))
  writeFileSync(join(repo, 'status', 'package.json'), JSON.stringify({ name: 'status', version: '1.0.0' }))
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify(
      {
        name: 'meridian',
        private: true,
        scripts: { preinstall: 'node -e "setTimeout(() => {}, 4000)"', dev: 'node serve.js' },
        dependencies: { status: 'file:./status' },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(repo, 'serve.js'), SERVER)
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  execFileSync('git', ['add', '.'], { cwd: repo, env: { ...process.env, ...author } })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env: { ...process.env, ...author } })
  const worktrees = join(home, 'worktrees')
  /** The task's folder: the one folder of a repository's worktree under the project's. */
  const folder = () => {
    const project = readdirSync(worktrees).find((name) => !name.startsWith('.'))
    const task = project === undefined ? undefined : readdirSync(join(worktrees, project)).find((name) => !name.startsWith('.'))
    return project === undefined || task === undefined ? null : join(worktrees, project, task, 'meridian')
  }
  const { electronApp, page } = await launch(home)
  const tabs = page.getByRole('navigation', { name: 'Projects' })
  /** Settings › Work on this computer, in the Settings tab. */
  const thisComputer = async () => {
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: /^Work on/ })
      .click()
  }
  /** Back to the project, where the person was, the Settings tab closed. */
  const backToProject = async () => {
    await tabs.getByRole('button', { name: 'Close Settings' }).click()
    await tabs.getByRole('button', { name: /^meridian/ }).click()
  }
  try {
    await (await electronApp.browserWindow(page)).evaluate((window) => window.setSize(1280, 860))
    await openFirstProject(electronApp, page, repo)
    await page.getByRole('radio', { name: 'Home' }).click()
    const work = page.getByRole('region', { name: 'The project’s work' })

    // Only when the person cleans up, so nothing goes by itself while the test runs.
    await thisComputer()
    const row = page.getByRole('main')
    await row.getByRole('combobox', { name: 'Remove finished tasks’ folders' }).click()
    await page.getByRole('option', { name: 'Only when I clean up' }).click()
    await expect(row.getByRole('combobox', { name: 'Remove finished tasks’ folders' })).toHaveText(/Only when I clean up/)
    await backToProject()

    // A quick task that commits a change and finishes; Done settles it.
    await say(page, `${TITLE} [coordinator:start] [lead:finish] [lead:edit]`)
    await expect(work.getByText('Finished', { exact: true })).toBeVisible({ timeout: 60_000 })
    await work.getByRole('button', { name: TITLE }).click()
    const header = page.getByRole('banner', { name: TITLE })
    await header.getByRole('button', { name: 'Done' }).click()
    await expect(header.getByText('Done', { exact: true })).toBeVisible()
    const kept = folder()
    expect(kept).not.toBeNull()
    expect(existsSync(kept ?? '')).toBe(true)

    // Work on this Mac lists its folder as one that can go; Clean up removes it, and says what it freed.
    await thisComputer()
    const legend = row.getByRole('button', { name: /Can go now/ })
    await expect(legend).toBeVisible({ timeout: 30_000 })
    await legend.click()
    await expect(page.getByRole('region', { name: 'Goes with Clean up' }).getByText(TITLE)).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-1-settings.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await row.getByRole('button', { name: 'Clean up' }).click()
    await expect(row.getByText(/^Freed .* just now$/)).toBeVisible({ timeout: 30_000 })
    expect(existsSync(kept ?? '')).toBe(false)
    await page.screenshot({ path: 'test-results/folders-2-freed.png', animations: 'disabled', scale: 'css' })
    await backToProject()

    // The task, where the person left it: a line where its folder went, and what it changed still reads, from the commit kept as it went.
    await expect(header).toBeVisible()
    await expect(page.getByText(/^Folder removed when you cleaned up/)).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-3-thread.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('radio', { name: /Outputs/ }).click()
    await expect(page.getByText('change.txt', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-4-outputs.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('radio', { name: /Conversation/ }).click()

    // Run brings it back: its header says so while it is set up again, and it runs once it is.
    await header.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(header.getByText('Bringing its folder back')).toBeVisible({ timeout: 15_000 })
    await header.screenshot({ path: 'test-results/folders-5-coming-back.png', animations: 'disabled', scale: 'css' })
    const card = page.getByRole('article', { name: `Run of ${TITLE}` })
    await expect(card.getByRole('button', { name: /^Open localhost:\d+$/ })).toBeVisible({ timeout: 60_000 })
    await expect(header.getByText('Bringing its folder back')).toHaveCount(0)
    await expect(page.getByText('Folder back from its branch')).toBeVisible()
    expect(existsSync(join(kept ?? '', 'node_modules', 'status'))).toBe(true)
    await page.screenshot({ path: 'test-results/folders-6-back.png', animations: 'disabled', scale: 'css' })
    await card.getByRole('button', { name: /^Stop / }).click()

    // Cleaned up again, a message to its lead brings it back before the lead starts.
    await thisComputer()
    await expect(row.getByRole('button', { name: 'Clean up' })).toBeEnabled({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Clean up' }).click()
    await expect.poll(() => existsSync(kept ?? ''), { timeout: 30_000 }).toBe(false)
    await backToProject()
    await expect(header).toBeVisible()
    await say(page, 'Add a dark theme too [lead:finish]')
    await expect(page.getByText('Folder back from its branch')).toHaveCount(2, { timeout: 60_000 })
    expect(existsSync(kept ?? '')).toBe(true)
  } finally {
    await electronApp.close()
  }
})
