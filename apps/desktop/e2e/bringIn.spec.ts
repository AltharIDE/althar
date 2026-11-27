import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { isoAfter } from '@althar/testing'
import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { chooseFolder, launch, openMadeProject, shown, still, toFirstProject } from './support'

/*
 * Moving to Althar from other tools (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"), in the
 * built app: a repository Conductor and Orca made worktrees of, with Conductor's setup, and Claude Code's conversations
 * in it and in Conductor's worktree. The welcome's step after the project's shows a tile a tool, nothing taken; one
 * opens to pick inside; what is taken comes in as the welcome goes on: Conductor's worktree a task held Up next, in its
 * own folder, its conversation its history, the conversation in the checkout an aside. Nothing of either tool's files
 * changes. Each state is shot at 1× into the repository's test-results.
 */

const SHOTS = '../../test-results/bring-in'

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, { cwd, env: { ...process.env, ...author }, encoding: 'utf8' }).trim()
const write = (path: string, body: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}
/** Claude Code's folder for a working folder. */
const claudeFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')
/**
 * When the conversations were had: an hour before the test, as work someone carried on recently, so the one brought in as an
 * aside is a pill beside the coordinator's. Pinned to a day, it would fold into "N older" a week after it.
 */
const HOUR = 60 * 60 * 1000
const session = (cwd: string, id: string, prompt: string, reply: string, title: string) =>
  [
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      sessionId: id,
      cwd,
      gitBranch: 'main',
      isSidechain: false,
      timestamp: isoAfter(-HOUR),
      message: { role: 'user', content: prompt },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: id,
      cwd,
      isSidechain: false,
      timestamp: isoAfter(-HOUR + 8000),
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: reply }] },
    },
    { type: 'ai-title', aiTitle: title, sessionId: id },
  ]
    .map((one) => JSON.stringify(one))
    .join('\n')

const digest = (root: string) => {
  const hash = createHash('sha256')
  const walk = (at: string) => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else hash.update(path).update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest('hex')
}

