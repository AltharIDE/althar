import { slashPath } from '@althar/testing'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { vi } from 'vitest'

import * as spawner from '../src/spawner'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { ShipRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { removeWorktree } from '../src/worktreeRemoval'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * The edges of a task's several changes (a task is a conversation plus
 * parts): what Keep them together, Drop it and removing the worktree refuse,
 * and why, and what they carry; a change pointed at another branch whose
 * commits conflict there; a stack whose bottom can't merge yet, whose host
 * won't point the one above elsewhere, or whose tweak held below holds
 * nothing above that doesn't carry it; a change that waited for another to
 * merge and can't bring it in, and whose failing checks are that one's;
 * Ship of one change, with what waits beneath it; and what Althar says and
 * follows when its lead leaves a folder on no branch, switches it back, or
 * opens a pull request into another branch.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
const as = ['-c', 'user.name=Person', '-c', 'user.email=person@althar.test']

const commit = (path: string, file: string, line: string, subject = line) => {
  writeFileSync(join(path, file), `${line}\n`)
  git(path, 'add', file)
  git(path, ...as, 'commit', '-q', '-m', subject)
}

/** A repository on GitHub, with a release branch past main, on the host and as this clone last fetched it. */
const onGitHub = (release: Readonly<Record<string, string>> = {}) => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  if (Object.keys(release).length > 0) {
    git(working, 'switch', '-q', '-c', 'release/0.8.0')
    for (const [file, line] of Object.entries(release)) writeFileSync(join(working, file), `${line}\n`)
    git(working, 'add', '-A')
    git(working, ...as, 'commit', '-q', '-m', 'Release notes')
    git(working, 'push', '-q', bare, 'release/0.8.0')
    git(working, 'update-ref', 'refs/remotes/origin/release/0.8.0', 'release/0.8.0')
    git(working, 'switch', '-q', 'main')
  }
  return { working, bare, github }
}

const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const host = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...host, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...host, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A planned task whose lead did its part and whose draft pull request opened, with no review. */
const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    const [first] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    return {
      projectId: project.projectId,
      taskId: card.taskId,
      threadId: card.threadId,
      path: first?.path ?? '',
      lead: {
        role: 'lead' as const,
        projectId: project.projectId,
        threadId: card.threadId,
        sessionId: lead?.id ?? '',
        taskId: card.taskId,
      },
    }
  })

const workspacesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      name: string | null
      branch: string
      path: string
      toward: string | null
      state: string
    }>`SELECT id, name, branch, path, toward, state FROM workspaces WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

const changeOf = (taskId: string, name: string) =>
  Effect.map(workspacesOf(taskId), (all) => all.find((one) => one.name === name) ?? assert.fail(`no change ${name}`))

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** What the lead was told, quietly, by Althar. */
const told = (threadId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY rowid`,
  )

/** What the person says to the task's lead, and its turn ended. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const sql = yield* SqlClient.SqlClient
    const before = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${threadId}`)[0]?.n ?? 0
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
      (rows) => rows.length > before && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
  })

/**
 * The task's Ship, pressed once its lead is done, as the person can: it refuses while a turn is under way. What it
 * refused for anything else, or 'shipped'.
 */
const pressShip = (taskId: string, change?: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    return yield* until(
      Effect.gen(function* () {
        return yield* runs
          .ship({ envelope: yield* Runtime.envelope('task.ship', { taskId }), taskId, ...(change === undefined ? {} : { change }) })
          .pipe(
            Effect.as<unknown>('shipped'),
            Effect.catch((refused) => Effect.succeed(refused instanceof ShipRefused && refused.why === 'working' ? 'working' : refused)),
          )
      }),
      (pressed) => pressed !== 'working',
    )
  })
/** The task's Ship, pressed as the person does, which ships. */
const ship = (taskId: string, change?: string) =>
  Effect.flatMap(pressShip(taskId, change), (pressed) => (pressed === 'shipped' ? Effect.void : Effect.die(pressed)))

