import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { changeOf, type Conflict, fixNoteFor, noteFor, onlyTheFix, onlyTheResolution, unresolved, whereLine } from '../src/conflicts'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { conflictsOf } from '../src/localMerge'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, hosted, items, notices, repository, runtime, turns, until } from './support'

/*
 * A lead resolving a conflict with its default branch on its own, where the
 * project's rules say to (docs/architecture/06, "Resolving a conflict"):
 * found merging here or said by the pull request's host, the lead is asked
 * as the person would ask it, unasked; what it resolves on a pull request,
 * Althar pushes, and only that. One it can't resolve is asked once more,
 * then is the person's. Without the rule, a conflict waits for the person,
 * as it always has. A task can say otherwise than its project, and one that
 * comes to say its lead resolves conflicts has what conflicts already
 * resolved at once.
 */

const runtimeWith = (services: { readonly github?: FakeService } = {}) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors(services), listenEvery: Duration.millis(100) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: 'pipe' })
    .toString()
    .trim()

/** Whether git's merge of two commits in a repository conflicts, as a host works it out. */
const conflictsIn = (cwd: string, into: string, from: string) => {
  try {
    git(cwd, 'merge-tree', '--write-tree', into, from)
    return false
  } catch {
    return true
  }
}

/** Commits a change to the file the lead's `[lead:edit]` writes, on the repository's `main`: the default branch moves on. */
const moveMainOn = (root: string, text = 'rate limits\n') => {
  writeFileSync(join(root, 'change.txt'), text)
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'Limit rates')
}

/** Opens the repository as a project, with the rule on or not, and asks its coordinator for a change. */
const ask = (working: string, body: string, resolveConflicts: boolean) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (resolveConflicts) yield* (yield* Policies).set(project.projectId, { resolveConflicts: true }, (yield* Instance).personId)
    const threadId = yield* coordinator.thread(project.projectId)
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    return project.projectId
  })

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** The task's worktree, by its repository's slug. */
const worktreeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [worktree] = yield* sql<{ slug: string; path: string }>`
      SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${taskId}`
    return { slug: worktree?.slug ?? '', path: worktree?.path ?? '' }
  })

/** Merges the task's branch here at its head now, as the person's press does. */
const mergeHere = (taskId: string) =>
  Effect.gen(function* () {
    const { slug, path } = yield* worktreeOf(taskId)
    return yield* (yield* Changes).mergeHere(taskId, [{ repository: slug, head: git(path, 'rev-parse', 'HEAD') }])
  })

const cantOf = (error: unknown) => {
  const said = error as { readonly _tag?: string; readonly why?: string; readonly detail?: string }
  return [said._tag, said.why, said.detail]
}

const rounds = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ state: string; attempt: number; url: string | null; pushedHead: string | null }>`
      SELECT state, attempt, pull_request_url AS url, pushed_head FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at`,
  )