test('other tools’ worktrees, setup and conversations come in on the welcome, each where it belongs, nothing of theirs changed', async () => {
  // As the file system names it, as git and the agents do: macOS's temporary folder is reached through a link.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-e2e-')))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const repo = repository(projects)
  git(home, 'init', '-q', '--bare', join(home, 'origin.git'))
  git(repo, 'remote', 'add', 'origin', join(home, 'origin.git'))
  write(join(repo, 'conductor.json'), JSON.stringify({ scripts: { setup: 'bun install' } }))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Conductor’s setup')
  git(repo, 'push', '-q', 'origin', 'main')
  // Conductor's worktree, with a commit not pushed and a file not committed; Orca's, with one edit.
  const lima = join(home, 'conductor', 'workspaces', 'meridian', 'lima')
  mkdirSync(dirname(lima), { recursive: true })
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/checkout-retry', lima)
  write(join(lima, 'retry.ts'), 'export const retry = 3\n')
  git(lima, 'add', '.')
  git(lima, 'commit', '-q', '-m', 'Retry the checkout')
  write(join(lima, 'notes.md'), 'not yet\n')
  const orca = join(home, 'orca', 'workspaces', 'meridian', 'fix-flaky-login')
  mkdirSync(dirname(orca), { recursive: true })
  git(repo, 'worktree', 'add', '-q', '-b', 'fix/flaky-login', orca)
  write(join(orca, 'README.md'), '# meridian, edited\n')
  // Claude Code's conversations: one in Conductor's worktree, one in the checkout.
  write(
    join(home, '.claude', 'projects', claudeFolder(lima), '5f0c1a2b-0000-4000-8000-000000000001.jsonl'),
    session(
      lima,
      '5f0c1a2b-0000-4000-8000-000000000001',
      'Retry the checkout three times before failing',
      'Done: retry.ts retries three times.',
      'Checkout retries',
    ),
  )
  write(
    join(home, '.claude', 'projects', claudeFolder(repo), '5f0c1a2b-0000-4000-8000-000000000002.jsonl'),
    session(
      repo,
      '5f0c1a2b-0000-4000-8000-000000000002',
      'Why is the gyroscope fixture flaky?',
      'It rounds too early.',
      'Gyroscope fixture flaky',
    ),
  )
  const theirs = [join(home, '.claude'), join(home, 'conductor'), join(home, 'orca')].map(digest)

  const { electronApp, page } = await launch(home)
  try {
    await toFirstProject(page)
    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Choose a folder/ }).click()
    await expect(
      page.getByRole('list', { name: 'Repositories for the project' }).getByRole('checkbox', { checked: true }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: /Make the project/ }).click()

    // The step after the project's: a tile a tool, nothing taken, so its button lets it be.
    await expect(page.getByRole('heading', { name: 'Already under way', level: 1 })).toBeVisible()
    const card = page
      .getByRole('region')
      .filter({ has: page.getByRole('heading', { name: 'Already under way', level: 1 }) })
      .first()
    for (const tool of ['Conductor', 'Orca', 'Claude Code'])
      await expect(card.getByRole('button', { name: new RegExp(`^${tool}`) })).toBeVisible()
    await expect(card.getByRole('button', { name: /^Conductor/ })).toContainText('1 worktree')
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible()
    await still(page)
    await card.screenshot({ path: `${SHOTS}/found.png`, scale: 'css' })

    // Conductor's opens under its row, its worktree and setup to pick inside.
    await card.getByRole('button', { name: 'What’s in Conductor' }).click()
    await expect(card.getByRole('checkbox', { name: /^lima/ })).toBeVisible()
    await expect(card.getByRole('checkbox', { name: /Conductor’s setup/ })).toBeVisible()
    await still(page)
    await card.screenshot({ path: `${SHOTS}/open.png`, scale: 'css' })

    // Take all of Conductor, and one conversation of Claude Code's.
    await card.getByRole('button', { name: /^Conductor/ }).click()
    await card.getByRole('button', { name: 'What’s in Claude Code' }).click()
    await card.getByRole('checkbox', { name: /Gyroscope fixture flaky/ }).click()
    await still(page)
    await card.screenshot({ path: `${SHOTS}/taken.png`, scale: 'css' })
    await page.getByRole('button', { name: 'Bring in 1 worktree, 1 setup and 1 conversation' }).click()
    await openMadeProject(page)

    // Conductor's worktree is a task held Up next, in Conductor's own folder, its conversation its history.
    const upNext = page.getByRole('region', { name: 'Up next' }).filter({ visible: true })
    await expect(upNext.getByText('Held. Starts when you say')).toBeVisible()
    await still(page)
    await upNext.screenshot({ path: `${SHOTS}/up-next.png`, scale: 'css' })
    await upNext.getByRole('button', { name: 'Checkout retry' }).click()
    await expect(shown(page, 'Brought in from Conductor').first()).toBeVisible()
    await expect(shown(page, 'Retry the checkout three times before failing').first()).toBeVisible()
    await expect(shown(page, 'Done: retry.ts retries three times.').first()).toBeVisible()
    await still(page)
    await page.screenshot({ path: `${SHOTS}/task.png`, scale: 'css' })
    // The conversation from the checkout is an aside beside the coordinator's.
    await page.keyboard.press('Escape')
    await expect(
      page
        .getByRole('tablist', { name: 'Conversations' })
        .filter({ visible: true })
        .getByRole('tab', { name: /Gyroscope fixture flaky/ }),
    ).toBeVisible()

    // The folder is Conductor's, as it was: on its branch, with what it holds; and nothing of either tool's changed.
    expect(git(lima, 'branch', '--show-current')).toBe('feature/checkout-retry')
    expect(git(lima, 'status', '--porcelain')).toBe('?? notes.md')
    expect([join(home, '.claude'), join(home, 'conductor'), join(home, 'orca')].map(digest)).toEqual(theirs)
  } finally {
    await electronApp.close()
  }
})

