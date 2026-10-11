import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { runOf, setupIn } from '../src/runCommand'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { lastLinesOf, type SetUp, shellFor, toldOf } from '../src/Setups'
import { Tasks } from '../src/Tasks'
import { items, repository, runtime, until } from './support'

/*
 * A task's worktree set up by Althar itself, before its lead starts
 * (ADR-023): the install its lockfile names, or the setup kept for its
 * repository, run once per worktree, in the person's shell, outside any
 * agent's sandbox. The thread shows it; a failure is shown with the end of
 * what it printed, and the lead is told, and starts all the same.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

const INSTALL = 'test -d node_modules || bun install --frozen-lockfile'

/** A repository whose package.json needs a package Bun installs from inside it, with no network: its lockfile says so. */
const withPackages = () => {
  const path = repository()
  mkdirSync(join(path, 'vendor', 'greet'), { recursive: true })
  writeFileSync(join(path, 'vendor', 'greet', 'package.json'), JSON.stringify({ name: 'greet', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(path, 'vendor', 'greet', 'index.js'), "module.exports = 'hello'\n")
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', dependencies: { greet: 'file:./vendor/greet' } }))
  writeFileSync(
    join(path, 'bun.lock'),
    `${JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { '': { name: 'meridian', dependencies: { greet: 'file:./vendor/greet' } } },
        packages: { greet: ['greet@file:vendor/greet', {}] },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(path, '.gitignore'), 'node_modules\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Packages')
  return path
}

/** Opens a repository as a project, keeping a setup for it where one is given, and makes a task in it. */
const taskIn = (path: string, setup?: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    if (setup !== undefined)
      yield* (yield* Launches).keep({
        projectId: project.projectId,
        run: { command: 'node serve.js', setup },
        actorId: (yield* Instance).personId,
      })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
      projectId: project.projectId,
      title: 'Retry checkout',
    })
    return { project, task }
  })

/** How each of a task's worktrees was set up, where it has been. */
const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ path: string; setup: string | null }>`SELECT path, setup FROM workspaces WHERE task_id = ${taskId}`
    return rows.map((row) => ({ path: row.path, setup: row.setup === null ? null : (JSON.parse(row.setup) as SetUp) }))
  })

/** Waits until each of a task's worktrees has been set up. */
const setUp = (taskId: string, limit?: Duration.Duration) =>
  until(workspacesOf(taskId), (rows) => rows.length > 0 && rows.every((row) => row.setup !== null), limit)

/** The setup items in a thread, as their content. */
const setupItems = (threadId: string) =>
  Effect.map(items(threadId), (rows) => rows.flatMap((row) => (row.kind === 'setup' ? [row.content] : [])))

/** The processes Althar ran to set up worktrees. */
const setupProcesses = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ state: string; exitCode: number | null; pid: number | null }>`
    SELECT state, exit_code, pid FROM processes WHERE purpose = 'setup' ORDER BY launched_at`
})

/** The turns on a thread, with what each was told and when it was asked for. */
const turnsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string | null; requestedAt: string; state: string }>`
      SELECT prompt, requested_at, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, id`
  })

/** Starts a lead on the task's thread, and waits for its first turn, its brief, to be given. */
const lead = (threadId: string) =>
  Effect.gen(function* () {
    yield* (yield* Sessions).start({ threadId, agentId: 'claude-code' })
    const [first] = yield* until(turnsOf(threadId), (rows) => rows.length > 0)
    return first?.prompt ?? ''
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('what sets up a worktree', () => {
  const folder = () => mkdtempSync(join(tmpdir(), 'althar-setup-'))
  const manifest = (at: string, fields: Record<string, unknown>) => writeFileSync(join(at, 'package.json'), JSON.stringify(fields))

  it('installs its packages with the package manager its lockfile names, never changing it, whether or not it says how it runs', () => {
    const managers = [
      ['bun.lock', 'bun install --frozen-lockfile'],
      ['bun.lockb', 'bun install --frozen-lockfile'],
      ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
      ['yarn.lock', 'yarn install --frozen-lockfile'],
      ['package-lock.json', 'npm ci'],
    ]
    for (const [lockfile, install] of managers) {
      const here = folder()
      // Only a test script: nothing says how it runs, but its packages are still installed.
      manifest(here, { scripts: { test: 'vitest' }, devDependencies: { vitest: '4' } })
      writeFileSync(join(here, lockfile ?? ''), '')
      assert.strictEqual(setupIn(here, here, 'darwin'), `test -d node_modules || ${install}`)
    }
    // A folder of a larger repository, with the lockfile at the root.
    const root = folder()
    const app = join(root, 'apps', 'web')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    manifest(app, { dependencies: { react: '19' } })
    assert.strictEqual(setupIn(app, root, 'darwin'), 'test -d node_modules || pnpm install --frozen-lockfile')
    // No lockfile: an install that writes none. On Windows, in its own shell's words.
    const loose = folder()
    manifest(loose, { dependencies: { react: '19' } })
    assert.strictEqual(setupIn(loose, loose, 'win32'), 'if not exist node_modules npm install --no-package-lock')
    // Nothing to install, nothing to read, nothing that reads.
    const bare = folder()
    manifest(bare, { name: 'bare' })
    assert.isNull(setupIn(bare))
    assert.isNull(setupIn(folder()))
    const broken = folder()
    writeFileSync(join(broken, 'package.json'), '{ not json')
    assert.isNull(setupIn(broken))
  })

  it('is the setup kept for the repository, else the install it needs; one value, before a run and in a new worktree alike', () => {
    const here = folder()
    manifest(here, { scripts: { dev: 'vite' }, dependencies: { vite: '7' } })
    writeFileSync(join(here, 'bun.lock'), '')
    // A command kept without a setup still installs first.
    assert.deepStrictEqual(runOf({ command: 'make dev', setup: null }, here, here, 'darwin'), {
      command: 'make dev',
      setup: `test -d node_modules || bun install --frozen-lockfile`,
    })
    assert.deepStrictEqual(runOf({ command: 'make dev', setup: 'make deps' }, here, here, 'darwin'), {
      command: 'make dev',
      setup: 'make deps',
    })
    assert.deepStrictEqual(runOf({ command: null, setup: null }, here, here, 'darwin'), {
      command: 'bun run dev',
      setup: 'test -d node_modules || bun install --frozen-lockfile',
    })
    // Nothing says how it runs: no run, though its packages would still be installed in a worktree.
    const library = folder()
    manifest(library, { dependencies: { zod: '4' } })
    assert.isNull(runOf({ command: null, setup: null }, library))
    assert.isNotNull(setupIn(library))
  })

  it('runs in the person’s login shell, interactive, so it finds their tools; a shell that isn’t POSIX gives way', () => {
    assert.deepStrictEqual(shellFor('bun install', 'darwin', '/opt/homebrew/bin/bash'), {
      command: '/opt/homebrew/bin/bash',
      args: ['-i', '-l', '-c', 'exec 2>&1\n(\nbun install\n)'],
    })
    assert.strictEqual(shellFor('bun install', 'darwin', '/opt/homebrew/bin/fish').command, '/bin/zsh')
    assert.strictEqual(shellFor('bun install', 'linux', undefined).command, '/bin/sh')
    assert.strictEqual(shellFor('bun install', 'linux', 'zsh').command, '/bin/sh')
    assert.deepStrictEqual(shellFor('npm ci', 'win32', undefined), { command: 'cmd.exe', args: ['/d', '/s', '/c', '(npm ci) 2>&1'] })
  })

  it('keeps the end of what it printed, without colours or the lines a progress bar wrote over', () => {
    const printed = [
      ...Array.from({ length: 30 }, (_, n) => `line ${n + 1}`),
      '\u001b[31merror\u001b[0m: lockfile had changes',
      'resolving 1/9\rresolving 9/9',
      '',
      '',
    ].join('\n')
    const last = lastLinesOf(printed).split('\n')
    assert.lengthOf(last, 20)
    assert.strictEqual(last[0], 'line 13')
    assert.deepStrictEqual(last.slice(-2), ['error: lockfile had changes', 'resolving 9/9'])
    assert.isTrue(lastLinesOf('x'.repeat(5_000)).startsWith('…'))
  })

  it('tells the lead what ran, and for what failed, why and how it ended, by repository where there are several', () => {
    const done: SetUp = { at: '2026-10-11T10:00:00.000Z', command: INSTALL, code: 0, timedOut: false, last: null }
    const one = toldOf([{ name: 'meridian', setUp: done }], false)
    assert.include(one, `When the worktree was made, Althar set it up with \`${INSTALL}\`, and that went through`)
    assert.notInclude(one, 'set_run_command')
    const failed: SetUp = { ...done, command: 'npm ci', code: 1, last: 'npm ERR! missing: left-pad' }
    const timedOut: SetUp = { ...done, command: 'make deps', code: null, timedOut: true, last: null }
    const several = toldOf(
      [
        { name: 'web', setUp: failed },
        { name: 'api', setUp: timedOut },
      ],
      true,
    )
    assert.include(several, "When web's worktree was made, Althar set it up with `npm ci`, and it failed with exit code 1.")
    assert.include(several, '```\nnpm ERR! missing: left-pad\n```')
    assert.include(several, "When api's worktree was made, Althar set it up with `make deps`, and it ran out of time and was stopped.")
    assert.include(several, 'keep the right one with set_run_command')
    assert.include(toldOf([{ name: 'web', setUp: { ...failed, code: null, last: null } }], false), "and it didn't finish.")
  })
})

