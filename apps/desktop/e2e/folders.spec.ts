import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { launch, openFirstProject, say, showPanes } from './support'

/*
 * A finished task's folder (ADR-056), in a real window with the fake agent,
 * on a profile and worktrees of the test's own: a quick task that committed
 * a change is marked Done; Settings › Work on this computer lists its folder as
 * one that can go, by what it holds that its install doesn't share with a
 * store outside it, and Clean up removes it, saying it freed that; its
 * thread says so as a line, and what it changed still reads. Run brings
 * the folder back, its header saying so while it is set up again, and runs
 * once it is; cleaned up again, a message to its lead brings it back before
 * the lead starts. Its repository's install waits for the test to let it
 * go, so its coming back shows. The screenshots it takes are this change's
 * own evidence (test-results/folders-*.png).
 */

/** A page that answers on a port of its own and says where. */
const SERVER = `const server = require('node:http').createServer((_, res) => res.end('ok'))
server.listen(0, () => console.log('Listening on http://localhost:' + server.address().port + '/'))
`

const TITLE = 'Sketch a status page prototype'

/** An install's first step, which goes on once the file `gate` names is there. */
const held = (gate: string) => `const { existsSync } = require('node:fs')
const wait = () => existsSync(${JSON.stringify(gate)}) || setTimeout(wait, 20)
wait()
`

