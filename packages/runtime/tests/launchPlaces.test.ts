import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { thisDevice } from '../src/device'
import { callTool, repository, runtime, until } from './support'

/*
 * Where the project runs, at the edges launches.test.ts doesn't reach: a
 * project of several repositories, one that is a folder of a larger
 * repository, one whose repositories aren't on this computer, and runs that
 * end at once in ways of their own.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

/** A folder holding a repository for each name, each with a dev script that says which it is. */
const folderOf = (...names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path)
    git(path, 'init', '-q', '-b', 'main')
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name, scripts: { dev: `node -e "console.log('${name}')"` } }))
    git(path, 'add', '.')
    git(path, 'commit', '-q', '-m', 'Start')
  }
  return folder
}

/** The run cards in a thread, as a client reads them. */
const cardsIn = (where: { readonly threadId: string } | { readonly projectId: string }) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const { items } =
      'threadId' in where ? yield* Effect.orDie(queries.thread(where.threadId)) : yield* Effect.orDie(queries.coordinator(where.projectId))
    return items.flatMap((item) => (item.kind === 'run' ? [item.content] : []))
  })

const access = (role: 'coordinator' | 'lead', projectId: string): ToolAccess => ({
  role,
  projectId,
  threadId: 'none',
  sessionId: 'none',
  taskId: null,
})

