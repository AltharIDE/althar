import { execFileSync } from 'node:child_process'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { Holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

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
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

/*
 * A sanity pass over what each surface says of a task's pull request: here, what the coordinator is told of commits that
 * wait on the task's branch for Ship (docs/decisions/tasks.md, "What the turn commits waits for Ship"), as PR #820's were
 * while its Ship's review read them. Each test asserts what the decisions say, and is marked to fail while the runtime
 * does otherwise: it flips to passing once the finding is fixed.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/** A repository on the fake GitHub, its lead committing as the person does. */
const onGitHub = () => {
  const { working, bare } = hosted()
  const github = makeFakeService({ pushUrl: () => bare })
  github.addRepository(['meridian', 'api'])
  git(working, 'config', 'user.name', 'Fake')
  git(working, 'config', 'user.email', 'fake@althar.test')
  return { working, bare, github }
}

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** Waits until the thread's agent is in no turn. */
const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/** What the person says to the task's lead, as the task's screen says it. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const live = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    if (!live) yield* Effect.ignore(sessions.startLast(threadId))
  })

/**
 * A planned task whose lead did its part, whose review passed and whose draft pull request opened, in a project that pushes
 * a lead's commits on their own (as by default). Its reviewer reads a later round (a Ship's) until it is stopped.
 */
const opened = (working: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:pass] [review:wait-later]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change != null)
    const card = ready ?? assert.fail('no card')
    yield* idle(card.threadId)
    const sql = yield* SqlClient.SqlClient
    // The coordinator's own session, as its tools are called with it.
    const [session] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC LIMIT 1`
    const coordinatorAccess = {
      role: 'coordinator' as const,
      projectId: project.projectId,
      threadId,
      sessionId: session?.id ?? '',
      taskId: null,
    }
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, coordinatorAccess }
  })

describe('commits that wait on the branch for Ship, as the coordinator is told of them', () => {
  // Finding (sanity pass): what the person's turns with a lead commit is held for Ship, and only Ship sends it up: the person's
  // Push is refused (ShipRefused), as is the lead's own. But read_task tells the coordinator they "are not on the pull request
  // yet; the person pushes them" (pullRequestStanding.ts, pushedWords: the change's `pushing` is absent for a worktree held
  // for Ship, Changes.pushingOf, which reads as "every push is the person's"), and says nothing of Ship, nor that Ship's
  // review is under way. So on PR #820 the coordinator, reading the task while Ship's review read the two commits, told the
  // person Ship had "left 2 commits unpushed", called it a bug, and that pressing "Push 2 commits" was safe. Flips to passing
  // when fixed.
  it.live.fails('read_task says commits held for Ship wait for Ship, not that the person pushes them', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      // The person asks for more once its pull request is open: what the lead commits is held for Ship.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(cards(task.projectId), (all) => all[0]?.held?.commits === 1 && all[0]?.phase === 'ready')
      // The person presses Ship; its review reads the commit, and is still reading it.
      yield* (yield* Runs).ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      const [card] = yield* cards(task.projectId)
      assert.strictEqual(card?.held?.commits, 1)
      assert.strictEqual(card?.change?.unpushed, 1)
      // Not the person's to push: Althar refuses their Push while Ship holds it.
      const refused = yield* Effect.flip((yield* Changes).push(task.taskId, card?.change?.localHead ?? ''))
      assert.instanceOf(refused, ShipRefused)
      // What the coordinator reads of the task.
      const read = yield* callTool(task.coordinatorAccess, 'read_task', { task: task.taskId })
      assert.include(read, "1 commit on the task's branch is not on the pull request yet")
      assert.notMatch(read, /the person pushes them/)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('commits that wait on the branch for Ship, while the lead works again', () => {
  // Finding (sanity pass): while a task's lead is in a turn, Changes.pushingOf says every one of its pull requests' commits
  // "go up as its lead's turn ends" (`pushing.held` null), without looking at the hold for Ship; but a worktree held for Ship
  // goes up with Ship alone (pushLeftOn returns at `heldAt`). So while the person talks to the lead again, the card says the
  // held commits are "going up to the PR" (standing.ts, its merge needs "1 commit going up"), and read_task tells the
  // coordinator "Althar pushes them as the lead's turn ends": none of them goes up when it ends. Flips to passing when fixed.
  it.live.fails('doesn’t say what waits for Ship goes up as the lead’s turn ends', () => {
    const { working, bare, github } = onGitHub()
    // The lead's turns go at once, but where the test holds one with `[lead:slowly]`.
    const held: Holds = { open: () => undefined, opened: () => false }
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(cards(task.projectId), (all) => all[0]?.held?.commits === 1 && all[0]?.phase === 'ready')
      yield* idle(task.threadId)
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      // The person asks the lead something more, and it is at it.
      yield* say(task.threadId, 'What else would you change? [lead:slowly]')
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(task.threadId)),
        (busy) => busy,
      )
      const [card] = yield* cards(task.projectId)
      assert.strictEqual(card?.held?.commits, 1)
      assert.strictEqual(card?.change?.unpushed, 1)
      // Held for Ship, it doesn't go up as the turn ends.
      assert.notStrictEqual(card?.change?.pushing?.held, null)
      const read = yield* callTool(task.coordinatorAccess, 'read_task', { task: task.taskId })
      assert.notMatch(read, /Althar pushes them as the lead's turn ends/)
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', { holds: held }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
          ),
        ),
      ),
    )
  })
})