test('a conversation brought in waits while Claude Code still has it open, and goes once it is closed', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-e2e-')))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const repo = repository(projects)
  const id = '5f0c1a2b-0000-4000-8000-000000000003'
  write(
    join(home, '.claude', 'projects', claudeFolder(repo), `${id}.jsonl`),
    session(repo, id, 'Why is the gyroscope fixture flaky?', 'It rounds too early.', 'Gyroscope fixture flaky'),
  )
  // Claude Code, still open on it in a terminal: a stand-in named as it is, run as `claude --resume <id>`.
  write(join(home, 'bin', 'claude'), 'setInterval(() => undefined, 60_000)\n')
  const terminal = spawn(process.execPath, [join(home, 'bin', 'claude'), '--resume', id], { stdio: 'ignore' })
  const line = 'Claude Code still has this conversation open in another window. Close it there and send again.'

  const { electronApp, page } = await launch(home)
  // An aside's composer is a task's own, embedded: Reply, or while its lead works, to queue or steer.
  const composer = page.getByRole('textbox', { name: /^(Reply|Add to the queue|Steer the lead)/ }).filter({ visible: true })
  /** The conversation's column with its composer, at 1×. */
  const shoot = async (name: string) => {
    const box = await composer.boundingBox()
    if (box === null) return
    await still(page)
    await page.screenshot({
      path: `${SHOTS}/${name}.png`,
      clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 260), width: box.width + 48, height: box.height + 300 },
      scale: 'css',
    })
  }
  try {
    await toFirstProject(page)
    await chooseFolder(electronApp, repo)
    await page.getByRole('button', { name: /Choose a folder/ }).click()
    await expect(
      page.getByRole('list', { name: 'Repositories for the project' }).getByRole('checkbox', { checked: true }).first(),
    ).toBeVisible()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await expect(page.getByRole('heading', { name: 'Already under way', level: 1 })).toBeVisible()
    const card = page
      .getByRole('region')
      .filter({ has: page.getByRole('heading', { name: 'Already under way', level: 1 }) })
      .first()
    await card.getByRole('button', { name: 'What’s in Claude Code' }).click()
    await card.getByRole('checkbox', { name: /Gyroscope fixture flaky/ }).click()
    await page.getByRole('button', { name: 'Bring in 1 conversation' }).click()
    await openMadeProject(page)
    await page
      .getByRole('tablist', { name: 'Conversations' })
      .filter({ visible: true })
      .getByRole('tab', { name: /Gyroscope fixture flaky/ })
      .click()
    // Read while it's open elsewhere: nothing holds reading back.
    await expect(shown(page, 'It rounds too early.').first()).toBeVisible()

    // Sent while it's open: not sent, the words back in the composer, and the line says which tool has it.
    // A click waits until the window takes input, as `say` does.
    await composer.click()
    await composer.fill('Is it fixed now?')
    await composer.press('Enter')
    await expect(page.getByText(line).filter({ visible: true })).toBeVisible()
    await expect(composer).toHaveValue('Is it fixed now?')
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await shoot(`open-elsewhere-${scheme}`)
    }
    await page.emulateMedia({ colorScheme: 'light' })

    // Closed there, the same send goes.
    await stop(terminal)
    await composer.press('Enter')
    await expect(shown(page, 'Is it fixed now?').first()).toBeVisible()
    await expect(page.getByText(line).filter({ visible: true })).toHaveCount(0)
    await expect(composer).toHaveValue('')
    await shoot('open-elsewhere-closed')
  } finally {
    await stop(terminal)
    await electronApp.close()
  }
})

const stop = (child: ReturnType<typeof spawn>) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('exit', () => resolve())
    child.kill()
  })
