import { execFileSync } from 'node:child_process'
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Exit, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { ShipRefused } from '../src/errors'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * Talking to a lead once its plan is done (a task is a conversation plus
 * parts, "Talking to a lead, and shipping"): what the person says is a turn,
 * not a round, with no step, no report and no review. What the turn commits
 * stays on the task's branch, held for Ship: nothing pushes it, Althar's own
 * course included, until the person ships it. Ship runs the plan's reviewer
 * first, one pass over everything since the last review, then sends the
 * commits up: to the open pull request, or a new one after the last merged.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

/** The host merges a pull request by squashing it: main gets one commit with its branch's change, and the branch stays as it was. */
const squashMerge = (bare: string, branch: string) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const as = ['-c', 'user.name=Host', '-c', 'user.email=host@althar.test']
  git(clone, ...as, 'merge', '-q', '--squash', `origin/${branch}`)
  git(clone, ...as, 'commit', '-q', '-m', `Squashed ${branch}`)
  git(clone, 'push', '-q', 'origin', 'main')
}

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
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; planId: string | null; parameters: string }>`
      SELECT state, plan_id, parameters FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

const heldAt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ heldAt: string | null }>`SELECT held_at FROM workspaces WHERE task_id = ${taskId}`
    return row?.heldAt ?? null
  })

const results = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'step_result').map((item) => item.content))

/** What the person says to the task's lead, as the task's screen says it; a lead stopped since, as by settling, starts again. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const live = Option.isSome(yield* sessions.running(threadId))
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
    if (!live) yield* Effect.ignore(sessions.startLast(threadId))
  })

/** Waits until the lead's turn is over, nothing of it at work. */
const idle = (threadId: string) =>
  until(
    Effect.flatMap(Sessions, (sessions) => sessions.busy(threadId)),
    (busy) => !busy,
  )

/** Waits until the thread's turns are all over, `count` of them. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId}`,
      (rows) => rows.length >= count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    yield* idle(threadId)
  })

/**
 * A planned task whose lead did its part and whose draft pull request opened, reviewed as `markers` say: ready. In a project
 * that ends its tasks on their branch (`ends`), it opens none.
 */
