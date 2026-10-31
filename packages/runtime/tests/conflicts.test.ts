import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import { Changes } from '../src/Changes'
import { changeOf, type Conflict, fixNoteFor, noteFor, onlyTheFix, onlyTheResolution, unresolved, whereLine } from '../src/conflicts'
import { type Failure, failureOf, Failures } from '../src/Failures'
import { Instance } from '../src/Instance'
import { conflictsOf } from '../src/localMerge'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, notices, repository, runtime, until } from './support'
import {
  runtimeWith,
  git,
  moveMainOn,
  ask,
  cards,
  worktreeOf,
  mergeHere,
  cantOf,
  rounds,
  asked,
  PUSHED_FOR_IT,
  briefOf,
  titled,
  taskSays,
} from './conflictsSupport'

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

describe('a conflict merging here', () => {
  it.live('waits for the person to ask the lead, as it always has, where the project doesn’t say', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        false,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
        const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
        assert.strictEqual(said?.description, 'The lead resolves it once an agent is free.')
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

describe('rounds an earlier launch left under way', () => {
  it.live('are settled each on its own: a worktree gone or one git can’t read is that round’s reason, and the rest are settled', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'althar-conflicts-')), 'althar.sqlite')
    const launch = () => Queries.layer.pipe(Layer.provideMerge(runtime(file)))
    const reported: Array<Failure> = []
    return Effect.gen(function* () {
      const [gone, unreadable, kept] = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const sql = yield* SqlClient.SqlClient
        const root = repository()
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
        const made: Array<{ readonly taskId: string; readonly path: string }> = []
        for (const title of ['Gone', 'Unreadable', 'Kept']) {
          const task = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title,
          })
          yield* until(
            sql<{ state: string }>`SELECT state FROM workspaces WHERE task_id = ${task.taskId}`,
            (rows) => rows[0]?.state === 'ready',
          )
          const { slug, path } = yield* worktreeOf(task.taskId)
          const head = git(path, 'rev-parse', 'HEAD')
          // Its lead was resolving a conflict with main, where the branch already is, when Althar stopped.
          const conflict: Conflict = {
            repository: slug,
            name: slug,
            branch: 'main',
            ref: 'main',
            target: head,
            from: head,
            files: ['change.txt'],
          }
          const at = new Date().toISOString()
          yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
            id: `cres_${randomBytes(16).toString('hex')}`,
            projectId: project.projectId,
            taskId: task.taskId,
            pullRequestUrl: null,
            conflicts: JSON.stringify([conflict]),
            attempt: 1,
            state: 'resolving',
            createdAt: at,
            updatedAt: at,
          })}`
          made.push({ taskId: task.taskId, path })
        }
        return made
      }).pipe(Effect.provide(launch()))
      // Meanwhile one task's worktree went, and another's is no longer one git reads.
      rmSync(gone?.path ?? '', { recursive: true, force: true })
      rmSync(join(unreadable?.path ?? '', '.git'), { force: true })

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const ended = yield* until(
          sql<{ taskId: string; state: string; failure: string | null }>`
            SELECT task_id, state, failure FROM conflict_resolutions ORDER BY rowid`,
          (rows) => rows.every((row) => row.state !== 'resolving'),
        )
        assert.deepStrictEqual(
          ended.map((round) => [round.taskId, round.state]),
          [
            [gone?.taskId, 'failed'],
            [unreadable?.taskId, 'failed'],
            [kept?.taskId, 'resolved'],
          ],
        )
        assert.strictEqual(ended[0]?.failure, 'Althar stopped while the lead was resolving it. Its worktree is gone.')
        assert.match(
          ended[1]?.failure ?? '',
          /^Althar stopped while the lead was resolving it\. Althar couldn’t read its worktree: .*not a git repository.*\.$/i,
        )
        // A worktree that went is the person's to see; git that fails where it is, Althar's to hear of.
        assert.deepStrictEqual(
          reported.map((failure) => [failure.where, failure.name]),
          [['Changes.settleRound', 'GitFailed']],
        )
      }).pipe(
        Effect.provide(launch()),
        Effect.provideService(Failures, {
          report: (cause, where, agent) => Effect.sync(() => void reported.push(failureOf(cause, where, agent ?? null))),
          events: Stream.empty,
        }),
      )
    })
  })
})

describe('rounds waiting for a place', () => {
  it.live('wait each on its own: one whose ask doesn’t read is left out, and the rest still wait', () => {
    const reported: Array<Failure> = []
    return Effect.gen(function* () {
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const tasks: Array<string> = []
      const at = new Date().toISOString()
      for (const [title, waiting] of [
        ['Unreadable', '{}'],
        ['Waits', JSON.stringify({ attempt: 1, body: 'Resolve it.', why: {}, since: at })],
      ] as const) {
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title,
        })
        yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
          id: `cres_${randomBytes(16).toString('hex')}`,
          projectId: project.projectId,
          taskId: task.taskId,
          pullRequestUrl: null,
          conflicts: '[]',
          attempt: 1,
          state: 'resolving',
          waiting,
          createdAt: at,
          updatedAt: at,
        })}`
        tasks.push(task.taskId)
      }
      assert.deepStrictEqual(
        (yield* (yield* Busy).order).map((agent) => agent.taskId),
        [tasks[1]],
      )
      assert.deepStrictEqual(
        reported.map((failure) => failure.where),
        ['Changes.roundsWaiting'],
      )
    }).pipe(
      Effect.provide(runtime()),
      Effect.provideService(Failures, {
        report: (cause, where, agent) => Effect.sync(() => void reported.push(failureOf(cause, where, agent ?? null))),
        events: Stream.empty,
      }),
    )
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      assert.strictEqual(said?.description, 'The lead is resolving it.')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.url]),
        [['resolved', null]],
      )
      // Saying it again starts nothing more, and the person merges as ever.
      yield* taskSays(taskId, true)
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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

  it.effect('says why each repository isn’t resolved yet, and when only committing the merge is left, until it is', () =>
    Effect.gen(function* () {
      const { root, conflict } = split()
      assert.deepStrictEqual(yield* unresolved(root, conflict), { why: "main isn't merged into the branch.", uncommitted: false })
      mergeMain(root)
      assert.deepStrictEqual(yield* unresolved(root, conflict), { why: '2 files still conflict.', uncommitted: false })
      writeFileSync(join(root, 'b.txt'), 'task\nmain\n')
      git(root, 'add', 'b.txt')
      assert.deepStrictEqual(yield* unresolved(root, conflict), { why: 'a.txt still conflicts.', uncommitted: false })
      git(root, 'add', 'a.txt')
      // Every file is settled: the merge is all that is left to do.
      assert.deepStrictEqual(yield* unresolved(root, conflict), { why: "The merge of main isn't committed.", uncommitted: true })
      // Committed with its markers in, the conflict is in the commit.
      writeFileSync(join(root, 'b.txt'), '<<<<<<< HEAD\ntask\n=======\nmain\n>>>>>>> main\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '--no-edit')
      assert.deepStrictEqual(yield* unresolved(root, conflict), {
        why: '2 files still have conflict markers in them.',
        uncommitted: false,
      })
      writeFileSync(join(root, 'a.txt'), 'task\nmain\n')
      git(root, 'commit', '-q', '-am', 'Settle a')
      assert.deepStrictEqual(yield* unresolved(root, conflict), { why: 'b.txt still has conflict markers in it.', uncommitted: false })
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
      assert.isNull(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
      // A merge of another branch isn't one of the branch it conflicted with.
      git(root, 'reset', '-q', '--hard', conflict.from)
      git(root, 'checkout', '-q', '-b', 'other', conflict.from)
      writeFileSync(join(root, 'd.txt'), 'd\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Elsewhere')
      git(root, 'checkout', '-q', 'task')
      git(root, 'merge', '-q', '--no-ff', '--no-edit', 'other')
      assert.isNull(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
      // The merge of main, settled, is.
      git(root, 'reset', '-q', '--hard', conflict.from)
      mergeMain(root)
      for (const file of ['a.txt', 'b.txt']) writeFileSync(join(root, file), 'task\nmain\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '--no-edit')
      const merge = git(root, 'rev-parse', 'HEAD')
      assert.strictEqual(yield* onlyTheResolution(root, conflict, merge), 'merge')
      // On top of it, one commit is a fix, for the full tests as for the checks; two aren't.
      git(root, 'commit', '-q', '--allow-empty', '-m', 'Fix')
      assert.isTrue(yield* onlyTheFix(root, merge, git(root, 'rev-parse', 'HEAD')))
      assert.strictEqual(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')), 'merge and fix')
      git(root, 'commit', '-q', '--allow-empty', '-m', 'More')
      assert.isFalse(yield* onlyTheFix(root, merge, git(root, 'rev-parse', 'HEAD')))
      assert.isNull(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
      // The one commit must sit on the merge itself: a merge of other work in its place isn't a fix.
      git(root, 'reset', '-q', '--hard', merge)
      git(root, 'checkout', '-q', '-b', 'elsewhere', conflict.from)
      writeFileSync(join(root, 'e.txt'), 'e\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Elsewhere again')
      git(root, 'checkout', '-q', 'task')
      git(root, 'merge', '-q', '--no-ff', '--no-edit', 'elsewhere')
      assert.isNull(yield* onlyTheResolution(root, conflict, git(root, 'rev-parse', 'HEAD')))
    }),
  )

  it.effect('finds what conflicts merging here without moving anything, and says where it can’t tell', () =>
    Effect.gen(function* () {
      const { root, conflict } = split()
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', conflict.from), ['a.txt', 'b.txt'])
      assert.strictEqual(git(root, 'rev-parse', 'main'), conflict.target)
      assert.isNull(yield* conflictsOf(root, 'develop', conflict.from))
      assert.isNull(yield* conflictsOf(root, 'main', 'f'.repeat(40)))
      assert.deepStrictEqual(yield* conflictsOf(root, 'main', conflict.target), [])
    }),
  )

  it('says where several repositories conflict, and names a pull request it can’t find', () => {
    const one = { repository: 'web', name: 'web', branch: 'develop', ref: 'develop', target: 'a', from: 'b', files: ['README.md'] }
    const two = { repository: 'api', name: 'api', branch: 'main', ref: 'main', target: 'c', from: 'd', files: ['a.ts', 'b.ts'] }
    assert.strictEqual(whereLine([one, two]), 'the default branch in 2 repositories')
    const note = noteFor([one, two], { change: null }, null)
    assert.include(note, 'in web, develop conflicts in README.md; in api, main conflicts in a.ts, b.ts.')
    assert.include(note, "Merge, don't rebase: a branch that was pushed can't be rewritten.")
    assert.include(note, "Then say it's ready to merge again.")
    // The lead is told to commit the merge before anything slow, and before its turn ends, whatever it conflicts in.
    for (const text of [note, noteFor([one], { change: 'PR #1' }, null), noteFor([one], { change: null }, null)]) {
      assert.include(text, 'Commit the merge as soon as the conflicts are settled and the quick checks pass')
      assert.include(text, "don't end your turn with the merge uncommitted, or while you wait on something running in the background")
      assert.include(text, 'If the full tests then find something, fix it in')
    }
    assert.include(noteFor([one], { change: 'PR #1' }, null), 'fix it in one follow-up commit on top of the merge')
    assert.include(noteFor([one], { change: 'PR #1' }, null), "Althar pushes the merge and that fix to PR #1. Don't push it yourself.")
    assert.notInclude(noteFor([one], { change: null }, null), 'Althar pushes')
    // Asked once more where the merge was all that was left, it is told so, not asked to resolve it again.
    const commit = noteFor([one], { change: 'PR #1' }, "The merge of origin/develop isn't committed.", [one])
    assert.match(commit, /^Your merge is resolved but not committed: commit it\. Don't end your turn with the merge uncommitted/)
    assert.notInclude(commit, 'Try once more')
    assert.notInclude(commit, 'settle each conflict')
    assert.include(commit, "Althar pushes the merge and that fix to PR #1. Don't push it yourself.")
    assert.match(noteFor([one, two], { change: null }, 'web: …', [one]), /^Your merge in web is resolved but not committed: commit it\./)
    assert.match(
      noteFor([one, two], { change: null }, 'web: …', [one, two]),
      /^Your merges in web and api are resolved but not committed: commit each\./,
    )
    // Anything else still left is asked as before.
    assert.match(
      noteFor([one], { change: null }, 'README.md still conflicts.'),
      /^The conflict isn't resolved yet: README.md still conflicts\. Try once more\. /,
    )
    assert.strictEqual(changeOf({ change: null }), 'the pull request')
    const fix = fixNoteFor({ change: null }, { failing: ['test'], logs: [] })
    assert.match(fix, /^Checks failed on the merge Althar pushed to the pull request: test\.\n\nRead more with read_checks:/)
    assert.include(fix, '\n\nFix what broke and commit the fix as one commit on top of the merge')
    assert.include(fix, 'Althar pushes it to the pull request too.')
  })
})
