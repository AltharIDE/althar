import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
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

/** A planned task whose lead did its part and whose draft pull request opened, reviewed as `markers` say: ready. */
const opened = (working: string, markers = '[review:pass]') =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* coordinator.thread(project.projectId)
    const body = `Add a retry. [coordinator:plan] [lead:finish] [lead:edit] ${markers}`
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
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
        { summary: 'Retries twice now.' },
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