describe('setting up a task’s worktree', () => {
  it.live('installs what its lockfile names as the worktree is made, before the lead starts, and tells the lead', () =>
    Effect.gen(function* () {
      const path = withPackages()
      const { task } = yield* taskIn(path)
      const [workspace] = yield* setUp(task.taskId, Duration.seconds(60))
      // Installed in the worktree, by Bun, with the lockfile as it was.
      assert.isTrue(existsSync(join(task.worktree, 'node_modules', 'greet', 'index.js')))
      assert.strictEqual(git(task.worktree, 'status', '--porcelain'), '')
      assert.deepInclude(workspace?.setup, { command: INSTALL, code: 0, timedOut: false, last: null })
      // As Althar's own process, recorded as one, which has ended.
      const [ran] = yield* setupProcesses
      assert.deepInclude(ran, { state: 'exited', exitCode: 0 })
      // The thread shows it, ended.
      const [item] = yield* setupItems(task.threadId)
      assert.deepInclude(item, { repository: basename(path), command: INSTALL, kept: false })
      assert.deepInclude((item?.ended ?? {}) as object, { code: 0, timedOut: false, stopped: false, last: null })
      // The lead's first turn says so.
      const brief = yield* lead(task.threadId)
      assert.include(brief, `When the worktree was made, Althar set it up with \`${INSTALL}\`, and that went through`)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('runs the setup kept for the repository instead, and the lead’s first turn waits for it', () =>
    Effect.gen(function* () {
      const kept = 'sleep 1; printf ready > kept.txt'
      const { task } = yield* taskIn(withPackages(), kept)
      // Started at once, its lead is given nothing until the worktree is set up.
      const brief = yield* lead(task.threadId)
      const [workspace] = yield* workspacesOf(task.taskId)
      assert.deepInclude(workspace?.setup, { command: kept, code: 0 })
      const [first] = yield* turnsOf(task.threadId)
      assert.isAtLeast(Date.parse(first?.requestedAt ?? ''), Date.parse(workspace?.setup?.at ?? ''))
      assert.strictEqual(readFileSync(join(task.worktree, 'kept.txt'), 'utf8'), 'ready')
      // The kept one, not the install the lockfile would have had.
      assert.isFalse(existsSync(join(task.worktree, 'node_modules')))
      const [item] = yield* setupItems(task.threadId)
      assert.deepInclude(item, { command: kept, kept: true })
      assert.include(brief, `Althar set it up with \`${kept}\``)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('stops a lead that waits on its worktree’s setup at once, and the setup goes on', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task } = yield* taskIn(repository(), 'sleep 2; printf ready > kept.txt')
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code' })
      const asked = Date.now()
      yield* sessions.stop(task.threadId)
      assert.isBelow(Date.now() - asked, 1_500)
      assert.lengthOf(yield* turnsOf(task.threadId), 0)
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { code: 0 })
      assert.isTrue(existsSync(join(task.worktree, 'kept.txt')))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('sets nothing up where there is nothing to, and says nothing of it', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(repository())
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { command: null, code: null })
      assert.lengthOf(yield* setupItems(task.threadId), 0)
      assert.lengthOf(yield* setupProcesses, 0)
      assert.notInclude(yield* lead(task.threadId), 'Althar set it up')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('shows a setup that failed, with the end of what it printed, and starts the lead all the same, told what failed', () =>
    Effect.gen(function* () {
      const failing = "echo 'resolving'; echo 'npm ERR! missing: left-pad' >&2; exit 3"
      const { task } = yield* taskIn(repository(), failing)
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { command: failing, code: 3, timedOut: false, last: 'resolving\nnpm ERR! missing: left-pad' })
      const [item] = yield* setupItems(task.threadId)
      assert.deepInclude((item?.ended ?? {}) as object, {
        code: 3,
        timedOut: false,
        stopped: false,
        last: 'resolving\nnpm ERR! missing: left-pad',
      })
      // The lead starts, told what failed and what to do about it.
      const brief = yield* lead(task.threadId)
      assert.include(brief, `Althar set it up with \`${failing}\`, and it failed with exit code 3.`)
      assert.include(brief, '```\nresolving\nnpm ERR! missing: left-pad\n```')
      assert.include(brief, 'keep the right one with set_run_command')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('stops a setup that runs out of time, and the lead starts all the same', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(repository(), 'echo waiting; sleep 30')
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { code: null, timedOut: true, last: 'waiting' })
      // Its process group is stopped, and recorded so.
      const [ran] = yield* setupProcesses
      assert.strictEqual(ran?.state, 'killed')
      yield* until(Effect.succeed([alive(ran?.pid ?? 0)]), ([up]) => up === false)
      assert.include(yield* lead(task.threadId), 'and it ran out of time and was stopped.')
    }).pipe(Effect.provide(runtime(undefined, undefined, { setups: { within: Duration.millis(500) } }))),
  )

  it.live('doesn’t set a worktree up again when its lead starts again, but does once the worktree is made again', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const { task } = yield* taskIn(repository(), 'printf x >> setups.txt')
      yield* lead(task.threadId)
      // The lead stops, and starts again, as it does when the task resumes: its worktree is set up already.
      yield* sessions.stop(task.threadId)
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      yield* until(turnsOf(task.threadId), (rows) => rows.length >= 2)
      assert.lengthOf(yield* setupItems(task.threadId), 1)
      assert.lengthOf(yield* setupProcesses, 1)
      assert.strictEqual(readFileSync(join(task.worktree, 'setups.txt'), 'utf8'), 'x')
      // Abandoned, its folder deleted, and reopened: the worktree is put back, fresh, and set up again.
      yield* sessions.stop(task.threadId)
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: task.taskId })
      rmSync(task.worktree, { recursive: true, force: true })
      yield* tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: task.taskId })
      yield* until(setupItems(task.threadId), (all) => all.length === 2 && all[1]?.ended != null)
      assert.strictEqual(readFileSync(join(task.worktree, 'setups.txt'), 'utf8'), 'x')
      assert.lengthOf(yield* setupProcesses, 2)
    }).pipe(Effect.provide(runtime())),
  )
})