/** What the lead was asked, in the task's thread. */
const asked = (threadId: string) =>
  Effect.map(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence`,
    ),
    (rows) => rows.map((row) => row.body).filter((body) => body.includes('Bring the branch up to date')),
  )

/** What the lead's brief says Althar pushes for it, where the project has it resolve conflicts. */
const PUSHED_FOR_IT =
  'On a pull request, Althar pushes that merge itself once you commit it, and then a fix you commit on top of it, as one commit, when Althar tells you its checks failed. Nothing else you commit is pushed for you, and you still never push.'

/** The lead's brief: its first turn. */
const briefOf = (threadId: string) => Effect.map(turns(threadId), (all) => all[0]?.prompt ?? '')

const titled = (threadId: string, start: string) =>
  until(notices(threadId), (all) => all.some((notice) => notice.title?.startsWith(start) === true), Duration.seconds(20))

/** The task's own say on its lead resolving conflicts, as its menu sets it. */
const taskSays = (taskId: string, resolveConflicts: boolean | null) =>
  Effect.gen(function* () {
    const envelope = yield* Runtime.envelope('task.set_conflicts', { taskId, resolveConflicts })
    yield* (yield* Changes).setResolveConflicts({ envelope, taskId, resolveConflicts })
  })

describe('a conflict merging here', () => {
  it.live('waits for the person to ask the lead, as it always has, where the project doesn’t say', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        false,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      moveMainOn(working)
      const refused = yield* Effect.flip(mergeHere(task?.taskId ?? ''))
      assert.deepStrictEqual(cantOf(refused), ['CantMerge', 'conflicts', 'change.txt'])
      // Nothing is asked of the lead: the window offers the person to.
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* rounds(task?.taskId ?? ''), [])
      assert.deepStrictEqual(yield* asked(task?.threadId ?? ''), [])
      assert.notInclude(yield* briefOf(task?.threadId ?? ''), PUSHED_FOR_IT)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('is resolved by the lead unasked, with no review round, for the person to merge again', () => {
    const working = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass] [lead:resolve]', true)
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      const reviews = sql<{ n: number }>`
        SELECT count(*) AS n FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'review'`
      const [reviewed] = yield* reviews
      moveMainOn(working)
      const refused = yield* Effect.flip(mergeHere(taskId))
      assert.deepStrictEqual(cantOf(refused), ['CantMerge', 'resolving', 'change.txt'])
      // Asked as the person's press asks it.
      const [note] = yield* asked(threadId)
      assert.include(note, 'Bring the branch up to date: merge main into it')
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['resolved', 1]],
      )
      const { path } = yield* worktreeOf(taskId)
      assert.strictEqual(git(path, 'merge-base', '--is-ancestor', 'main', 'HEAD'), '')
      // No review round for it, and it waits on the person again.
      assert.strictEqual((yield* reviews)[0]?.n, reviewed?.n)
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      // Asked while it resolves, or merged after, nothing more is asked of it.
      yield* mergeHere(taskId)
      // Both sides hold, as the lead settled them.
      assert.strictEqual(git(working, 'show', 'main:change.txt'), 'change\nrate limits')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('starts a lead to resolve it where none is running, and finds nothing where the branch merges cleanly', () => {
    const working = repository()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      // Looked at while its branch merges cleanly, nothing is asked.
      yield* (yield* Changes).resolveNow({ projectId })
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      // Its lead's session is gone, as after Althar restarts.
      yield* sessions.stop(threadId)
      yield* until(
        Effect.map(sessions.running(threadId), (running) => (Option.isNone(running) ? [true] : [])),
        (none) => none.length === 1,
      )
      const count = sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`
      const [before] = yield* count
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
      assert.isAbove((yield* count)[0]?.n ?? 0, before?.n ?? 0)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('says a lead is already at it, and gives it to the person once they stop the lead', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve-wait]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      yield* until(asked(threadId), (all) => all.length === 1)
      // Pressed again while the lead works at it, it says so, and asks nothing more.
      assert.deepStrictEqual(cantOf(yield* Effect.flip(mergeHere(taskId))), ['CantMerge', 'resolving', 'change.txt'])
      // Stopped, as the window's Stop does: its session ends, and what it was resolving is handed over, whichever comes first.
      yield* (yield* Sessions).stop(threadId)
      yield* (yield* Changes).leadStopped({ threadId })
      yield* titled(threadId, 'The lead couldn’t resolve the conflict with main, in change.txt')
      const [round] = yield* rounds(taskId)
      assert.strictEqual(round?.state, 'failed')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('is asked once more with why, then given back to the person, who sees it as before', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve-fails]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      yield* titled(threadId, 'The lead couldn’t resolve the conflict with main, in change.txt')
      // Twice: the second time with why the first didn't.
      const notes = yield* asked(threadId)
      assert.strictEqual(notes.length, 2)
      assert.match(notes[1] ?? '', /^The conflict isn't resolved yet: main isn't merged into the branch\. Try once more\./)
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['failed', 2]],
      )
      // Needs you, where the person's own press would leave it: merging again offers to ask the lead, and asks nothing itself.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'conflicts')
      assert.strictEqual((yield* asked(threadId)).length, 2)
      assert.strictEqual((yield* rounds(taskId)).length, 1)
      // Once its branch moves, a conflict is the lead's again.
      git((yield* worktreeOf(taskId)).path, 'commit', '-q', '--allow-empty', '-m', 'Look again')
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      assert.strictEqual((yield* rounds(taskId)).length, 2)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('waits for a place among the agents at work on this machine, after a restart too, and is asked once one frees', () => {
    const working = repository()
    const file = join(mkdtempSync(join(tmpdir(), 'althar-conflicts-')), 'althar.sqlite')
    // One agent at once: 2.5 cores and 3 GB, and 4 GB kept.
    const oneAtOnce = () =>
      Queries.layer.pipe(
        Layer.provideMerge(runtime(file, {}, { connectors: fakeConnectors({}), busy: { machine: { cores: 3, memory: 7 * 1024 ** 3 } } })),
      )
    /** The waiting round's task's card, by its id. */
    const cardOf = (projectId: string, taskId: string) => Effect.map(cards(projectId), (all) => all.filter((one) => one.taskId === taskId))
    return Effect.gen(function* () {
      const before = yield* Effect.gen(function* () {
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
          true,
        )
        const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
        const taskId = task?.taskId ?? ''
        const threadId = task?.threadId ?? ''
        // Another task takes the one place: its lead works on until it is stopped.
        const projects = yield* Projects
        const plans = yield* Plans
        const busy = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId,
          title: 'Work on',
          description: 'Work on it. [lead:wait]',
          draft: true,
        })
        const actorId = (yield* Instance).personId
        const planId = yield* plans.propose({
          projectId: projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: busy.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId,
          end: null,
          held: true,
        })
        assert.strictEqual(yield* plans.start(planId, actorId), 'running')
        moveMainOn(working)
        assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
        // The round is kept, and says it waits; the lead isn't asked yet.
        yield* titled(threadId, 'It conflicts with main')
        const said = (yield* notices(threadId)).find((notice) => notice.title?.startsWith('It conflicts with main') === true)
        assert.strictEqual(
          said?.description,
          'Althar asks the lead to resolve it, as the project’s rules say, once an agent is free on this computer.',
        )
        assert.deepStrictEqual(
          (yield* rounds(taskId)).map((round) => round.state),
          ['resolving'],
        )
        assert.deepStrictEqual(yield* asked(threadId), [])
        const [card] = yield* cardOf(projectId, taskId)
        assert.strictEqual(card?.phase, 'running')
        assert.deepStrictEqual(card?.queued && { busy: card.queued.busy, atOnce: card.queued.atOnce }, { busy: 1, atOnce: 1 })
        // Asked to merge again meanwhile, it says the lead is at it.
        assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
        return { projectId, taskId, threadId, busy }
      }).pipe(Effect.provide(oneAtOnce()))

      yield* Effect.gen(function* () {
        const { projectId, taskId, threadId, busy } = before
        // After a restart, the round still waits, and isn't settled as one a lead was cut short on.
        yield* until(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ state: string }>`SELECT state FROM provider_sessions WHERE thread_id = ${busy.threadId}`,
          ),
          (rows) => rows.length === 2,
        )
        yield* Effect.sleep('300 millis')
        assert.deepStrictEqual(
          (yield* rounds(taskId)).map((round) => round.state),
          ['resolving'],
        )
        assert.deepStrictEqual(yield* asked(threadId), [])
        const [queued] = (yield* cardOf(projectId, taskId)).map((card) => card.queued)
        assert.deepStrictEqual(queued && { busy: queued.busy, atOnce: queued.atOnce }, { busy: 1, atOnce: 1 })
        // The other task is stopped: its place goes to the round, whose lead is asked, and resolves it.
        yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: busy.taskId })
        yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
        assert.strictEqual((yield* asked(threadId)).length, 1)
        assert.deepStrictEqual(
          (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
          [['resolved', 1]],
        )
      }).pipe(Effect.provide(oneAtOnce()))
    })
  })
})