describe('a project of several repositories', () => {
  it.live('asks which repository to keep a way to run for, and keeps one named', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const instance = yield* Instance
      const { projectId } = yield* open(folderOf('api', 'web'))
      assert.deepInclude(
        yield* Effect.flip(launches.keep({ projectId, run: { command: 'make', setup: null }, actorId: instance.personId })),
        {
          why: 'which',
          message: 'Say which repository it runs, as repository: api, web.',
        },
      )
      assert.deepInclude(
        yield* Effect.flip(launches.keepRunnable({ projectId, name: 'Docs', command: 'npm run docs', actorId: instance.personId })),
        { why: 'which', message: 'Say which repository it runs in, as repository: api, web.' },
      )
      const docs = yield* launches.keepRunnable({
        projectId,
        name: 'Docs',
        command: 'npm run docs',
        repository: 'web',
        actorId: instance.personId,
      })
      assert.deepStrictEqual(docs, { id: docs.id, name: 'Docs', repository: 'web' })
      // A lead keeps one for a repository it names, too.
      assert.match(
        yield* callTool(access('lead', projectId), 'keep_run', { name: 'Tests', command: 'npm test -- --watch', repository: 'api' }),
        /^Kept: Tests runs with `npm test -- --watch`\./,
      )
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, null)).map((one) => [one.name ?? one.command, one.repository]),
        [
          ['npm run dev', 'api'],
          ['npm run dev', 'web'],
          ['Docs', 'web'],
          ['Tests', 'api'],
        ],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("lists for a task only what runs in the repositories it changes, and won't run one of another", () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const projects = yield* Projects
      const instance = yield* Instance
      const { projectId } = yield* open(folderOf('api', 'web'))
      const tests = yield* launches.keepRunnable({
        projectId,
        name: 'Tests',
        command: 'npm test',
        repository: 'api',
        actorId: instance.personId,
      })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Restyle the page',
        repositories: ['web'],
      })
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, task.taskId)).map((one) => [one.command, one.repository]),
        [['npm run dev', 'web']],
      )
      assert.deepInclude(yield* Effect.flip(launches.start({ projectId, taskId: task.taskId, runnableId: tests.id, threadId: null })), {
        why: 'elsewhere',
        message: 'The task has no worktree of its repository here to run it in.',
      })
      // Of the default branch, with another repository named, the same.
      assert.deepInclude(
        yield* Effect.flip(launches.start({ projectId, taskId: null, runnableId: tests.id, repository: 'web', threadId: null })),
        { why: 'elsewhere', message: `Its repository has no copy on ${thisDevice()} to run it in.` },
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a project that is a folder of a larger repository', () => {
  it.live('runs from that folder, in a copy of the whole repository', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const instance = yield* Instance
      const root = repository()
      const app = join(root, 'apps', 'web')
      mkdirSync(app, { recursive: true })
      writeFileSync(join(app, 'index.html'), '<h1>Meridian</h1>\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Add the web app')
      const { projectId } = yield* open(app)
      const threadId = yield* (yield* Coordinator).thread(projectId)
      // It waits a moment after it prints, so what it printed is read before it ends: in Node, which a POSIX shell and
      // cmd.exe both run, so it prints the folder as this system writes it.
      yield* launches.keep({
        projectId,
        run: { command: 'node -e "console.log(process.cwd()); setTimeout(() => {}, 300)"', setup: null },
        actorId: instance.personId,
      })
      const started = yield* launches.start({ projectId, taskId: null, threadId })
      const [card] = yield* until(cardsIn({ projectId }), (all) => all[0]?.ended != null)
      assert.strictEqual(card?.launchId, started.id)
      // It printed where it ran: the project's folder, in Althar's copy of the default branch, not the person's checkout.
      const last = String((card?.ended as { last?: string } | undefined)?.last ?? '')
      assert.isTrue(last.endsWith(join('apps', 'web')), last)
      assert.include(last, `${join('.run', '')}`)
      assert.notInclude(last, root)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a project whose repositories are not on this computer', () => {
  it.live('has nothing to run, keep or list there, and says so', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const launches = yield* Launches
      const instance = yield* Instance
      const { projectId } = yield* open(repository())
      // Its repository is known only on another computer.
      yield* sql`DELETE FROM repository_locations WHERE project_id = ${projectId}`
      assert.deepInclude(yield* Effect.flip(launches.start({ projectId, taskId: null, threadId: null })), {
        why: 'elsewhere',
        message: `The project has no repository on ${thisDevice()} to run.`,
      })
      assert.deepInclude(
        yield* Effect.flip(launches.keep({ projectId, run: { command: 'make', setup: null }, actorId: instance.personId })),
        {
          why: 'elsewhere',
          message: `The project has no repository on ${thisDevice()} to keep a way to run.`,
        },
      )
      assert.deepInclude(
        yield* Effect.flip(launches.keepRunnable({ projectId, name: 'Docs', command: 'make docs', actorId: instance.personId })),
        { why: 'elsewhere', message: `The project has no repository on ${thisDevice()} to run it in.` },
      )
      assert.lengthOf(yield* launches.runnables(projectId, null), 0)
      assert.strictEqual(
        yield* callTool(access('coordinator', projectId), 'run_project', { run: 'Docs' }),
        'The project runs nothing called Docs. The project has nothing to run that Althar can tell.',
      )
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a run that ends at once', () => {
  it.live("can't run what only the person's own checkout says how to run, not the default branch", () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const path = repository()
      // Not committed: the default branch's copy has no package.json.
      writeFileSync(join(path, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.js' } }))
      const { projectId } = yield* open(path)
      assert.deepStrictEqual(
        (yield* launches.runnables(projectId, null)).map((one) => one.command),
        ['npm run dev'],
      )
      const refused = yield* Effect.flip(launches.start({ projectId, taskId: null, threadId: null }))
      assert.deepInclude(refused, { why: 'unknown' })
      assert.match(
        (refused as { message: string }).message,
        /^Althar can't tell how althar-repo-\w+ runs: it has no dev, start or serve script/,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  // Not on Windows, which ends a process by no signal.
  it.live.skipIf(process.platform === 'win32')('says how one killed by a signal ended, with no exit code', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const instance = yield* Instance
      const { projectId } = yield* open(repository())
      yield* launches.keep({ projectId, run: { command: 'kill -9 $$', setup: null }, actorId: instance.personId })
      assert.match(
        yield* callTool(access('coordinator', projectId), 'run_project', {}),
        /^`kill -9 \$\$` in a fresh copy of the default branch ended at once\. Its last lines:\n\n\(nothing\)\n/,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says how one that printed nothing ended, with no last line', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const instance = yield* Instance
      const projects = yield* Projects
      const { projectId } = yield* open(repository())
      // In a task's thread, its card says it ended by itself, with nothing printed to show: `exit 0`, as both a POSIX shell
      // and cmd.exe read it.
      const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Quiet' })
      yield* launches.keep({ projectId, run: { command: 'exit 0', setup: null }, actorId: instance.personId })
      yield* launches.start({ projectId, taskId: task.taskId, threadId: task.threadId })
      const [card] = yield* until(cardsIn({ threadId: task.threadId }), (all) => all[0]?.ended != null)
      assert.deepInclude(card?.ended as object, { code: 0, stopped: false, last: null })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live("tells an agent Althar couldn't run it where the task's worktree is gone from disk", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const launches = yield* Launches
      const projects = yield* Projects
      const instance = yield* Instance
      const { projectId } = yield* open(repository())
      const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Gone' })
      yield* launches.keepRunnable({ projectId, name: 'Echo', command: 'echo hello', actorId: instance.personId })
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      rmSync(worktree?.path ?? '', { recursive: true, force: true })
      assert.strictEqual(
        yield* callTool(access('coordinator', projectId), 'run_project', { task: 'gone', run: 'Echo' }),
        'Althar could not do that. Try again, or tell the person.',
      )
      // Nothing is left running, and its process is on the record as unknown.
      assert.lengthOf(yield* launches.ofProject(projectId), 0)
      const [row] = yield* sql<{ state: string }>`SELECT state FROM processes WHERE purpose = 'run'`
      assert.strictEqual(row?.state, 'unknown')
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('what runs, for how hard the machine works', () => {
  it.live('lists every run still running, by its process, and none that ended', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const instance = yield* Instance
      const projects = yield* Projects
      const { projectId } = yield* open(repository())
      yield* launches.keep({ projectId, run: { command: 'sleep 30', setup: null }, actorId: instance.personId })
      const running = yield* launches.start({ projectId, taskId: null, threadId: null })
      const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Ends' })
      const quick = yield* launches.keepRunnable({ projectId, name: 'Quick', command: 'true', actorId: instance.personId })
      const ended = yield* launches.start({ projectId, taskId: task.taskId, runnableId: quick.id, threadId: null })
      yield* until(launches.ofProject(projectId), (all) => all.find((one) => one.id === ended.id)?.ended != null)
      const processes = yield* launches.processes()
      assert.deepStrictEqual(
        processes.map((one) => [one.projectId, one.taskId]),
        [[projectId, null]],
      )
      assert.isAbove(processes[0]?.pid ?? 0, 0)
      yield* launches.stop(running.id)
      assert.lengthOf(yield* launches.processes(), 0)
    }).pipe(Effect.provide(withQueries())),
  )
})