/** A task whose first change has its pull request, with a change stacked on it whose own pull request Ship opened, into its branch. */
const stacked = (working: string, github: FakeService) =>
  Effect.gen(function* () {
    const task = yield* opened(working)
    yield* callTool(task.lead, 'start_change', { name: 'Lane heights', on: 'althar/add-a-retry' })
    const above = (yield* changeOf(task.taskId, 'Lane heights')).path
    commit(above, 'lanes.txt', 'taller', 'Taller lanes')
    yield* ship(task.taskId)
    yield* until(
      Effect.sync(() => github.changes.length),
      (count) => count === 2,
    )
    // A host-visible pull request precedes Ship's hold release and completion. Later fixture commits must start after
    // that boundary; commits made while Ship still owns publication deliberately wait for another Ship.
    yield* until(
      (yield* SqlClient.SqlClient)<{ state: string }>`
        SELECT state FROM runs WHERE task_id = ${task.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      (rows) => rows[0]?.state === 'succeeded',
    )
    return { ...task, above, url: github.changes[1]?.url ?? '' }
  })

describe('keeping a task’s changes together', () => {
  it.live('refuses a change it doesn’t have, one with nothing to go into, and one whose pull request opened, saying why', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Nowhere' }),
        'The task has no change “Nowhere” here to keep together with another.',
      )
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      // The only other change has its pull request: there is nothing it can go into unless one is named.
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Lane heights' }),
        "Name the change of the task's to keep “Lane heights” together with: one in the same repository.",
      )
      // Named, by its branch, it is refused all the same: changes go together only before either ships.
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Lane heights', into: 'althar/add-a-retry' }),
        'the task’s first change has a pull request already: changes go together only before either ships.',
      )
      assert.lengthOf(
        (yield* workspacesOf(task.taskId)).filter((one) => one.state === 'ready'),
        2,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('waits for what isn’t committed, leaves both as they were on a conflict, and carries several commits over', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      yield* callTool(task.lead, 'start_change', { name: 'Lane colours' })
      const heights = yield* changeOf(task.taskId, 'Lane heights')
      const colours = yield* changeOf(task.taskId, 'Lane colours')
      commit(heights.path, 'lanes.txt', 'taller', 'Taller lanes')
      writeFileSync(join(colours.path, 'palette.txt'), 'teal\n')
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Lane heights', into: 'Lane colours' }),
        "Commit what's changed in “Lane colours” first (palette.txt).",
      )
      git(colours.path, 'add', 'palette.txt')
      git(colours.path, ...as, 'commit', '-q', '-m', 'Teal lanes')
      // Both change the same file: neither moves.
      commit(colours.path, 'lanes.txt', 'wider', 'Wider lanes')
      const before = git(colours.path, 'rev-parse', 'HEAD')
      assert.strictEqual(
        yield* callTool(task.lead, 'join_changes', { change: 'Lane heights', into: 'Lane colours' }),
        "“Lane heights”'s commits conflict with “Lane colours” in lanes.txt: both stay as they were.",
      )
      assert.strictEqual(git(colours.path, 'rev-parse', 'HEAD'), before)
      assert.strictEqual(git(colours.path, 'status', '--porcelain'), '')
      assert.isTrue(existsSync(heights.path))

      // Another, of two commits, goes onto it whole.
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = yield* changeOf(task.taskId, 'Docs')
      commit(docs.path, 'docs.md', 'how lanes look', 'Docs')
      commit(docs.path, 'more.md', 'and why', 'More docs')
      // A missing common-directory lookup falls back to the destination repository; busy removal still retries.
      const spawn = spawner.startApart
      let refusals = 0
      let missingRoot = 0
      const refusing = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
        const [command] = args
        if (command.command === 'git' && command.cwd === docs.path && command.args.includes('--git-common-dir')) {
          missingRoot++
          return {
            result: Promise.resolve({
              code: 128,
              signal: null,
              error: null,
              over: false,
              stdout: '',
              stderr: 'Common directory unavailable',
            }),
            stop: () => undefined,
          }
        }
        if (command.command === 'git' && command.args.includes('remove') && command.args.includes(docs.path)) {
          refusals++
          return {
            result: Promise.resolve({ code: 128, signal: null, error: null, over: false, stdout: '', stderr: 'Permission denied' }),
            stop: () => undefined,
          }
        }
        return spawn(...args)
      })
      const joined = yield* callTool(task.lead, 'join_changes', { change: 'Docs', into: 'Lane colours' }).pipe(
        Effect.ensuring(Effect.sync(() => refusing.mockRestore())),
      )
      assert.include(joined, 'Kept “Docs” together with “Lane colours”')
      assert.strictEqual(refusals, 2)
      assert.strictEqual(missingRoot, 1)
      assert.notInclude(git(working, 'worktree', 'list', '--porcelain'), slashPath(docs.path))
      assert.strictEqual(git(colours.path, 'log', '-2', '--format=%s'), 'More docs\nDocs')
      assert.isFalse(existsSync(docs.path))
      assert.include(yield* notices(task.threadId), "Kept together: Docs's 2 commits are on althar/lane-colours now.")
      const heard = yield* until(told(task.threadId), (rows) => rows.some((row) => row.body.startsWith('“Docs” is kept together')))
      assert.include(
        heard.find((row) => row.body.startsWith('“Docs” is kept together'))?.body ?? '',
        `its 2 commits are on althar/lane-colours, in ${colours.path}. Its folder went; its branch, althar/docs, stays.`,
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('dropping one of a task’s changes', () => {
  it.live('leaves folders and rows alone when git refuses cleanup for an unrelated reason', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Kept docs' })
      yield* callTool(task.lead, 'start_change', { name: 'Refused docs' })
      const docs = yield* changeOf(task.taskId, 'Refused docs')
      const spawn = spawner.startApart
      let refusals = 0
      const refusing = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
        const [command] = args
        if (command.command === 'git' && command.args.includes('remove') && command.args.includes(docs.path)) {
          refusals++
          return {
            result: Promise.resolve({
              code: 128,
              signal: null,
              error: null,
              over: false,
              stdout: '',
              stderr: 'fatal: refusing to remove worktree',
            }),
            stop: () => undefined,
          }
        }
        return spawn(...args)
      })
      yield* Effect.gen(function* () {
        assert.include(yield* callTool(task.lead, 'join_changes', { change: 'Refused docs', into: 'Kept docs' }), 'Nothing was done')
        assert.include(
          yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: 'Refused docs', why: 'Not needed.' }),
          'Nothing was done',
        )
      }).pipe(Effect.ensuring(Effect.sync(() => refusing.mockRestore())))
      assert.strictEqual(refusals, 4)
      assert.isTrue(existsSync(docs.path))
      assert.strictEqual((yield* changeOf(task.taskId, 'Refused docs')).state, 'ready')
      assert.include(git(working, 'worktree', 'list', '--porcelain'), slashPath(docs.path))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('removes a busy dropped worktree while keeping its uncommitted work on its branch', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Busy docs' })
      const docs = yield* changeOf(task.taskId, 'Busy docs')
      writeFileSync(join(docs.path, 'docs.md'), 'Keep this draft.\n')
      const spawn = spawner.startApart
      let refusals = 0
      const refusing = vi.spyOn(spawner, 'startApart').mockImplementation((...args) => {
        const [command] = args
        if (command.command === 'git' && command.args.includes('remove') && command.args.includes(docs.path)) {
          refusals++
          return {
            result: Promise.resolve({ code: 128, signal: null, error: null, over: false, stdout: '', stderr: 'Directory not empty' }),
            stop: () => undefined,
          }
        }
        return spawn(...args)
      })
      const dropped = yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: 'Busy docs', why: 'Not needed.' }).pipe(
        Effect.ensuring(Effect.sync(() => refusing.mockRestore())),
      )
      assert.include(dropped, 'Dropped “Busy docs”')
      assert.strictEqual(refusals, 2)
      assert.isFalse(existsSync(docs.path))
      assert.strictEqual((yield* changeOf(task.taskId, 'Busy docs')).state, 'cleaned')
      assert.notInclude(git(working, 'worktree', 'list', '--porcelain'), slashPath(docs.path))
      assert.strictEqual(git(working, 'show', `${docs.branch}:docs.md`), 'Keep this draft.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('preserves worktree locks even when their reason mentions a filesystem error', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Unlocked docs' })
      yield* callTool(task.lead, 'start_change', { name: 'Locked docs' })
      const docs = yield* changeOf(task.taskId, 'Locked docs')
      for (const reason of ['permission denied', 'resource busy', 'directory not empty']) {
        git(working, 'worktree', 'lock', '--reason', reason, docs.path)
        for (const [tool, args] of [
          ['join_changes', { change: 'Locked docs', into: 'Unlocked docs' }],
          ['remove_part', { part: 'workspace', name: 'Locked docs', why: 'Not needed.' }],
        ] as const) {
          assert.include(yield* callTool(task.lead, tool, args), 'Nothing was done')
          assert.isTrue(existsSync(docs.path))
          assert.strictEqual((yield* changeOf(task.taskId, 'Locked docs')).state, 'ready')
        }
        git(working, 'worktree', 'unlock', docs.path)
      }
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('refuses one it doesn’t have and the only one, and stops following the pull request of one dropped', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const remove = (name: string) => callTool(task.lead, 'remove_part', { part: 'workspace', name, why: 'Not needed.' })
      assert.strictEqual(yield* remove('Nowhere'), 'The task has no change “Nowhere” here.')
      assert.strictEqual(
        yield* remove('althar/add-a-retry'),
        "the task’s first change is the task's only change: its lead needs a folder. Remove the task's worktree instead, which keeps its branch.",
      )
      // Two more: one ships and merges, the other has nothing yet.
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      yield* callTool(task.lead, 'start_change', { name: 'Card sizes' })
      const docs = yield* changeOf(task.taskId, 'Docs')
      commit(docs.path, 'docs.md', 'how it retries', 'Docs')
      yield* ship(task.taskId, 'Docs')
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      squashMerge(bare, 'althar/docs')
      github.mergeByHand(2)
      yield* (yield* Changes).refresh(task.taskId)
      // The merged one goes as any does; the task's first, its pull request open, is followed no more once it goes.
      assert.include(yield* remove('Docs'), 'Dropped “Docs”')
      assert.isFalse(existsSync(docs.path))
      assert.include(yield* remove('althar/add-a-retry'), 'Dropped “althar/add-a-retry”')
      assert.isFalse(existsSync(task.path))
      assert.include(yield* notices(task.threadId), 'Dropped althar/add-a-retry: its folder went, althar/add-a-retry stays.')
      const [first] = yield* sql<{ listening: number }>`SELECT listening FROM external_links WHERE url = ${github.changes[0]?.url ?? ''}`
      assert.strictEqual(first?.listening, 0)
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.include(git(working, 'branch', '--list', 'althar/add-a-retry'), 'althar/add-a-retry')
      assert.deepStrictEqual(
        (yield* workspacesOf(task.taskId)).filter((one) => one.state === 'ready').map((one) => one.name),
        ['Card sizes'],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('gives the folder back to the change its lead left it for, what the dropped one hadn’t committed committed first', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      git(task.path, 'switch', '-q', '-c', 'althar/spike')
      commit(task.path, 'spike.txt', 'try it', 'Spike')
      yield* say(task.threadId, 'How is it going?')
      yield* until(workspacesOf(task.taskId), (all) => all.length === 2 && all[1]?.state === 'ready')
      writeFileSync(join(task.path, 'half.txt'), 'half\n')
      assert.include(
        yield* callTool(task.lead, 'remove_part', { part: 'workspace', name: 'althar/spike', why: 'A dead end.' }),
        'Dropped “althar/spike”',
      )
      // The folder is the first change's again, on its branch; the spike's branch keeps all of its work.
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'althar/add-a-retry')
      assert.isFalse(existsSync(join(task.path, 'half.txt')))
      assert.strictEqual(git(working, 'log', '-1', '--format=%s', 'althar/spike'), 'Work in progress, as its change was dropped')
      const [first, spike] = yield* workspacesOf(task.taskId)
      assert.deepStrictEqual([first?.state, first?.path, spike?.state], ['ready', task.path, 'cleaned'])
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('removing a task’s worktree', () => {
  it.live('is refused with several changes, and where there is no worktree', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      assert.strictEqual(
        yield* callTool(task.lead, 'remove_part', { part: 'workspace', why: 'Only reading now.' }),
        'The task has several changes: name the one to drop.',
      )
      // A task to work Local, not started, has no worktree to remove.
      const projects = yield* Projects
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Later' }),
        projectId: task.projectId,
        title: 'Later',
        worksIn: 'checkout',
      })
      const refused = yield* Effect.flip((yield* Changes).leaveWorktree(other.taskId, (yield* Instance).personId))
      assert.strictEqual((refused as { message?: string }).message, 'The task has no worktree here to remove.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('commits what it hadn’t first, and its lead hears so', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      writeFileSync(join(task.path, 'notes.txt'), 'half done\n')
      assert.include(yield* callTool(task.lead, 'remove_part', { part: 'workspace', why: 'Only reading now.' }), 'is a copy now')
      assert.strictEqual(
        git(working, 'log', '-1', '--format=%s', 'althar/add-a-retry'),
        'Work in progress, as the task’s worktree was removed',
      )
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')
      const heard = yield* until(told(task.threadId), (rows) => rows.some((row) => row.body.startsWith("The task's worktree was removed")))
      assert.include(
        heard.find((row) => row.body.startsWith("The task's worktree was removed"))?.body ?? '',
        'and althar/add-a-retry keeps all of it, what you hadn’t committed committed first.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('pointing a running task’s change at another branch', () => {
  it.live('changes nothing for the branch it works toward already, a branch there isn’t, or work not committed', () => {
    const { working, github } = onGitHub({ 'RELEASE.md': '0.8.0' })
    return Effect.gen(function* () {
      const task = yield* opened(working)
      assert.include(yield* callTool(task.lead, 'work_toward', { toward: 'main' }), 'works toward that already: nothing changed.')
      assert.include(
        yield* callTool(task.lead, 'work_toward', { toward: 'release/9.9.9' }),
        'has no branch release/9.9.9, on its remote or here.',
      )
      writeFileSync(join(task.path, 'notes.txt'), 'half done\n')
      assert.match(
        yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0' }),
        /^Commit what's changed in .+ first \(notes\.txt\): then it moves\.$/,
      )
      assert.strictEqual((yield* workspacesOf(task.taskId))[0]?.toward, null)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('stops a rebase at its conflicts for the lead, and leaves a pushed change where it was when its commits conflict', () => {
    const { working, github } = onGitHub({ 'RELEASE.md': '0.8.0', 'change.txt': 'release' })
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = yield* changeOf(task.taskId, 'Docs')
      commit(docs.path, 'RELEASE.md', 'docs', 'Docs')
      // Nothing of it pushed, it is rebased, and stops on the file both change: the lead finishes it.
      const said = yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0', change: 'Docs' })
      assert.match(said, /works toward release\/0\.8\.0 now, but rebasing onto it stopped on conflicts in RELEASE\.md\.$/)
      assert.strictEqual((yield* changeOf(task.taskId, 'Docs')).toward, 'release/0.8.0')
      assert.strictEqual(git(docs.path, 'diff', '--name-only', '--diff-filter=U'), 'RELEASE.md')
      const warned = (yield* items(task.threadId)).findLast((item) => item.kind === 'notice')
      assert.strictEqual(warned?.content.severity, 'warning')
      // Pushed, its commits go onto a fresh branch, which conflicts too: it stays as it was.
      const before = (yield* workspacesOf(task.taskId))[0] ?? assert.fail('no workspace')
      assert.match(
        yield* callTool(task.lead, 'work_toward', { toward: 'release/0.8.0' }),
        /still works toward main: its commits conflict with release\/0\.8\.0 in change\.txt\.$/,
      )
      const after = (yield* workspacesOf(task.taskId))[0]
      assert.deepStrictEqual([after?.branch, after?.toward], [before.branch, null])
      assert.strictEqual(git(task.path, 'rev-parse', '--abbrev-ref', 'HEAD'), before.branch)
      assert.strictEqual(git(working, 'branch', '--list', `${before.branch}-2`), '')
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a stack of changes', () => {
  it.live('says the one above merges once the one below has, while the one below waits in its merge queue', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* stacked(working, github)
      github.mergeQueue()
      yield* (yield* Changes).merge(task.taskId, github.changes[1]?.headSha ?? '', task.url)
      assert.deepStrictEqual(
        github.merged.map((one) => [one.number, one.how]),
        [[1, 'queue']],
      )
      assert.strictEqual(github.changes[1]?.state, 'open')
      assert.include(yield* notices(task.threadId), 'PR #2 merges once PR #1 below it has: press Merge again then.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('says to point the one above by hand where its host won’t, once the one below merges', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* stacked(working, github)
      github.failNext('editChange', 'rejected')
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(notices(task.threadId), (said) =>
        said.includes('PR #1 merged, but the pull request stacked on it still goes into althar/add-a-retry: point it at main on its host.'),
      )
      assert.strictEqual(github.changes[1]?.target, 'althar/add-a-retry')
      // Its change works toward main from here all the same.
      assert.strictEqual((yield* changeOf(task.taskId, 'Lane heights')).toward, null)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('has a change stacked on one that merges work toward what it went into, with no pull request of its own to point', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights', on: 'althar/add-a-retry' })
      assert.strictEqual((yield* changeOf(task.taskId, 'Lane heights')).toward, 'althar/add-a-retry')
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(changeOf(task.taskId, 'Lane heights'), (one) => one.toward === null)
      assert.isFalse((yield* notices(task.threadId)).some((title) => title.includes('goes into main now')))
      // Merged already, Merge as it stands does nothing more.
      yield* (yield* Changes).mergeAsItStands(task.taskId, github.changes[0]?.url ?? '')
      assert.lengthOf(github.merged, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('holds a pull request from opening past what waits for Ship, and not a change above that doesn’t carry it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* stacked(working, github)
      // The lead's commit on the change above, before the person's word commits a tweak on the one below.
      commit(task.above, 'lanes.txt', 'taller still', 'Taller still')
      const head = git(task.above, 'rev-parse', 'HEAD')
      yield* say(task.threadId, 'Make it retry twice. [lead:commit]')
      yield* until(
        sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE path = ${task.path}`,
        (rows) => rows[0]?.heldAt != null,
      )
      const [run] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${task.taskId} ORDER BY created_at DESC LIMIT 1`
      const refused = yield* Effect.flip(
        (yield* Changes).publish({ projectId: task.projectId as ProjectId, taskId: task.taskId, runId: run?.id ?? '', end: 'draft' }),
      )
      assert.isTrue(refused instanceof ShipRefused && refused.why === 'held')
      // The change above hasn't taken in the tweak below: what its lead committed there goes up on its own, held by nothing.
      yield* until(
        Effect.sync(() => git(bare, 'rev-parse', 'althar/lane-heights')),
        (now) => now === head,
      )
      const [above] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE path = ${task.above}`
      assert.isNull(above?.heldAt ?? null)
      assert.include(yield* callTool(task.lead, 'push_to_pull_request', { pull_request: 2 }), "so there's nothing new to push.")
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a change that waits for another to merge', () => {
  it.live('waits no more once it merges, saying where bringing it in conflicts', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Release notes', waits_for: 'althar/add-a-retry' })
      yield* callTool(task.lead, 'start_change', { name: 'Changelog', waits_for: 'althar/add-a-retry' })
      const changelog = yield* changeOf(task.taskId, 'Changelog')
      commit(changelog.path, 'NOTES.md', 'changelog', 'Changelog')
      // Main moves on meanwhile, in the same file.
      commit(working, 'NOTES.md', 'main', 'Notes on main')
      git(working, 'push', '-q', bare, 'HEAD:main')
      git(working, 'remote', 'set-url', 'origin', bare)
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(
        sql<{ waitsFor: string | null }>`SELECT waits_for FROM workspaces WHERE task_id = ${task.taskId} AND name IS NOT NULL`,
        (rows) => rows.length === 2 && rows.every((row) => row.waitsFor === null),
      )
      const said = yield* until(notices(task.threadId), (lines) => lines.filter((line) => line.startsWith('PR #1 merged: ')).length === 2)
      assert.include(said, 'PR #1 merged: Release notes has main in now, and waits no more.')
      assert.include(said, 'PR #1 merged: Changelog waits no more, but bringing main in conflicts; its lead brings it in.')
      // Left as it was, for its lead.
      assert.strictEqual(git(changelog.path, 'status', '--porcelain'), '')
      assert.strictEqual(git(changelog.path, 'log', '-1', '--format=%s'), 'Changelog')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('waits no more once it merges, saying where what it went into can’t be brought in', () => {
    const { working, bare } = hosted()
    // Where pushes go, and Althar fetches from: the host, until it can't be reached.
    const reach = { to: bare }
    const github = makeFakeService({ pushUrl: () => reach.to })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Release notes', waits_for: 'althar/add-a-retry' })
      squashMerge(bare, 'althar/add-a-retry')
      github.mergeByHand(1)
      // The host's git can't be reached as it merges, and main isn't here as last fetched: there is nothing to bring in.
      reach.to = join(bare, 'gone')
      git(working, 'update-ref', '-d', 'refs/remotes/origin/main')
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(notices(task.threadId), (lines) =>
        lines.includes('PR #1 merged: Release notes waits no more, but bringing main in didn’t work; its lead brings it in.'),
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a change that waits for another to merge, shipped', () => {
  it.live('leaves its failing checks to the change it waits for, as the lead hears the other’s', () => {
    const { working, bare } = hosted()
    // A host that can't run a check again: what fails goes to the lead at once.
    const github = makeFakeService({ pushUrl: () => bare, reruns: false })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Release notes', waits_for: 'althar/add-a-retry' })
      commit((yield* changeOf(task.taskId, 'Release notes')).path, 'NOTES.md', 'retries', 'Release notes')
      yield* ship(task.taskId, 'Release notes')
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      github.setChecks(1, [{ name: 'lint', state: 'failed' }])
      github.setChecks(2, [{ name: 'test', state: 'failed' }])
      yield* (yield* Changes).refresh(task.taskId)
      const heard = yield* until(told(task.threadId), (rows) => rows.some((row) => row.body.includes('Checks failed on PR #1')))
      assert.isFalse(heard.some((row) => row.body.includes('Checks failed on PR #2')))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('shipping one change of several', () => {
  it.live('ships it with what waits beneath it in its stack, bottom first, and refuses one the task doesn’t have', () => {
    const { working, github } = onGitHub({ 'RELEASE.md': '0.8.0' })
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Lane heights' })
      yield* callTool(task.lead, 'start_change', { name: 'Lane colours', on: 'Lane heights' })
      yield* callTool(task.lead, 'start_change', { name: 'Card sizes' })
      commit((yield* changeOf(task.taskId, 'Lane heights')).path, 'lanes.txt', 'taller', 'Taller lanes')
      commit((yield* changeOf(task.taskId, 'Lane colours')).path, 'colours.txt', 'teal', 'Teal lanes')
      const refused = yield* pressShip(task.taskId, 'Nowhere')
      assert.strictEqual((refused as { message?: string }).message, 'The task has no change “Nowhere” here.')
      yield* ship(task.taskId, 'lane colours')
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 3,
      )
      assert.deepStrictEqual(
        github.changes.slice(1).map((one) => [one.source, one.target]),
        [
          ['althar/lane-heights', 'main'],
          ['althar/lane-colours', 'althar/lane-heights'],
        ],
      )
      // One working toward a branch no change has ships alone.
      yield* callTool(task.lead, 'start_change', { name: 'Backport', toward: 'release/0.8.0' })
      commit((yield* changeOf(task.taskId, 'Backport')).path, 'backport.txt', 'back', 'Backport')
      yield* ship(task.taskId, 'Backport')
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 4,
      )
      assert.deepStrictEqual([github.changes[3]?.source, github.changes[3]?.target], ['althar/backport', 'release/0.8.0'])
      // The task's Ship sends what waits, and not a change with nothing yet.
      yield* callTool(task.lead, 'start_change', { name: 'Footer' })
      commit((yield* changeOf(task.taskId, 'Footer')).path, 'footer.txt', 'footer', 'Footer')
      yield* ship(task.taskId)
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 5,
      )
      assert.strictEqual(github.changes[4]?.source, 'althar/footer')
      // Nothing else waits: Card sizes has nothing yet.
      const left = yield* pressShip(task.taskId)
      assert.isTrue(left instanceof ShipRefused && left.why === 'nothing')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('following what a lead does with git', () => {
  it.live(
    'says once that a change’s folder is on no branch, or on the one it works toward, and follows a stacked change’s new branch',
    () => {
      const { working, github } = onGitHub()
      return Effect.gen(function* () {
        const task = yield* opened(working)
        yield* callTool(task.lead, 'start_change', { name: 'Lane colours', on: 'althar/add-a-retry' })
        const colours = yield* changeOf(task.taskId, 'Lane colours')
        const nowhere = 'The folder of althar/add-a-retry is on no branch: its lead puts it back on althar/add-a-retry.'
        git(task.path, 'switch', '-q', '--detach')
        yield* say(task.threadId, 'How is it going?')
        yield* until(notices(task.threadId), (said) => said.includes(nowhere))
        // Still detached as the stacked change's folder takes a branch of its own: that is followed, and the first said no more.
        // A change whose folder the person removed is left as it is.
        yield* callTool(task.lead, 'start_change', { name: 'Gone' })
        const gone = yield* changeOf(task.taskId, 'Gone')
        yield* removeWorktree(working, gone.path)
        git(colours.path, 'switch', '-q', '-c', 'althar/lane-colours-2')
        yield* say(task.threadId, 'And now?')
        const [made] = yield* until(
          Effect.map(workspacesOf(task.taskId), (all) => all.filter((one) => one.branch === 'althar/lane-colours-2')),
          (found) => found.length === 1,
        )
        assert.deepStrictEqual([made?.name, made?.toward, made?.path], ['althar/lane-colours-2', 'althar/add-a-retry', colours.path])
        assert.lengthOf(
          (yield* notices(task.threadId)).filter((title) => title === nowhere),
          1,
        )
        assert.strictEqual((yield* changeOf(task.taskId, 'Gone')).state, 'ready')
        assert.isFalse((yield* notices(task.threadId)).some((title) => title.startsWith('The folder of Gone')))
        // On what it works toward.
        git(task.path, 'switch', '-q', '--ignore-other-worktrees', 'main')
        yield* say(task.threadId, 'And now?')
        yield* until(notices(task.threadId), (said) =>
          said.includes(
            'The folder of althar/add-a-retry is on main, the branch its change works toward: its lead puts it back on althar/add-a-retry.',
          ),
        )
        git(task.path, 'switch', '-q', 'althar/add-a-retry')
      }).pipe(Effect.provide(runtimeWith(github)))
    },
  )

  it.live('gives a folder back to the change whose branch its lead switches it back to', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      git(task.path, 'switch', '-q', '-c', 'althar/spike')
      yield* say(task.threadId, 'How is it going?')
      yield* until(workspacesOf(task.taskId), (all) => all.length === 2 && all[0]?.state === 'away')
      git(task.path, 'switch', '-q', 'althar/add-a-retry')
      yield* say(task.threadId, 'And now?')
      const [first, spike] = yield* until(workspacesOf(task.taskId), (all) => all[0]?.state === 'ready' && all[1]?.state === 'away')
      assert.deepStrictEqual([first?.path, spike?.path], [task.path, task.path])
      // The first change's own again: no change is new.
      const started = (yield* items(task.threadId)).filter(
        (item) => item.kind === 'notice' && (item.content as { step?: { kind?: string } }).step?.kind === 'new_change',
      )
      assert.lengthOf(started, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('starts a branch made in the folder of a change toward a branch only on the remote where that change started', () => {
    const { working, github } = onGitHub({ 'RELEASE.md': '0.8.0' })
    // The release branch is on the host, as last fetched, and not here.
    git(working, 'branch', '-q', '-D', 'release/0.8.0')
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Backport', toward: 'release/0.8.0' })
      const backport = yield* changeOf(task.taskId, 'Backport')
      git(backport.path, 'switch', '-q', '-c', 'althar/backport-2')
      yield* say(task.threadId, 'How is it going?')
      const [made] = yield* until(
        sql<{ baseCommit: string | null; toward: string | null }>`
          SELECT base_commit, toward FROM workspaces WHERE task_id = ${task.taskId} AND branch = 'althar/backport-2'`,
        (rows) => rows.length === 1,
      )
      const [started] = yield* sql<{ baseCommit: string | null }>`SELECT base_commit FROM workspaces WHERE id = ${backport.id}`
      assert.deepStrictEqual([made?.baseCommit, made?.toward], [started?.baseCommit, 'release/0.8.0'])
      assert.isNotNull(started?.baseCommit ?? null)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('names a pull request from a change’s branch into another base, once, and takes the one into what it works toward', () => {
    const { working, bare, github } = onGitHub({ 'RELEASE.md': '0.8.0' })
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* callTool(task.lead, 'start_change', { name: 'Docs' })
      const docs = yield* changeOf(task.taskId, 'Docs')
      commit(docs.path, 'docs.md', 'how it retries', 'Docs')
      git(docs.path, 'push', '-q', bare, 'althar/docs')
      github.addPullRequest({
        path: ['meridian', 'api'],
        title: 'Docs backport',
        author: 'fake',
        source: 'althar/docs',
        target: 'release/0.8.0',
      })
      const named = ", from althar/docs into release/0.8.0, isn't taken as its change's: attach it if it is."
      yield* say(task.threadId, 'How is it going?')
      yield* until(notices(task.threadId), (said) => said.some((title) => title.endsWith(named)))
      // Another change's pull request, into main, is taken as its own as the next turn ends; the backport is named no more.
      yield* callTool(task.lead, 'start_change', { name: 'Notes' })
      const notes = yield* changeOf(task.taskId, 'Notes')
      commit(notes.path, 'notes.md', 'notes', 'Notes')
      git(notes.path, 'push', '-q', bare, 'althar/notes')
      github.addPullRequest({ path: ['meridian', 'api'], title: 'Notes', author: 'fake', source: 'althar/notes', target: 'main' })
      yield* say(task.threadId, 'And now?')
      yield* until(
        sql<{ workspaceId: string | null }>`SELECT workspace_id FROM repository_changes WHERE branch = 'althar/notes'`,
        (rows) => rows[0]?.workspaceId === notes.id,
      )
      assert.lengthOf(
        (yield* notices(task.threadId)).filter((title) => title.endsWith(named)),
        1,
      )
      const [taken] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM repository_changes WHERE branch = 'althar/docs'`
      assert.strictEqual(taken?.n, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
