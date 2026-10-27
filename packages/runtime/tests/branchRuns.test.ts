import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig, withoutSignIns } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { Launches } from '../src/Launches'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, toolsOf, until } from './support'

/*
 * A branch or a pull request run with no task (ADR-062): Althar fetches it
 * itself from the remote, which nobody has pulled from, runs it in a copy of
 * its own, detached at what it got, and removes the copy as the run stops;
 * the person's checkout is untouched. And a lead, which carries no sign-in,
 * asks Althar to fetch a branch it hasn't got.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

/** A server that says where it answers, on a port of its own, and keeps running. */
const serving = (port: number) =>
  `console.log('  VITE ready')\nconsole.log('  ➜  Local:   http://localhost:${port}/')\nsetInterval(() => {}, 1000)\n`

/**
 * The person's repository, with a remote as a code host keeps one: a branch
 * someone else pushed, which the person never fetched, and a fork's pull
 * request at refs/pull/7/head. The commits each serves on a port of its own.
 */
const withRemote = () => {
  const path = repository()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', scripts: { dev: 'node serve.js' } }))
  writeFileSync(join(path, 'serve.js'), serving(5199))
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Serve')
  const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(path, 'remote', 'add', 'origin', remote)
  git(path, 'push', '-q', 'origin', 'main')
  // Someone else, in a clone of their own.
  const other = mkdtempSync(join(tmpdir(), 'althar-other-'))
  git(other, 'clone', '-q', remote, '.')
  git(other, 'switch', '-q', '-c', 'feature/find-a-pro')
  writeFileSync(join(other, 'serve.js'), serving(5201))
  git(other, 'commit', '-q', '-am', 'Add a services directory')
  git(other, 'push', '-q', 'origin', 'feature/find-a-pro')
  const branch = git(other, 'rev-parse', 'HEAD')
  // A fork's pull request: its commit is on no branch of the remote, only at the host's ref for it.
  git(other, 'switch', '-q', '--detach', 'main')
  writeFileSync(join(other, 'serve.js'), serving(5202))
  git(other, 'commit', '-q', '-am', 'Dark mode for the booking sheet')
  git(other, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head')
  const pull = git(other, 'rev-parse', 'HEAD')
  return { path, other, branch, pull }
}

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

/** The copies Althar keeps of a project's repositories for the branches it runs, each run's its own. */
const copiesOf = Effect.gen(function* () {
  const { worktreeRoot } = yield* RuntimeConfig
  return readdirSync(worktreeRoot).flatMap((project) => {
    const runs = join(worktreeRoot, project, '.runs')
    return existsSync(runs) ? readdirSync(runs).map((one) => join(runs, one)) : []
  })
})

/** Where a task's lead works: its worktree. */
const worktreeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
    return workspace?.path ?? ''
  })

const tasksIn = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string }>`SELECT id FROM tasks WHERE project_id = ${projectId}`
  })