describe('a task that says otherwise than its project', () => {
  it.live('has what conflicts already resolved by its lead once it says so, though its project doesn’t', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        false,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      // The default branch moves on; nobody merges, so nothing has found it yet.
      moveMainOn(working)
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      // The task says its lead resolves conflicts: what conflicts now is resolved, with no Merge pressed.
      yield* taskSays(taskId, true)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'It conflicts with main, in change.txt.')
      assert.strictEqual(said?.description, 'Althar asked the lead to resolve it, as you said for this task.')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.url]),
        [['resolved', null]],
      )
      // Saying it again starts nothing more, and the person merges as ever.
      yield* taskSays(taskId, true)
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      yield* mergeHere(taskId)
      assert.strictEqual(git(working, 'show', 'main:change.txt'), 'change\nrate limits')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith()))
  })

  it.live('refuses a say for a task there isn’t', () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(taskSays(`task_${'0'.repeat(32)}`, true))
      assert.strictEqual((refused as { readonly _tag?: string })._tag, 'NotFound')
    }).pipe(Effect.provide(runtimeWith())),
  )

  it.live('waits for the person where it says so, though its project has its leads resolve conflicts', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      yield* taskSays(taskId, false)
      moveMainOn(working)
      // The button, as ever: nothing is asked of the lead.
      assert.deepStrictEqual(cantOf(yield* Effect.flip(mergeHere(taskId))), ['CantMerge', 'conflicts', 'change.txt'])
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(task?.threadId ?? ''), [])
      // Back to the project's say, the next conflict found goes by it.
      yield* taskSays(taskId, null)
      assert.deepStrictEqual(cantOf(yield* Effect.flip(mergeHere(taskId))), ['CantMerge', 'resolving', 'change.txt'])
      yield* titled(task?.threadId ?? '', 'The lead resolved the conflict with main, in change.txt')
    }).pipe(Effect.provide(runtimeWith()))
  })
})

