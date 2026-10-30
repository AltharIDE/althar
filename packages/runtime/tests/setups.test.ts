import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { installIn, runOf, setupIn } from '../src/runCommand'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { lastLinesOf, type SetUp, shellFor, toldOf } from '../src/Setups'
import { Tasks } from '../src/Tasks'
import { items, repository, runtime, until } from './support'

/** Windows, where what some tests stand on isn't (each says what). */
const windows = process.platform === 'win32'

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

/** The install a worktree gets, as its lockfile names it: run as it is, since its workspace keeps whether it ran. */
const INSTALL = 'bun install --frozen-lockfile'

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

/** A monorepo whose root names only its workspaces, one of which needs another: its lockfile says so, for Bun to install with no network. */
const withWorkspaces = () => {
  const path = repository()
  mkdirSync(join(path, 'packages', 'greet'), { recursive: true })
  mkdirSync(join(path, 'packages', 'app'), { recursive: true })
  writeFileSync(join(path, 'packages', 'greet', 'package.json'), JSON.stringify({ name: 'greet', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(path, 'packages', 'greet', 'index.js'), "module.exports = 'hello'\n")
  writeFileSync(
    join(path, 'packages', 'app', 'package.json'),
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { greet: 'workspace:*' } }),
  )
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', private: true, workspaces: ['packages/*'] }))
  writeFileSync(
    join(path, 'bun.lock'),
    `${JSON.stringify(
      {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          '': { name: 'meridian' },
          'packages/app': { name: 'app', version: '1.0.0', dependencies: { greet: 'workspace:*' } },
          'packages/greet': { name: 'greet', version: '1.0.0' },
        },
        packages: { app: ['app@workspace:packages/app'], greet: ['greet@workspace:packages/greet'] },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(path, '.gitignore'), 'node_modules\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Workspaces')
  return path
}

/** A folder holding a repository for each name, opened as one project of several. */
const folderOf = (...names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path)
    git(path, 'init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    git(path, 'add', '.')
    git(path, 'commit', '-q', '-m', 'Start')
  }
  return folder
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
    const rows = yield* sql<{
      path: string
      setup: string | null
    }>`SELECT path, setup FROM workspaces WHERE task_id = ${taskId} ORDER BY rowid`
    return rows.map((row) => ({ path: row.path, setup: row.setup === null ? null : (JSON.parse(row.setup) as SetUp) }))
  })