describe('running a branch or a pull request', () => {
  it.live('fetches a branch nobody pulled, runs it in a copy of its own with no task, and removes the copy as it stops', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const { path, branch } = withRemote()
      const { projectId } = yield* open(path)
      const threadId = yield* (yield* Coordinator).thread(projectId)
      assert.throws(() => git(path, 'rev-parse', '--verify', '-q', 'origin/feature/find-a-pro'))
      const started = yield* launches.start({ projectId, taskId: null, threadId, ref: { kind: 'branch', name: 'feature/find-a-pro' } })
      assert.deepInclude(started, { taskId: null, branch: 'feature/find-a-pro', where: 'feature/find-a-pro', command: 'npm run dev' })
      // It is the branch's code that runs: it answers where that says.
      const [up] = yield* until(launches.ofProject(projectId), (all) => all[0]?.url != null)
      assert.strictEqual(up?.url, 'http://localhost:5201/')
      // In a copy detached at what Althar fetched, which is origin/feature/find-a-pro now.
      const [copy, ...others] = yield* copiesOf
      assert.lengthOf(others, 0)
      assert.strictEqual(git(copy ?? '', 'rev-parse', 'HEAD'), branch)
      assert.strictEqual(git(copy ?? '', 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
      assert.strictEqual(git(path, 'rev-parse', 'origin/feature/find-a-pro'), branch)
      // The person's checkout is as it was, with no branch of its own made, and there is no task.
      assert.strictEqual(git(path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
      assert.strictEqual(git(path, 'branch', '--list', 'feature/find-a-pro'), '')
      assert.lengthOf(yield* tasksIn(projectId), 0)
      // Its card names the branch, and keeps what was asked for, to run it again.
      const { items } = yield* Effect.orDie((yield* Queries).coordinator(projectId))
      const card = items.flatMap((item) => (item.kind === 'run' ? [item.content] : []))[0]
      assert.deepInclude(card, { branch: 'feature/find-a-pro', ref: { kind: 'branch', which: 'feature/find-a-pro' } })
      // Asked again while it runs, it is the same run; the default branch's is another.
      assert.strictEqual(
        (yield* launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'branch', name: 'feature/find-a-pro' } })).id,
        started.id,
      )
      const main = yield* launches.start({ projectId, taskId: null, threadId: null })
      assert.notStrictEqual(main.id, started.id)
      assert.isNull(main.branch)
      yield* launches.stop(main.id)
      // Stopped, its copy goes.
      yield* launches.stop(started.id)
      assert.isFalse(existsSync(copy ?? ''))
      assert.lengthOf(yield* copiesOf, 0)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('runs a fork’s pull request from the host’s ref for it, and removes its copy once it ends by itself', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const { path, other, pull } = withRemote()
      // This commit, once fetched, ends at once: its copy goes with it.
      writeFileSync(join(other, 'serve.js'), "console.log('  ➜  Local:   http://localhost:5203/')\nprocess.exit(4)\n")
      git(other, 'commit', '-q', '-am', 'Ends')
      git(other, 'push', '-q', '-f', 'origin', 'HEAD:refs/pull/8/head')
      const { projectId } = yield* open(path)
      const started = yield* launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'pull_request', which: '#7' } })
      assert.deepInclude(started, { taskId: null, branch: 'PR #7' })
      const [up] = yield* until(launches.ofProject(projectId), (all) => all[0]?.url != null)
      assert.strictEqual(up?.url, 'http://localhost:5202/')
      const [copy] = yield* copiesOf
      assert.strictEqual(git(copy ?? '', 'rev-parse', 'HEAD'), pull)
      assert.strictEqual(git(path, 'rev-parse', 'refs/althar/pull/7'), pull)
      yield* launches.stop(started.id)
      assert.isFalse(existsSync(copy ?? ''))

      const ends = yield* launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'pull_request', which: '8' } })
      yield* until(launches.ofProject(projectId), (all) => all.find((one) => one.id === ends.id)?.ended != null)
      yield* until(copiesOf, (left) => left.length === 0)
    }).pipe(Effect.provide(withQueries())),
  )

  it.effect('refuses a branch the remote hasn’t got, naming those like it, and leaves no copy', () =>
    Effect.gen(function* () {
      const launches = yield* Launches
      const { path } = withRemote()
      const { projectId } = yield* open(path)
      const refused = yield* Effect.flip(
        launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'branch', name: 'feature/find-a-pr' } }),
      )
      assert.deepInclude(refused, {
        why: 'fetch',
        message: 'origin has no branch called feature/find-a-pr. Branches like it: feature/find-a-pro.',
      })
      assert.lengthOf(yield* copiesOf, 0)
      assert.lengthOf(yield* launches.ofProject(projectId), 0)
      // Nor a pull request it has no ref for.
      const none = yield* Effect.flip(
        launches.start({ projectId, taskId: null, threadId: null, ref: { kind: 'pull_request', which: '99' } }),
      )
      assert.include((none as { message: string }).message, 'origin has no pull request #99')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('the coordinator runs a branch when the person asks to start one, rather than starting a task', () =>
    Effect.gen(function* () {
      const { path, branch } = withRemote()
      const { projectId } = yield* open(path)
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: yield* (yield* Coordinator).thread(projectId),
        sessionId: 'none',
        taskId: null,
      }
      const tool = (yield* toolsOf(coordinator)).find((one) => one.name === 'run_project')
      assert.include(tool?.description, 'when the person asks to start, run, try or see a branch or a pull request')
      assert.include(tool?.description, 'rather than starting a task')
      assert.includeMembers(tool?.properties ?? [], ['branch', 'pull_request', 'task'])
      const said = yield* callTool(coordinator, 'run_project', { branch: 'feature/find-a-pro' })
      assert.include(said, `a copy of feature/find-a-pro at ${branch.slice(0, 12)}, fetched just now`)
      assert.include(said, 'localhost:5201')
      assert.lengthOf(yield* tasksIn(projectId), 0)
      assert.include(yield* callTool(coordinator, 'run_project', { branch: 'x', task: 'y' }), 'Give one of task, branch or pull_request.')
      const launches = yield* Launches
      for (const one of yield* launches.ofProject(projectId)) yield* launches.stop(one.id)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a lead asking Althar to fetch', () => {
  it.live('fetches a branch into the lead’s repository, so origin/<branch> is current, and says the commit', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const { path, other } = withRemote()
      const { projectId } = yield* open(path)
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Find a pro' }),
        projectId,
        title: 'Find a pro',
      })
      const lead: ToolAccess = { role: 'lead', projectId, threadId: task.threadId, sessionId: 'none', taskId: task.taskId }
      // A fresher commit on the branch than any here.
      git(other, 'switch', '-q', 'feature/find-a-pro')
      writeFileSync(join(other, 'directory.txt'), 'plumbers\n')
      git(other, 'add', '.')
      git(other, 'commit', '-q', '-m', 'List plumbers')
      git(other, 'push', '-q', 'origin', 'feature/find-a-pro')
      const latest = git(other, 'rev-parse', 'HEAD')
      const tool = (yield* toolsOf(lead)).find((one) => one.name === 'fetch_from_remote')
      assert.include(tool?.description, 'with its own sign-in')
      const said = yield* callTool(lead, 'fetch_from_remote', { branch: 'feature/find-a-pro' })
      assert.include(said, `origin/feature/find-a-pro is at ${latest.slice(0, 12)} (List plumbers)`)
      assert.include(said, 'git switch -c feature/find-a-pro origin/feature/find-a-pro --no-track')
      // The worktree shares the repository's refs: the lead sees it at once.
      assert.strictEqual(git(yield* worktreeOf(task.taskId), 'rev-parse', 'origin/feature/find-a-pro'), latest)
      assert.include(yield* callTool(lead, 'fetch_from_remote', { branch: 'nope' }), 'origin has no branch called nope')
      assert.include(yield* callTool(lead, 'fetch_from_remote', { pull_request: 7 }), 'refs/althar/pull/7')
    }).pipe(Effect.provide(withQueries())),
  )

  it('makes a branch from a remote’s in a lead’s worktree with no write to the repository’s config', () => {
    const { path } = withRemote()
    git(path, 'fetch', '-q', 'origin')
    const worktree = mkdtempSync(join(tmpdir(), 'althar-lead-'))
    git(path, 'worktree', 'add', '-q', '--detach', worktree, 'main')
    const before = readFileSync(join(path, '.git', 'config'), 'utf8')
    // As a lead runs git: with the environment Althar gives it, and none of the person's sign-ins.
    execFileSync('git', ['switch', '-q', '-c', 'feature/find-a-pro', 'origin/feature/find-a-pro'], {
      cwd: worktree,
      env: { ...process.env, ...withoutSignIns(mkdtempSync(join(tmpdir(), 'althar-signed-out-'))) },
    })
    assert.strictEqual(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/find-a-pro')
    // No upstream was set: that write is what an agent's sandbox refused.
    assert.strictEqual(readFileSync(join(path, '.git', 'config'), 'utf8'), before)
  })
})