test('a finished task’s folder goes from Settings, its work still reads, and it comes back as it runs or is written to', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  // An install with a package of its own, offline, held while the test says; and a page to run.
  const gate = join(home, 'install-goes-on')
  writeFileSync(gate, '')
  mkdirSync(join(repo, 'status'))
  writeFileSync(join(repo, 'status', 'package.json'), JSON.stringify({ name: 'status', version: '1.0.0' }))
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify(
      {
        name: 'meridian',
        private: true,
        scripts: { preinstall: 'node held.js', dev: 'node serve.js' },
        dependencies: { status: 'file:./status' },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(repo, 'serve.js'), SERVER)
  writeFileSync(join(repo, 'held.js'), held(gate))
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.fixture-install\n')
  execFileSync('git', ['add', '.'], { cwd: repo, env: { ...process.env, ...author } })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env: { ...process.env, ...author } })
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
    await showPanes(page, { conversation: true, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })

    // Only when the person cleans up, so nothing goes by itself while the test runs.
    await thisComputer()
    const row = page.getByRole('main')
    await row.getByRole('combobox', { name: 'Remove finished tasks’ folders' }).click()
    await page.getByRole('option', { name: 'Only when I clean up' }).click()
    await expect(row.getByRole('combobox', { name: 'Remove finished tasks’ folders' })).toHaveText(/Only when I clean up/)
    await backToProject()

    // Have the lead commit its change explicitly before it finishes. Done settles the task.
    await say(page, `${TITLE} [coordinator:start] [lead:commit] [lead:finish]`)
    await expect(work.getByText('Finished', { exact: true })).toBeVisible()
    await work.getByRole('button', { name: TITLE }).click()
    const header = page.getByRole('banner', { name: TITLE })
    const database = new DatabaseSync(join(home, 'profile', 'althar.sqlite'), { readOnly: true })
    let kept: string
    try {
      const path = database
        .prepare(`SELECT w.path FROM workspaces w JOIN tasks k ON k.id = w.task_id
          WHERE k.title = ? AND w.state = 'ready' AND w.access = 'write' AND w.kind IS NULL AND w.made_by IS NULL`)
        .get(TITLE)?.path
      if (typeof path !== 'string') throw new Error(`No writable worktree for ${TITLE}`)
      kept = path
    } finally {
      database.close()
    }
    expect(execFileSync('git', ['show', 'HEAD:change.txt'], { cwd: kept, encoding: 'utf8' })).toBe('change\n')
    const outputs = header.getByRole('radio', { name: /Outputs/ })
    const change = page.getByText('change.txt', { exact: true })
    await outputs.click()
    await expect(change).toBeVisible()
    await header.getByRole('radio', { name: /Conversation/ }).click()
    // An install it shares with a store outside it, a clone or a hardlink, frees nothing; what a package built there, it holds.
    const store = join(home, 'store')
    mkdirSync(store)
    writeFileSync(join(store, 'pkg.node'), Buffer.alloc(64 * 1024 ** 2, 1), { flush: true })
    // Use a dedicated directory, so the package manager does not replace files that are part of the fixture.
    const pkg = join(kept, '.fixture-install', 'pkg')
    mkdirSync(pkg, { recursive: true })
    if (process.platform === 'darwin') execFileSync('cp', ['-c', join(store, 'pkg.node'), join(pkg, 'pkg.node')])
    else linkSync(join(store, 'pkg.node'), join(pkg, 'pkg.node'))
    writeFileSync(join(pkg, 'built.node'), Buffer.alloc(12 * 1024 ** 2, 2), { flush: true })
    // Settling makes the folder eligible for sizing, so seed its install first.
    await header.getByRole('button', { name: 'Done' }).click()
    await expect(header.getByText('Done', { exact: true })).toBeVisible()

    // Work on this computer lists its folder as one that can go; Clean up removes it, and says what it freed.
    await thisComputer()
    const legend = row.getByRole('button', { name: /Can go now/ })
    await expect(legend).toBeVisible()
    await expect(legend).toHaveAccessibleName(/Can go now\s*12 MB/)
    await legend.click()
    await expect(page.getByRole('region', { name: 'Goes with Clean up' }).getByText(TITLE)).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-1-settings.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await row.getByRole('button', { name: 'Clean up' }).click()
    await expect(row.getByText(/^Freed 12 MB just now$/)).toBeVisible()
    expect(existsSync(kept)).toBe(false)
    await page.screenshot({ path: 'test-results/folders-2-freed.png', animations: 'disabled', scale: 'css' })
    await backToProject()

    // The task, where the person left it: a line where its folder went, and what it changed still reads, from the commit kept as it went.
    await expect(header).toBeVisible()
    await expect(page.getByText(/^Folder removed when you cleaned up/)).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-3-thread.png', animations: 'disabled', scale: 'css' })
    await outputs.click()
    await expect(change).toBeVisible()
    await page.screenshot({ path: 'test-results/folders-4-outputs.png', animations: 'disabled', scale: 'css' })
    await page.getByRole('radio', { name: /Conversation/ }).click()

    // Run brings it back: its header says so while it is set up again, and it runs once it is.
    rmSync(gate)
    // Run opens its list; its first line runs it (ADR-090).
    await header.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: /^Run / }).first().click()
    await page.keyboard.press('Escape')
    await expect(header.getByText('Bringing its folder back')).toBeVisible()
    await header.screenshot({ path: 'test-results/folders-5-coming-back.png', animations: 'disabled', scale: 'css' })
    writeFileSync(gate, '')
    const card = page.getByRole('article', { name: `Run of ${TITLE}` })
    await expect(card.getByRole('button', { name: /^Open localhost:\d+$/ })).toBeVisible()
    await expect(header.getByText('Bringing its folder back')).toHaveCount(0)
    await expect(page.getByText('Folder back from its branch')).toBeVisible()
    expect(existsSync(join(kept, 'node_modules', 'status'))).toBe(true)
    await page.screenshot({ path: 'test-results/folders-6-back.png', animations: 'disabled', scale: 'css' })
    await card.getByRole('button', { name: /^Stop / }).click()

    // Cleaned up again, a message to its lead brings it back before the lead starts.
    await thisComputer()
    await expect(row.getByRole('button', { name: 'Clean up' })).toBeEnabled()
    await row.getByRole('button', { name: 'Clean up' }).click()
    await expect.poll(() => existsSync(kept)).toBe(false)
    await backToProject()
    await expect(header).toBeVisible()
    await say(page, 'Add a dark theme too [lead:finish]')
    await expect(page.getByText('Folder back from its branch')).toHaveCount(2)
    expect(existsSync(kept)).toBe(true)
  } finally {
    await electronApp.close()
  }
})