/** Waits until each of a task's worktrees has been set up. */
const setUp = (taskId: string) => until(workspacesOf(taskId), (rows) => rows.length > 0 && rows.every((row) => row.setup !== null))

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

  it('installs a monorepo whose root names only its workspaces, as npm, Yarn, Bun and pnpm name them', () => {
    const named = [{ workspaces: ['packages/*'] }, { workspaces: { packages: ['apps/*'] } }]
    for (const fields of named) {
      const root = folder()
      manifest(root, { name: 'meridian', private: true, ...fields })
      writeFileSync(join(root, 'yarn.lock'), '')
      assert.strictEqual(installIn(root), 'yarn install --frozen-lockfile')
    }
    const pnpm = folder()
    manifest(pnpm, { name: 'meridian', private: true })
    writeFileSync(join(pnpm, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeFileSync(join(pnpm, 'pnpm-lock.yaml'), '')
    assert.strictEqual(installIn(pnpm), 'pnpm install --frozen-lockfile')
    // Before a run, only where nothing is installed yet; in a worktree, as it is.
    assert.strictEqual(setupIn(pnpm, pnpm, 'darwin'), 'test -d node_modules || pnpm install --frozen-lockfile')
    const none = folder()
    manifest(none, { name: 'meridian', workspaces: [] })
    assert.isNull(installIn(none))
    const optional = folder()
    manifest(optional, { optionalDependencies: { fsevents: '2' } })
    assert.strictEqual(installIn(optional), 'npm install --no-package-lock')
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
    assert.deepStrictEqual(shellFor('npm ci', 'win32', undefined), {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"(npm ci) 2>&1"'],
      verbatim: true,
    })
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
      const [workspace] = yield* setUp(task.taskId)
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

  it.live('installs a monorepo whose root names only its workspaces', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(withWorkspaces())
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { command: INSTALL, code: 0 }, workspace?.setup?.last ?? '')
      assert.isTrue(existsSync(join(task.worktree, 'packages', 'app', 'node_modules', 'greet', 'index.js')))
      assert.strictEqual(git(task.worktree, 'status', '--porcelain'), '')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('installs again where an install was cut short, though it left a node_modules', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task } = yield* taskIn(withPackages())
      yield* setUp(task.taskId)
      // As Althar quitting while Bun installs leaves it: the folder made, the package not yet in it, and nothing kept.
      rmSync(join(task.worktree, 'node_modules', 'greet'), { recursive: true, force: true })
      assert.isTrue(existsSync(join(task.worktree, 'node_modules')))
      yield* sql`UPDATE workspaces SET setup = NULL WHERE task_id = ${task.taskId}`
      const brief = yield* lead(task.threadId)
      assert.isTrue(existsSync(join(task.worktree, 'node_modules', 'greet', 'index.js')))
      assert.include(brief, `Althar set it up with \`${INSTALL}\`, and that went through`)
      assert.lengthOf(yield* setupItems(task.threadId), 2)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('runs the setup kept for the repository instead, and the lead’s first turn waits for it', () =>
    Effect.gen(function* () {
      const kept = `node -e "setTimeout(() => require('fs').writeFileSync('kept.txt', 'ready'), 1000)"`
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
      // A setup that finishes only once the test lets it.
      const gate = join(mkdtempSync(join(tmpdir(), 'althar-gate-')), 'open').replaceAll('\\', '/')
      const { task } = yield* taskIn(
        repository(),
        `node -e "const fs = require('fs'); const t = setInterval(() => fs.existsSync('${gate}') && (clearInterval(t), fs.writeFileSync('kept.txt', 'ready')), 20)"`,
      )
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code' })
      yield* sessions.stop(task.threadId)
      // Stopped while the setup still waits, so stopping didn't wait for it.
      assert.isFalse(existsSync(join(task.worktree, 'kept.txt')))
      assert.lengthOf(yield* turnsOf(task.threadId), 0)
      writeFileSync(gate, '')
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
      const failing = `node -e "console.log('resolving'); console.error('npm ERR! missing: left-pad'); process.exit(3)"`
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

  // Not on Windows: a setup runs in cmd.exe there, whatever shell the person has, so it always starts.
  it.live.skipIf(windows)('says a setup that couldn’t start, and starts the lead all the same', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(repository(), 'make deps')
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { command: 'make deps', code: null, timedOut: false })
      assert.match(workspace?.setup?.last ?? '', /^Althar couldn't start it: .*ENOENT/)
      const [ran] = yield* setupProcesses
      assert.strictEqual(ran?.state, 'unknown')
      assert.include(yield* lead(task.threadId), "Althar set it up with `make deps`, and it didn't finish.")
    }).pipe(Effect.provide(runtime(undefined, undefined, { setups: { shell: '/althar-no-such-folder/sh' } }))),
  )

  it.live('stops a setup that runs out of time, and the lead starts all the same', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(repository(), `node -e "console.log('waiting'); setTimeout(() => {}, 30000)"`)
      const [workspace] = yield* setUp(task.taskId)
      assert.deepInclude(workspace?.setup, { code: null, timedOut: true, last: 'waiting' })
      // Its process group is stopped, and recorded so.
      const [ran] = yield* setupProcesses
      assert.strictEqual(ran?.state, 'killed')
      yield* until(Effect.succeed([alive(ran?.pid ?? 0)]), ([up]) => up === false)
      assert.include(yield* lead(task.threadId), 'and it ran out of time and was stopped.')
    }).pipe(Effect.provide(runtime(undefined, undefined, { setups: { within: Duration.millis(500) } }))),
  )

  it.live('says a setup Althar quit during was stopped, and sets the worktree up again before its lead next starts', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-profile-')), 'althar.sqlite')
      // The first time it waits a long while; the next, it is quick.
      const slowOnce = `node -e "const fs = require('fs'); if (fs.existsSync('tried')) console.log('again'); else { fs.writeFileSync('tried', ''); console.log('started'); setTimeout(() => {}, 30000) }"`
      const first = yield* Effect.gen(function* () {
        const { task } = yield* taskIn(repository(), slowOnce)
        const [ran] = yield* until(setupProcesses, (rows) => rows[0]?.state === 'running')
        // Under way, not only launched: Node takes a moment to start, and stopped before, it would wait again next time.
        yield* until(
          Effect.map(workspacesOf(task.taskId), (rows) => rows.filter((row) => existsSync(join(row.path, 'tried')))),
          (rows) => rows.length > 0,
        )
        return { task, pid: ran?.pid ?? 0 }
      }).pipe(Effect.provide(runtime(file)))
      // Althar quit: the setup's process group stopped with it.
      yield* until(
        Effect.sync(() => [alive(first.pid)]),
        ([up]) => up === false,
      )
      yield* Effect.gen(function* () {
        const [stopped] = yield* setupItems(first.task.threadId)
        assert.deepInclude((stopped?.ended ?? {}) as object, { code: null, stopped: true })
        const [workspace] = yield* workspacesOf(first.task.taskId)
        assert.isNull(workspace?.setup)
        // Its lead's first turn sets it up again first.
        const brief = yield* lead(first.task.threadId)
        assert.include(brief, `Althar set it up with \`${slowOnce}\`, and that went through`)
        const [, again] = yield* setupItems(first.task.threadId)
        assert.deepInclude((again?.ended ?? {}) as object, { code: 0, stopped: false })
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('sets up again each worktree a reopening put back, though another of the task’s couldn’t be, once that one can', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const projects = yield* Projects
      const launches = yield* Launches
      const personId = (yield* Instance).personId
      const folder = folderOf('api', 'web')
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      for (const repository of ['api', 'web'])
        yield* launches.keep({
          projectId: project.projectId,
          repository,
          run: { command: 'node serve.js', setup: 'printf x >> setups.txt' },
          actorId: personId,
        })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Share the retry',
        repositories: ['api', 'web'],
      })
      const [api, web] = yield* setUp(task.taskId)
      const setups = (path: string | undefined) => readFileSync(join(path ?? '', 'setups.txt'), 'utf8')
      assert.deepStrictEqual([setups(api?.path), setups(web?.path)], ['x', 'x'])
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: task.taskId })
      // Both folders went, and web's branch too: reopening puts api back, then can't put web back.
      for (const path of [api?.path, web?.path]) rmSync(path ?? '', { recursive: true, force: true })
      git(join(folder, 'web'), 'worktree', 'prune')
      git(join(folder, 'web'), 'branch', '-D', task.branch)
      const refused = yield* Effect.flip(tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: task.taskId }))
      assert.deepInclude(refused, { why: 'branch_gone' })
      assert.isTrue(existsSync(api?.path ?? ''))
      assert.isNull((yield* workspacesOf(task.taskId))[0]?.setup)
      // The branch back, reopening puts web back too; api, there already, is still set up again.
      git(join(folder, 'web'), 'branch', task.branch, 'main')
      yield* tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: task.taskId })
      yield* setUp(task.taskId)
      assert.deepStrictEqual([setups(api?.path), setups(web?.path)], ['x', 'x'])
    }).pipe(Effect.provide(runtime())),
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