const opened = (working: string, markers = '[review:pass]', ends?: 'none') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    if (ends !== undefined) yield* (yield* Policies).set(project.projectId, { end: ends }, instance.personId)
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(
      cards(project.projectId),
      (all) => all[0]?.phase === 'ready' && (ends !== undefined || all[0].change !== null),
    )
    const card = ready ?? assert.fail('no card')
    yield* idle(card.threadId)
    const sql = yield* SqlClient.SqlClient
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const [turns] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${card.threadId}`
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', turns: turns?.n ?? 0 }
  })

const BRANCH = 'althar/add-a-retry'

describe('talking to a lead once its plan is done', () => {
  it.live('is a turn: no round, no report, no review, and what it commits waits on the branch for Ship', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const changes = yield* Changes
      const task = yield* opened(working)
      const pushed = git(bare, 'rev-parse', BRANCH)
      const reviewed = git(task.path, 'rev-parse', 'HEAD')

      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      // It commits just after its turn, as a lead may: what it committed then is the turn's too.
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const tweak = git(task.path, 'rev-parse', 'HEAD')
      assert.notStrictEqual(tweak, reviewed)

      // No round opened: the plan's run is the task's only one, no step reported, and the lead wasn't asked to.
      assert.deepStrictEqual(
        (yield* runsOf(task.taskId)).map((run) => [run.state, run.planId === null]),
        [['succeeded', false]],
      )
      assert.deepStrictEqual(
        (yield* results(task.threadId)).map((result) => result.step),
        ['implement', 'review', 'publish'],
      )
      const reminded = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE body LIKE 'Your step isn''t done%'`
      assert.lengthOf(reminded, 0)

      // Held for Ship: nothing went up, the card says how much waits and the task is the person's, in Needs you.
      const [held] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
      assert.strictEqual(held?.held?.commits, 1)
      assert.strictEqual(held?.phase, 'ready')
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      const header = yield* (yield* Queries).thread(task.threadId)
      assert.strictEqual(header.task.held?.commits, 1)

      // The person's Push, or the lead's, doesn't go past it: only Ship sends it up.
      const refused = yield* Effect.exit(changes.push(task.taskId, tweak))
      assert.isTrue(Exit.isFailure(refused))
      if (Exit.isFailure(refused)) assert.include(String(refused.cause), 'ShipRefused')
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const told = yield* callTool(
        { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
        'push_to_pull_request',
        {},
      )
      assert.match(told, /^What's committed on the branch waits for the person's Ship \(1 commit for PR #1\)/)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      assert.strictEqual(github.changes[0]?.number, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('holds what the first turn commits though its lead pushes before the turn ends, until Ship sends it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      // A project that pushes what a lead commits by itself, as by default.
      const task = yield* opened(working)
      const pushed = git(bare, 'rev-parse', BRANCH)
      // Within the turn, before it ends, it commits and calls push_to_pull_request.
      yield* say(task.threadId, 'Push it now. push pls [lead:push]')
      yield* answered(task.threadId, task.turns + 1)
      const tweak = git(task.path, 'rev-parse', 'HEAD')
      assert.strictEqual(git(task.path, 'log', '-1', '--format=%s', tweak), 'Tidy up before pushing')
      // Its tool held it then and there, and said so: nothing went up, and no one is asked to push it.
      const [answer] = yield* sql<{ text: string }>`
        SELECT json_extract(content, '$.text') AS text FROM thread_items
        WHERE thread_id = ${task.threadId} AND kind = 'agent_message' AND json_extract(content, '$.text') LIKE '%waits for the person''s Ship%'`
      assert.match(answer?.text ?? '', /^What's committed on the branch waits for the person's Ship \(1 commit for PR #1\)/)
      assert.isNotNull(yield* heldAt(task.taskId))
      yield* Effect.sleep(Duration.seconds(1))
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      const asked = yield* sql<{ id: string }>`SELECT id FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'push_request'`
      assert.lengthOf(asked, 0)

      // Ship sends it, after its review: up to the branch's head here, as pushing credits it.
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), 'Tidy up before pushing')
      yield* until(heldAt(task.taskId), (at) => at === null)
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('ships with one review of only what came since the last, then sends the commits up and lets go of the hold', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working)
      const reviewed = git(task.path, 'rev-parse', 'HEAD')
      const pushed = git(bare, 'rev-parse', BRANCH)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const tweak = git(task.path, 'rev-parse', 'HEAD')

      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      // Its reviewer reads what came after the last review, and only that.
      const [brief] = yield* until(
        sql<{ body: string }>`
          SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The person ships%'`,
        (rows) => rows.length === 1,
      )
      assert.include(brief?.body, `git diff ${reviewed.slice(0, 12)}`)
      assert.include(brief?.body, `- ${git(task.path, 'log', '-1', '--format=%s', tweak)}`)

      // Passed, the commits go up to the open pull request, the hold goes, and the thread says what shipped where.
      // Up to the branch's head here, as pushing credits it: the tweak with it, and nothing left ahead.
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), git(task.path, 'log', '-1', '--format=%s', tweak))
      yield* until(heldAt(task.taskId), (at) => at === null)
      const all = yield* runsOf(task.taskId)
      assert.deepStrictEqual(
        all.map((run) => [run.state, run.planId === null, JSON.parse(run.parameters).ships !== undefined]),
        [
          ['succeeded', false, false],
          ['succeeded', true, true],
        ],
      )
      const said = yield* results(task.threadId)
      assert.deepStrictEqual(
        said.map((result) => result.step),
        ['implement', 'review', 'publish', 'review', 'publish'],
      )
      assert.strictEqual(said.at(-1)?.summary, 'Shipped 1 commit to PR #1.')
      const [card] = yield* until(cards(task.projectId), (cards) => cards[0]?.held === undefined && cards[0]?.phase === 'ready')
      assert.strictEqual(card?.change?.number, 1)
      assert.lengthOf(github.changes, 1)
      // Nothing waits now: Ship has nothing to send.
      const again = yield* Effect.flip(
        runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId }),
      )
      assert.instanceOf(again, ShipRefused)
      assert.strictEqual((again as ShipRefused).why, 'nothing')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('ships at once where the plan has no reviewer', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const tweak = git(task.path, 'rev-parse', 'HEAD')
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      // Up to the branch's head here, as pushing credits it: the tweak with it, and nothing left ahead.
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), git(task.path, 'log', '-1', '--format=%s', tweak))
      yield* until(heldAt(task.taskId), (at) => at === null)
      assert.deepStrictEqual(
        (yield* results(task.threadId)).map((result) => result.step),
        ['implement', 'publish', 'publish'],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('lets the person skip a Ship’s review: what waits goes up without it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      // Its reviewer passes the plan's review, and reads a later one until it is stopped.
      const task = yield* opened(working, '[review:pass] [review:wait-later]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('task.skip_review', {}), taskId: task.taskId })
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      yield* until(heldAt(task.taskId), (at) => at === null)
      // No review result for it: the plan's own, then what Ship sent up.
      assert.deepStrictEqual(
        (yield* results(task.threadId)).map((result) => result.step),
        ['implement', 'review', 'publish', 'publish'],
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('holds nothing where the turn only answered', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      yield* say(task.threadId, 'What did you change?')
      yield* answered(task.threadId, task.turns + 1)
      assert.isNull(yield* heldAt(task.taskId))
      assert.isUndefined((yield* cards(task.projectId))[0]?.held)
      assert.lengthOf(yield* runsOf(task.taskId), 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keeps a summary the lead gives in a turn, and opens nothing for it', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const [lead] = yield* sql<{ id: string }>`
        SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
      const said = yield* callTool(
        { role: 'lead', projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId },
        'finish_step',
        { summary: 'Retries twice now.', built: 'Checkout retries twice when the payment call fails.' },
      )
      assert.strictEqual(
        said,
        'Althar has your summary. What you committed waits on the branch for the person’s Ship, which reviews it and then pushes it.',
      )
      assert.strictEqual((yield* results(task.threadId)).at(-1)?.summary, 'Retries twice now.')
      assert.lengthOf(yield* runsOf(task.taskId), 1)
      assert.isNotNull(yield* heldAt(task.taskId))
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('after the pull request merged, ships the tweak as the next one, with its review', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* opened(working)
      squashMerge(bare, BRANCH)
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')

      // Written to again, settled, its lead's tweak waits: the task is the person's again, not settled.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const [held] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
      assert.strictEqual(held?.held?.commits, 1)
      assert.strictEqual(held?.phase, 'ready')
      assert.lengthOf(yield* runsOf(task.taskId), 1)

      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      const second = github.changes[1]
      assert.deepStrictEqual([second?.source, second?.target, second?.draft], [`${BRANCH}-2`, 'main', true])
      assert.strictEqual(git(bare, 'rev-list', '--count', `main..${BRANCH}-2`), '1')
      yield* until(heldAt(task.taskId), (at) => at === null)
      const [shipped] = yield* until(cards(task.projectId), (all) => all[0]?.change?.number === 2)
      assert.isUndefined(shipped?.held)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

/** The lead of a task's thread, as its tools are called. */
const leadOf = (task: { readonly projectId: string; readonly threadId: string; readonly taskId: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
    return { role: 'lead' as const, projectId: task.projectId, threadId: task.threadId, sessionId: lead?.id ?? '', taskId: task.taskId }
  })

/** What needs the person on the task, once something does. */
const attentionOf = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const [call] = yield* until(
      Effect.map(queries.thread(threadId), (snapshot) => snapshot.attention),
      (attention) => attention.length === 1,
    )
    return call ?? assert.fail('nothing needs the person')
  })

describe('a Ship', () => {
  it.live('is refused for a task it can’t find, and while the lead is at work; the lead’s own waits for its turn to end', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sessions = yield* Sessions
      const unknown = yield* Effect.flip(runs.ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: 'task_none' }))
      assert.strictEqual((unknown as { readonly _tag: string })._tag, 'NotFound')

      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      // Within a turn that takes a while, the lead commits and asks to push.
      yield* say(task.threadId, 'Push it now. push pls [lead:push] [lead:slowly]')
      yield* until(sessions.busy(task.threadId), (busy) => busy)
      // The person's Ship while it works is refused: it ships with what the turn does, once that's done.
      const refused = yield* Effect.flip(
        runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId }),
      )
      assert.instanceOf(refused, ShipRefused)
      assert.strictEqual((refused as ShipRefused).why, 'working')
      // Its lead's own Ship, asked in that turn, waits for the turn to end, then sends up what it committed.
      const told = yield* callTool(yield* leadOf(task), 'ship_task', {})
      assert.match(told, /^Althar ships this task once your turn ends: /)
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), 'Tidy up before pushing')
      yield* until(heldAt(task.taskId), (at) => at === null)
      assert.strictEqual((yield* results(task.threadId)).at(-1)?.summary, 'Shipped 1 commit to PR #1.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('that can’t reach the host needs the person, and ships what two turns committed once they answer', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      // Two turns, each committing: both wait for one Ship.
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* say(task.threadId, 'And log each retry. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 2)
      yield* until(cards(task.projectId), (all) => all[0]?.held?.commits === 2)

      // The remote can't be reached: what Ship sends can't go, and the person is asked.
      renameSync(bare, `${bare}-away`)
      // The coordinator ships it, as the person asked it to.
      const threadId = yield* (yield* Coordinator).thread(task.projectId)
      const coordinator = { role: 'coordinator' as const, projectId: task.projectId, threadId, sessionId: 'none', taskId: null }
      const slug = (yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${task.taskId}`)[0]?.slug ?? ''
      assert.match(yield* callTool(coordinator, 'ship_task', { task: slug }), new RegExp(`^Shipping ${slug}: `))
      const call = yield* attentionOf(task.threadId)
      assert.deepInclude(call.stuck, { step: 'publish', why: 'failed_to_start' })
      renameSync(`${bare}-away`, bare)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      assert.isNotNull(yield* heldAt(task.taskId))

      // Back, and asked to try again, both commits go up at once.
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call.id,
        answer: { kind: 'retry', agentId: 'claude-code' },
      })
      yield* until(
        Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD')] as const),
        ([there, here]) => there === here && there !== pushed,
      )
      assert.strictEqual(git(bare, 'rev-list', '--count', `${pushed}..${BRANCH}`), '2')
      yield* until(heldAt(task.taskId), (at) => at === null)
      yield* until(results(task.threadId), (said) => said.at(-1)?.summary === 'Shipped 2 commits to PR #1.')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('leaves its lead nothing to wait on the person for in a turn, nor while its review reads', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working, '[review:pass] [review:wait-later]')
      const lead = yield* leadOf(task)
      // In a turn, with no step open: its question is its answer.
      assert.match(
        yield* callTool(lead, 'wait_for_person', { question: 'Retry twice or three times?' }),
        /^No step is open, so there is nothing to hold: /,
      )
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL AND n.node_key = 'review'`,
        (rows) => rows[0]?.state === 'running',
      )
      // While the Ship's review reads, no step of the lead's is open: nothing waits on the person for it.
      assert.strictEqual(
        yield* callTool(lead, 'wait_for_person', { question: 'Retry twice or three times?' }),
        'No step is waiting on you, so there is nothing to wait on the person for.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('opens the task’s first pull request, a draft, where its plan ended on its branch', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* opened(working, '[coordinator:plan-no-review]', 'none')
      assert.lengthOf(github.changes, 0)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 1,
      )
      assert.deepStrictEqual([github.changes[0]?.source, github.changes[0]?.draft], [BRANCH, true])
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), git(task.path, 'rev-parse', 'HEAD'))
      yield* until(heldAt(task.taskId), (at) => at === null)
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.change?.number === 1)
      assert.isUndefined(card?.held)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('leaves a round opened before talking became turns to end as it did: reviewed, then in the next pull request', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working)
      squashMerge(bare, BRANCH)
      github.mergeByHand(1)
      yield* (yield* Changes).refresh(task.taskId)
      yield* until(cards(task.projectId), (all) => all[0]?.phase === 'settled')
      // A round a person's words opened before the update, on the lead's session, still under way after it: one that doesn't
      // publish itself, but ends as such a round did.
      const lead = yield* leadOf(task)
      assert.isTrue(yield* runs.madeRound(task.taskId, lead.sessionId))
      yield* sql`UPDATE runs SET parameters = json_remove(parameters, '$.publishes') WHERE task_id = ${task.taskId} AND plan_id IS NULL`
      // Its lead commits after the merge, then reports.
      writeFileSync(join(task.path, 'retry.md'), 'Twice.\n')
      git(task.path, 'add', 'retry.md')
      git(task.path, 'commit', '-q', '-m', 'Retry twice')
      yield* callTool(lead, 'finish_step', {
        summary: 'Retries twice now.',
        built: 'Checkout retries twice.',
        descriptions: [{ text: 'Retries twice.' }],
      })
      // Reviewed for what it changed since the round began, it opens the next pull request, a draft, with that commit.
      yield* until(
        sql<{ body: string }>`
          SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The task''s earlier work%'`,
        (rows) => rows.length === 1,
      )
      yield* until(
        Effect.sync(() => github.changes.length),
        (count) => count === 2,
      )
      assert.deepStrictEqual([github.changes[1]?.source, github.changes[1]?.draft], [`${BRANCH}-2`, true])
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', `${BRANCH}-2`), 'Retry twice')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('with no host connected says so, and keeps holding what waits', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working, '[coordinator:plan-no-review]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      // The connection its pull request was opened through is gone meanwhile.
      yield* sql`UPDATE external_links SET connection_id = NULL WHERE task_id = ${task.taskId}`
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      const call = yield* attentionOf(task.threadId)
      assert.deepInclude(call.stuck, { step: 'publish', why: 'not_connected' })
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      assert.isNotNull(yield* heldAt(task.taskId))
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('commits the person makes by hand', () => {
  it.live('hold the branch for Ship as the next turn begins, and nothing pushes them first', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working)
      const pushed = git(bare, 'rev-parse', BRANCH)
      assert.isNull(yield* heldAt(task.taskId))
      // The person commits by hand in the task's folder, a while after the lead's last turn, then says something to its lead.
      writeFileSync(join(task.path, 'by-hand.txt'), 'mine\n')
      git(task.path, 'add', 'by-hand.txt')
      const later = new Date(Date.now() + 10 * 60_000).toISOString()
      execFileSync('git', ['commit', '-q', '-m', 'By hand'], { cwd: task.path, env: { ...process.env, GIT_AUTHOR_DATE: later } })
      yield* say(task.threadId, 'What do you think of it?')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      yield* answered(task.threadId, task.turns + 1)
      // Held: nothing pushed it, and its card says it waits for Ship.
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      const [card] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
      assert.strictEqual(card?.held?.commits, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

/**
 * Main moves on while the task's pull request waits: other people's merged work, written an hour before, on the host, and
 * fetched here as origin/main. With `clash`, one of them writes the file the task's lead wrote, so merging it conflicts.
 */
const mainMovesOn = (bare: string, path: string, clash = false) => {
  const clone = mkdtempSync(join(tmpdir(), 'althar-main-'))
  execFileSync('git', ['clone', '-q', bare, clone])
  const earlier = new Date(Date.now() - 60 * 60_000).toISOString()
  const env = { ...process.env, GIT_AUTHOR_DATE: earlier, GIT_COMMITTER_DATE: earlier }
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(clone, file), text)
    git(clone, 'add', '-A')
    execFileSync('git', ['-c', 'user.name=Other', '-c', 'user.email=other@althar.test', 'commit', '-q', '-m', message], {
      cwd: clone,
      env,
    })
  }
  commit('usage.ts', 'usage\n', 'Usage card drops the time breakdown (#763)')
  commit('timing.ts', 'timing\n', 'Stop summing task timing (#767)')
  if (clash) commit('change.txt', 'theirs\n', 'Change it on main too (#770)')
  git(clone, 'push', '-q', 'origin', 'main')
  git(path, 'fetch', '-q', bare, '+main:refs/remotes/origin/main')
}

const stepsSaid = (threadId: string) => Effect.map(results(threadId), (said) => said.map((result) => result.step))

/** Its branch here and on the host are the same, and moved on from `pushed`: what waited went up. */
const wentUp = (bare: string, path: string, pushed: string) =>
  until(
    Effect.sync(() => [git(bare, 'rev-parse', BRANCH), git(path, 'rev-parse', 'HEAD')] as const),
    ([there, here]) => there === here && there !== pushed,
  )

describe('a merge of main into the task’s branch after its pull request opened', () => {
  it.live('with no conflict starts no review and no round: it goes up to the pull request, and the task stays where it was', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const task = yield* opened(working, '[review:pass] [lead:merge-main]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path)
      // As #773's lead did once the queue sent it back: it merges main, two merged pull requests and the merge.
      yield* say(task.threadId, 'The queue sent it back. bring main in pls')
      yield* answered(task.threadId, task.turns + 1)
      assert.strictEqual(git(task.path, 'rev-list', '--count', `${pushed}..HEAD`), '3')

      // Pushed to the pull request as the turn ended, with nothing held for Ship.
      yield* wentUp(bare, task.path, pushed)
      assert.strictEqual(git(bare, 'rev-list', '--count', `${pushed}..${BRANCH}`), '3')
      assert.isNull(yield* heldAt(task.taskId))
      // No round: the plan's run is the task's only one, and its steps are the plan's.
      assert.deepStrictEqual(
        (yield* runsOf(task.taskId)).map((run) => [run.state, run.planId === null]),
        [['succeeded', false]],
      )
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish'])
      const [card] = yield* cards(task.projectId)
      assert.isUndefined(card?.held)
      assert.strictEqual(card?.phase, 'ready')
      assert.lengthOf(github.changes, 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('that settled a conflict is the task’s work: it waits for Ship, whose review reads how the merge settled it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working, '[review:pass] [lead:merge-main]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path, true)
      yield* say(task.threadId, 'Main moved. bring main in pls')
      yield* answered(task.threadId, task.turns + 1)
      const merge = git(task.path, 'rev-parse', 'HEAD')
      // Held for Ship, as a turn's own work is: nothing went up.
      yield* until(heldAt(task.taskId), (at) => at !== null)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)

      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      const [brief] = yield* until(
        sql<{ body: string }>`
          SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The person ships%'`,
        (rows) => rows.length === 1,
      )
      // It lists the merge, not main's commits as the task's, and says how to read what the merge settled.
      assert.include(brief?.body, `git show --remerge-diff ${merge.slice(0, 12)}`)
      assert.include(brief?.body, "- Merge remote-tracking branch 'origin/main'")
      assert.notInclude(brief?.body, 'Usage card')
      yield* wentUp(bare, task.path, pushed)
      yield* until(stepsSaid(task.threadId), (steps) => steps.length === 5)
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish', 'review', 'publish'])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('with a commit of the task’s own after it, ships as today: held, reviewed, then sent up', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* opened(working, '[review:pass] [lead:merge-main]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path)
      yield* say(task.threadId, 'bring main in pls and tidy')
      yield* answered(task.threadId, task.turns + 1)
      yield* until(heldAt(task.taskId), (at) => at !== null)
      assert.strictEqual(git(bare, 'rev-parse', BRANCH), pushed)
      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* wentUp(bare, task.path, pushed)
      yield* until(heldAt(task.taskId), (at) => at === null)
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish', 'review', 'publish'])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('sent back by the merge queue for its checks, its lead brings main in with update_branch: no new steps, no round', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const changes = yield* Changes
      github.mergeQueue()
      const task = yield* opened(working, '[review:pass] [lead:update-branch]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      const [card] = yield* cards(task.projectId)
      yield* changes.merge(task.taskId, card?.change?.head ?? '')
      yield* changes.refresh(task.taskId)
      // As #773 was: behind main, and out of the queue for its checks, not for a conflict.
      github.fallBehind(1)
      github.dequeue(1, 'checks')
      yield* changes.refresh(task.taskId)
      yield* until(
        Effect.sync(() => github.branchesUpdated.length),
        (count) => count === 1,
      )
      yield* answered(task.threadId, task.turns + 1)
      // The host merged main into the pull request's branch; the lead redid nothing, and Althar started nothing.
      assert.deepStrictEqual(
        github.branchesUpdated.map((one) => one.number),
        [1],
      )
      assert.strictEqual(git(task.path, 'rev-parse', 'HEAD'), pushed)
      assert.isNull(yield* heldAt(task.taskId))
      assert.deepStrictEqual(
        (yield* runsOf(task.taskId)).map((run) => [run.state, run.planId === null]),
        [['succeeded', false]],
      )
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish'])
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('held for Ship before, as #773 was, Ship sends it up with no review and no round', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working, '[review:pass]')
      const pushed = git(bare, 'rev-parse', BRANCH)
      mainMovesOn(bare, task.path)
      git(task.path, '-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', 'merge', '-q', '--no-edit', 'origin/main')
      // Held as Althar held #773's merge: main's commits taken for the person's by hand.
      const at = new Date().toISOString()
      yield* sql`UPDATE workspaces SET held_at = ${at} WHERE task_id = ${task.taskId}`
      const [held] = yield* until(cards(task.projectId), (all) => all[0]?.held !== undefined)
      assert.strictEqual(held?.held?.commits, 3)

      yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', { taskId: task.taskId }), taskId: task.taskId })
      yield* wentUp(bare, task.path, pushed)
      yield* until(heldAt(task.taskId), (at) => at === null)
      assert.lengthOf(yield* runsOf(task.taskId), 1)
      assert.deepStrictEqual(yield* stepsSaid(task.threadId), ['implement', 'review', 'publish'])
      const notices = yield* sql<{ title: string }>`
        SELECT json_extract(content, '$.title') AS title FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'notice'`
      assert.include(
        notices.map((one) => one.title),
        'Pushed 3 commits to PR #1. They only bring its base branch in, so they start no review.',
      )
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('Merge, with commits not shipped', () => {
  it.live('Merge now sends what waits up and merges at once, and its review after the merge reads only that', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working)
      const reviewed = git(task.path, 'rev-parse', 'HEAD')
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const tweak = git(task.path, 'rev-parse', 'HEAD')

      yield* runs.mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'now' }),
        taskId: task.taskId,
        how: 'now',
      })
      // Up and merged at once: no review before it, no Ship run.
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), git(task.path, 'log', '-1', '--format=%s', tweak))
      assert.deepStrictEqual(
        github.merged.map((one) => [one.number, one.how]),
        [[1, 'merge']],
      )
      assert.isNull(yield* heldAt(task.taskId))
      assert.lengthOf(yield* runsOf(task.taskId), 1)
      // Reviewed after the merge, in the task, from what the plan's review read: only the tweak.
      const [owed] = yield* until(
        sql<{ state: string; base: string | null }>`SELECT state, base FROM merge_reviews WHERE task_id = ${task.taskId}`,
        (rows) => rows[0]?.state === 'clear' || rows[0]?.state === 'found',
      )
      assert.strictEqual(owed?.base, reviewed)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('Review and merge ships what waits with one review, then merges it', () => {
    const { working, bare, github } = onGitHub()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Runs
      const task = yield* opened(working)
      yield* say(task.threadId, 'Make it retry twice. tidy pls [lead:commit]')
      yield* until(heldAt(task.taskId), (at) => at !== null)
      const tweak = git(task.path, 'rev-parse', 'HEAD')

      yield* runs.mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'review' }),
        taskId: task.taskId,
        how: 'review',
      })
      // A Ship's run that merges: its review reads what waited, then it goes up and merges.
      yield* until(
        Effect.sync(() => github.merged.length),
        (count) => count === 1,
      )
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', BRANCH), git(task.path, 'log', '-1', '--format=%s', tweak))
      const runs_ = yield* runsOf(task.taskId)
      assert.lengthOf(runs_, 2)
      assert.include(runs_[1]?.parameters ?? '', '"merges":true')
      const asked = yield* sql<{ body: string }>`
        SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review. The person ships%'`
      assert.lengthOf(asked, 1)
      // Reviewed before it merged: nothing is owed after.
      const [after] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM merge_reviews WHERE task_id = ${task.taskId}`
      assert.strictEqual(after?.n, 0)
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('with nothing waiting, either merges it as it stands', () => {
    const { working, github } = onGitHub()
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* opened(working)
      yield* runs.mergeWaiting({
        envelope: yield* Runtime.envelope('task.merge', { taskId: task.taskId, how: 'review' }),
        taskId: task.taskId,
        how: 'review',
      })
      assert.deepStrictEqual(
        github.merged.map((one) => one.number),
        [1],
      )
      assert.lengthOf(yield* runsOf(task.taskId), 1)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