describe('a conflict its pull request’s host reports', () => {
  type Checks = ReadonlyArray<{ readonly name: string; readonly state: 'passed' | 'failed' | 'running'; readonly log?: string }>
  const PASSED: Checks = [{ name: 'test', state: 'passed' }]
  const RUNNING: Checks = [{ name: 'test', state: 'running' }]
  const FAILED: Checks = [{ name: 'test', state: 'failed', log: 'FAIL limit.test.ts' }]

  /** Whether a commit the host has holds what the default branch moved on with: the resolution, or after it. */
  const holdsMain = (bare: string, sha: string) => {
    try {
      return git(bare, 'show', `${sha}:change.txt`).includes('rate limits')
    } catch {
      return false
    }
  }
  /** Whether a commit the host has holds the lead's fix for its checks. */
  const holdsFix = (bare: string, sha: string) => {
    try {
      git(bare, 'cat-file', '-e', `${sha}:fixed.txt`)
      return true
    } catch {
      return false
    }
  }

  /**
   * A GitHub whose pull request conflicts when the bare repository's `main`
   * and the task's branch do, with the checks it runs on each commit.
   */
  const hostOf = (
    bare: string,
    checks: (sha: string) => Checks | undefined = () => undefined,
    /** Each time the host says the pull request conflicts. */
    conflicting: () => void = () => {},
  ) => {
    const tip = () => {
      try {
        return git(bare, 'rev-parse', 'althar/add-a-retry')
      } catch {
        return null
      }
    }
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tip,
      conflictsOf: () => {
        if (tip() === null) return undefined
        const conflicts = conflictsIn(bare, 'main', 'althar/add-a-retry')
        if (conflicts) conflicting()
        return conflicts
      },
      checksFor: (_, sha) => checks(sha),
    })
    github.addRepository(['meridian', 'api'])
    return github
  }

  const connect = Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
  })

  /** The default branch moves on where the host has it, conflicting with what the task changed. */
  const moveHostMainOn = (working: string, bare: string, text?: string) => {
    moveMainOn(working, text)
    git(working, 'push', '-q', bare, 'main')
  }

  /** A task that ends in a pull request, with the rule on, as the lead's markers say: its card once the pull request is open. */
  const opened = (working: string, markers: string, resolveConflicts = true) =>
    Effect.gen(function* () {
      yield* connect
      const projectId = yield* ask(
        working,
        `Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] ${markers}`,
        resolveConflicts,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change !== null, Duration.seconds(20))
      return { projectId, taskId: task?.taskId ?? '', threadId: task?.threadId ?? '' }
    })

  /** Every input the lead was given in the thread. */
  const given = (threadId: string) =>
    Effect.map(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence`,
      ),
      (rows) => rows.map((row) => row.body),
    )

  it.live('is resolved by the lead, pushed by Althar, and done once its checks pass', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      const [note] = yield* asked(threadId)
      assert.include(note, 'merge origin/main into it, which Althar has fetched')
      assert.include(note, "Merge, don't rebase: a branch that was pushed can't be rewritten.")
      assert.include(note, "Althar pushes that merge alone to PR #1. Don't push it yourself.")
      // Its brief says what Althar pushes for it, and that it never pushes itself.
      assert.include(yield* briefOf(threadId), PUSHED_FOR_IT)
      // The pull request has the merge, and conflicts no more.
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'), '')
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
      // The checks on it settle the round.
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual(
        [round?.state, round?.attempt, round?.pushedHead],
        ['resolved', 1, git(bare, 'rev-parse', 'althar/add-a-retry')],
      )
      // Nothing left to push, and it waits on the person to merge it.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.unpushed === 0, Duration.seconds(20))
      // Asked once, though the host said so on every look until the merge was pushed.
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves it to the person where the task says so, though its project has its leads resolve conflicts', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = hostOf(
      bare,
      () => PASSED,
      () => void (heard += 1),
    )
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* taskSays(taskId, false)
      moveHostMainOn(working, bare)
      // Heard a few times over that it conflicts, nothing is asked of the lead, and nothing pushed.
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 3,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  /** Until the lead has committed the merge in the task's worktree: it is working still, as `[lead:resolve-hold]` does. */
  const mergedHere = (taskId: string) =>
    Effect.gen(function* () {
      const { path } = yield* worktreeOf(taskId)
      yield* until(
        Effect.sync(() => [git(path, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length]),
        ([parts]) => parts === 3,
        Duration.seconds(20),
      )
    })

  it.live('leaves a merge the lead made to the person when they interrupt it before its turn ends, and pushes nothing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-hold]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* mergedHere(taskId)
      // As the window's interrupt does: the round is handed over, then the lead interrupted.
      yield* (yield* Changes).leadStopped({ threadId }, 'interrupted')
      yield* (yield* Sessions).interrupt(threadId)
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.strictEqual(said?.description, 'The lead was stopped, so it waits for you to look at it and push it to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
      yield* Effect.sleep('300 millis')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a merge where they said something to the lead meanwhile', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-hold]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* mergedHere(taskId)
      // The person talks to the lead in the middle of it: the round goes on, and what the lead commits may be for that.
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Keep the old name too.',
        disposition: 'interrupt_and_continue',
      })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.strictEqual(
        said?.description,
        'The lead was asked something else meanwhile, so the merge waits for you to look at it and push it to PR #1.',
      )
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says where it couldn’t push the merge, for the person to push it', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      // The host refuses what comes to the task's branch from here on.
      writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "refused" >&2\nexit 1\n', { mode: 0o755 })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, but Althar couldn’t push the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title?.endsWith('but Althar couldn’t push the merge.') === true)
      // Why, as the task's Push card says it: what the host said, in a sentence, not git's hint.
      assert.match(said?.description ?? '', /^PR #1 refused the push: pre-receive hook declined\. Push it from PR #1’s card\.$/)
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('asks nothing where the branch here merges cleanly, whatever the host says', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: () => git(bare, 'rev-parse', 'althar/add-a-retry'),
      conflictsOf: () => {
        heard += 1
        return true
      },
      checksFor: () => PASSED,
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 3,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the conflict to the person when they stop listening while the lead resolves it', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve-wait]')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      moveHostMainOn(working, bare)
      yield* until(asked(threadId), (all) => all.length === 1, Duration.seconds(20))
      yield* (yield* Changes).stopListening(taskId, url)
      yield* titled(threadId, 'Althar no longer follows the conflict on PR #1.')
      const [round] = yield* rounds(taskId)
      assert.strictEqual(round?.state, 'failed')
      // Looked at again, a pull request no longer listened to isn't asked about.
      yield* (yield* Changes).resolveNow({ projectId })
      yield* Effect.sleep('300 millis')
      assert.strictEqual((yield* rounds(taskId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('resolves what a pull request already conflicts on once its project says to', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = hostOf(
      bare,
      () => PASSED,
      () => void (heard += 1),
    )
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]', false)
      moveHostMainOn(working, bare)
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 2,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      yield* (yield* Policies).set(projectId, { resolveConflicts: true }, (yield* Instance).personId)
      yield* (yield* Changes).resolveNow({ projectId })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('ends its round once the person merges the pull request while its checks run', () => {
    const { working, bare } = hosted()
    let polled = 0
    const github = hostOf(bare, (sha) => {
      if (holdsMain(bare, sha)) polled += 1
      return holdsMain(bare, sha) ? RUNNING : PASSED
    })
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Its checks are heard running a while.
      yield* until(
        Effect.sync(() => [polled]),
        ([times]) => (times ?? 0) >= 2,
        Duration.seconds(20),
      )
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      yield* (yield* Changes).merge(taskId, git(bare, 'rev-parse', 'althar/add-a-retry'), url)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('ends its round once the pull request moves on past what Althar pushed', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Someone else pushes to its branch.
      git(working, 'fetch', '-q', bare, 'althar/add-a-retry')
      git(working, 'checkout', '-q', 'FETCH_HEAD')
      git(working, 'commit', '-q', '--allow-empty', '-m', 'From elsewhere')
      git(working, 'push', '-q', bare, 'HEAD:althar/add-a-retry')
      git(working, 'checkout', '-q', 'main')
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves checks that fail after the lead committed more as failed checks always are', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // More is committed on the branch here, then the checks fail.
      git((yield* worktreeOf(taskId)).path, 'commit', '-q', '--allow-empty', '-m', 'More')
      merged = FAILED
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
      // The lead hears them as it always does, not as the round's to fix.
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed')), Duration.seconds(20))
      assert.isFalse((yield* given(threadId)).some((body) => body.includes('commit the fix as one commit on top of the merge')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('doesn’t ask the lead to fix checks that fail once the task is abandoned', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId }), taskId })
      merged = FAILED
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
      assert.isFalse((yield* given(threadId)).some((body) => body.includes('commit the fix as one commit on top of the merge')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('takes it as ready once no checks have come for a while', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => [])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // None yet, so far: it waits.
      yield* Effect.sleep('400 millis')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // As though it had waited a few minutes.
      const before = new Date(Date.now() - 3 * 60_000).toISOString()
      yield* sql`UPDATE conflict_resolutions SET updated_at = ${before} WHERE task_id = ${taskId}`
      yield* titled(threadId, 'No checks ran on what Althar pushed to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  /** Until the lead has committed its fix for the checks in the task's worktree: it is working still, as `[lead:fix-hold]` does. */
  const fixedHere = (taskId: string) =>
    Effect.gen(function* () {
      const { path } = yield* worktreeOf(taskId)
      yield* until(
        Effect.sync(() => [holdsFix(path, 'HEAD')]),
        ([fixed]) => fixed === true,
        Duration.seconds(20),
      )
    })

  it.live('leaves a fix the lead made to the person when they interrupt it before its turn ends, and pushes nothing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-hold]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* fixedHere(taskId)
      yield* (yield* Changes).leadStopped({ threadId }, 'interrupted')
      yield* (yield* Sessions).interrupt(threadId)
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.strictEqual(said?.description, 'The lead was stopped, so it waits for you to look at it and push it to PR #1.')
      yield* Effect.sleep('300 millis')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a fix where they said something to the lead meanwhile', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-hold]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* fixedHere(taskId)
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Keep the old name too.',
        disposition: 'interrupt_and_continue',
      })
      yield* titled(threadId, 'The lead fixed the checks on the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.strictEqual(
        said?.description,
        'The lead was asked something else meanwhile, so the fix waits for you to look at it and push it to PR #1.',
      )
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the checks to the person when the lead commits no fix, after its one more try', () => {
    const { working, bare } = hosted()
    // A check that failed with no log to pass on.
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? [{ name: 'test', state: 'failed' }] : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead couldn’t fix the checks on the merge.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['failed', 2])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('has the lead fix the checks that fail on the merge, within the round, and pushes the fix too', () => {
    const { working, bare } = hosted()
    // The merge breaks a check, which the lead's fix mends.
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead fixed the checks on the merge, and Althar pushed the fix to PR #1.')
      assert.isTrue(holdsFix(bare, 'althar/add-a-retry'))
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual(
        [round?.state, round?.attempt, round?.pushedHead],
        ['resolved', 2, git(bare, 'rev-parse', 'althar/add-a-retry')],
      )
      // Told within the round that Althar pushes the fix, never that the person does.
      const said = yield* given(threadId)
      const fix = said.filter((body) => body.startsWith('Checks failed on the merge Althar pushed to PR #1: test.'))
      assert.strictEqual(fix.length, 1)
      assert.include(fix[0], 'FAIL limit.test.ts')
      assert.include(fix[0], 'commit the fix as one commit on top of the merge, with nothing else: Althar pushes it to PR #1 too.')
      assert.isFalse(said.some((body) => body.includes('the person looks at it and pushes it')))
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.unpushed === 0, Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the round to the person when the checks fail on the fix too', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead fixed the checks on the merge, and Althar pushed the fix to PR #1.')
      yield* until(
        notices(threadId),
        (all) => all.filter((notice) => notice.title === 'The checks failed on what Althar pushed to PR #1: test.').length === 2,
        Duration.seconds(20),
      )
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['failed', 2])
      const last = (yield* notices(threadId)).at(-1)
      assert.deepStrictEqual(
        [last?.severity, last?.description],
        ['warning', 'The lead had its one more try. It’s yours to settle, or to ask the lead again.'],
      )
      // Asked to fix them once, and not told again, by the round or as failed checks always are.
      yield* Effect.sleep('500 millis')
      const said = yield* given(threadId)
      assert.strictEqual(said.filter((body) => body.startsWith('Checks failed')).length, 1)
      // Needs you.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a fix the lead committed other work after', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-more]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead fixed the checks on the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.include(said?.description, 'commits besides the fix')
      // Neither the fix nor what came after it went up.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt, round?.pushedHead], ['resolved', 2, merge])
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 2, Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves the checks to the person once they stop the lead, and doesn’t start it again for them', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // The person stops the lead while the checks run, as the window's Stop does.
      yield* until(
        Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) ? [running.value] : [])),
        (running) => running.length === 1,
      )
      const [{ n: started } = { n: 0 }] = yield* sql<{
        n: number
      }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`
      yield* sessions.stop(threadId)
      yield* (yield* Changes).leadStopped({ threadId })
      yield* titled(threadId, 'You stopped the lead, so the checks on what Althar pushed to PR #1 are yours.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
      // The checks fail: the thread says so, and the lead isn't started again to fix them.
      merged = FAILED
      yield* until(items(threadId), (all) =>
        all.some((item) => item.kind === 'arrival' && item.content.kind === 'checks' && item.content.failed === 1),
      )
      yield* Effect.sleep('500 millis')
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`)[0]?.n,
        started,
      )
      assert.isFalse((yield* asked(threadId)).some((body) => body.startsWith('Checks failed')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the round to the person when they stop listening, and a later conflict starts another', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Its checks never finish, and the person stops listening to it.
      yield* (yield* Changes).stopListening(taskId, url)
      yield* titled(threadId, 'Althar no longer follows the checks on what it pushed to PR #1.')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => round.state),
        ['resolved'],
      )
      // Listened to again, as opening its pull request again does, a new conflict is the lead's once more.
      yield* sql`UPDATE external_links SET listening = 1 WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare, 'rate limits, again\n')
      yield* until(rounds(taskId), (all) => all.length === 2, Duration.seconds(20))
      yield* until(asked(threadId), (all) => all.length === 2, Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a merge the lead committed other work on top of', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve-more]')
      const before = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.include(said?.description, 'commits besides the merge')
      // Neither the merge nor what came after it went up.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', null])
      const [waiting] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 3, Duration.seconds(20))
      assert.strictEqual(waiting?.change?.localHead, git((yield* worktreeOf(taskId)).path, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push the merge where the branch has other commits the pull request doesn’t', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:fix] [lead:resolve]')
      // The lead fixed a check and committed it, for the person to push.
      github.setChecks(1, FAILED)
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1, Duration.seconds(20))
      const before = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      // Neither the merge nor the fix went up: both wait for the person's push.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', null])
      const [waiting] = yield* until(cards(projectId), (all) => (all[0]?.change?.unpushed ?? 0) > 1, Duration.seconds(20))
      assert.strictEqual(waiting?.change?.localHead, git((yield* worktreeOf(taskId)).path, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a stopped task’s lead alone, until its run is done', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      // Stopped, as stopping a task mid-step leaves its run: suspended, for the person to resume.
      yield* sql`UPDATE runs SET state = 'suspended' WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare)
      yield* Effect.sleep('1 second')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
      // Its run done, the same conflict is the lead's.
      yield* sql`UPDATE runs SET state = 'succeeded' WHERE task_id = ${taskId}`
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a round’s words, and what git says of its branch', () => {
  /** A task branch and main that both change a.txt and b.txt: the task's branch checked out, and the conflict merging main into it. */
  const split = () => {
    const root = repository()
    git(root, 'checkout', '-q', '-b', 'task')
    for (const file of ['a.txt', 'b.txt']) writeFileSync(join(root, file), 'task\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'Task')
    const from = git(root, 'rev-parse', 'HEAD')
    git(root, 'checkout', '-q', 'main')
    for (const file of ['a.txt', 'b.txt']) writeFileSync(join(root, file), 'main\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'Main')
    const target = git(root, 'rev-parse', 'HEAD')
    git(root, 'checkout', '-q', 'task')
    const conflict: Conflict = { repository: 'api', name: 'api', branch: 'main', ref: 'main', target, from, files: ['a.txt', 'b.txt'] }
    return { root, conflict }
  }
  const mergeMain = (root: string) => {
    try {
      git(root, 'merge', '-q', '--no-edit', 'main')
    } catch {
      // It conflicts, as it should.
    }
  }

  it.effect('says why each repository isn’t resolved yet, until it is', () =>
    Effect.gen(function* () {
      const { root, conflict } = split()
      assert.strictEqual(yield* unresolved(root, conflict), "main isn't merged into the branch.")
      mergeMain(root)
      assert.strictEqual(yield* unresolved(root, conflict), 'a.txt, b.txt still conflict.')
      writeFileSync(join(root, 'b.txt'), 'task\nmain\n')
      git(root, 'add', 'b.txt')
      assert.strictEqual(yield* unresolved(root, conflict), 'a.txt still conflicts.')
      git(root, 'add', 'a.txt')
      assert.strictEqual(yield* unresolved(root, conflict), "The merge of main isn't committed.")
      // Committed with its markers in, the conflict is in the commit.
      writeFileSync(join(root, 'b.txt'), '<<<<<<< HEAD\ntask\n=======\nmain\n>>>>>>> main\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '--no-edit')
      assert.strictEqual(yield* unresolved(root, conflict), 'a.txt, b.txt still have conflict markers in them.')
      writeFileSync(join(root, 'a.txt'), 'task\nmain\n')
      git(root, 'commit', '-q', '-am', 'Settle a')
      assert.strictEqual(yield* unresolved(root, conflict), 'b.txt still has conflict markers in it.')
      writeFileSync(join(root, 'b.txt'), 'task\nmain\n')
      git(root, 'commit', '-q', '-am', 'Settle b')
      assert.isNull(yield* unresolved(root, conflict))
    }),
  )

  it.effect('takes as the resolution only a merge of the branch it conflicted with, made on the branch as it was', () =>
    Effect.gen(function* () {
      const { root, conflict } = split()
      // A plain commit isn't a merge.
      writeFileSync(join(root, 'c.txt'), 'c\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Other work')
      assert.isFalse(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
      // A merge of another branch isn't one of the branch it conflicted with.
      git(root, 'reset', '-q', '--hard', conflict.from)
      git(root, 'checkout', '-q', '-b', 'other', conflict.from)
      writeFileSync(join(root, 'd.txt'), 'd\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Elsewhere')
      git(root, 'checkout', '-q', 'task')
      git(root, 'merge', '-q', '--no-ff', '--no-edit', 'other')
      assert.isFalse(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
      // The merge of main, settled, is.
      git(root, 'reset', '-q', '--hard', conflict.from)
      mergeMain(root)
      for (const file of ['a.txt', 'b.txt']) writeFileSync(join(root, file), 'task\nmain\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '--no-edit')
      const merge = git(root, 'rev-parse', 'HEAD')
      assert.isTrue(yield* onlyTheResolution(root, conflict, merge))
      // On top of it, one commit is a fix; two aren't.
      git(root, 'commit', '-q', '--allow-empty', '-m', 'Fix')
      assert.isTrue(yield* onlyTheFix(root, merge, git(root, 'rev-parse', 'HEAD')))
      git(root, 'commit', '-q', '--allow-empty', '-m', 'More')
      assert.isFalse(yield* onlyTheFix(root, merge, git(root, 'rev-parse', 'HEAD')))
    }),
  )

  it.effect('finds what conflicts merging here without moving anything, and nothing where it can’t tell', () =>
    Effect.gen(function* () {
      const { root, conflict } = split()
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', conflict.from), ['a.txt', 'b.txt'])
      assert.strictEqual(git(root, 'rev-parse', 'main'), conflict.target)
      assert.deepStrictEqual(yield* conflictsOf(root, 'develop', conflict.from), [])
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', 'f'.repeat(40)), [])
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', conflict.target), [])
    }),
  )

  it('says where several repositories conflict, and names a pull request it can’t find', () => {
    const one = { repository: 'web', name: 'web', branch: 'develop', ref: 'develop', target: 'a', from: 'b', files: ['README.md'] }
    const two = { repository: 'api', name: 'api', branch: 'main', ref: 'main', target: 'c', from: 'd', files: ['a.ts', 'b.ts'] }
    assert.strictEqual(whereLine([one, two]), 'web’s develop, in README.md; api’s main, in a.ts, b.ts')
    const note = noteFor([one, two], { change: null }, null)
    assert.include(note, 'in web, develop conflicts in README.md; in api, main conflicts in a.ts, b.ts.')
    assert.include(note, "Merge, don't rebase: a branch that was pushed can't be rewritten. Then say it's ready to merge again.")
    assert.strictEqual(changeOf({ change: null }), 'the pull request')
    const fix = fixNoteFor({ change: null }, { failing: ['test'], logs: [] })
    assert.match(fix, /^Checks failed on the merge Althar pushed to the pull request: test\.\n\nFix what broke/)
    assert.include(fix, 'Althar pushes it to the pull request too.')
  })
})
