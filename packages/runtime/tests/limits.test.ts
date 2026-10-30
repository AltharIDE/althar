import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { type Failure, failureOf, Failures } from '../src/Failures'
import { Instance } from '../src/Instance'
import { Limits, outWords, whenWords } from '../src/Limits'
import { Policies, usageLimitOf } from '../src/Policies'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { type PlanStep, Runs, type StuckAnswer } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { RULES } from '../src/rules'
import { Sessions } from '../src/Sessions'
import { fakeAgents, items, repository, runtime, until } from './support'

/*
 * An agent out of usage (docs/architecture/05): its work moves on to the
 * next free agent, or waits for the reset, as the project says; a step that
 * can't do either needs the person. The fake agents here are out as each
 * test says: until a time, which their error gives as the reset, or for good.
 */

const HOUR = 60 * 60 * 1000

/** A runtime whose agents are out as given, with the project's queries. */
const withAgents = (each: Readonly<Record<string, FakeAgentOptions>>, signedOut: ReadonlyArray<string> = []) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each, signedOut })))

/** A project with a task planned on these steps, and what starts it: only that, not the plan's countdown, however slow the machine. */
const planned = (steps: ReadonlyArray<PlanStep>, title = 'Retry the checkout [lead:finish]') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps,
      reason: null,
      actorId: instance.personId,
      startsIn: Duration.minutes(5),
      end: null,
    })
    return { projectId: project.projectId, task, start: plans.start(planId, instance.personId) }
  })

const cardOf = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** What the thread said about it, notices and steps. */
const said = (threadId: string) =>
  Effect.map(items(threadId), (all) =>
    all.flatMap((item) =>
      item.kind === 'notice'
        ? [(item.content as { title: string }).title]
        : item.kind === 'step_result'
          ? [`${(item.content as { step: string }).step}: ${(item.content as { summary: string }).summary}`]
          : [],
    ),
  )

/** The agents' replies in a thread, and who said each. */
const replies = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ agentId: string | null; content: string }>`
      SELECT s.agent_id, i.content FROM thread_items i LEFT JOIN provider_sessions s ON s.id = i.provider_session_id
      WHERE i.thread_id = ${threadId} AND i.kind = 'agent_message' ORDER BY i.sequence`
    return rows.map((row) => ({ agentId: row.agentId, text: (JSON.parse(row.content) as { text: string }).text }))
  })

/** Sets what the project does at a usage limit, as the person would. */
const rule = (policy: 'wait' | 'ask') => (projectId: string) =>
  Effect.gen(function* () {
    const policies = yield* Policies
    const instance = yield* Instance
    yield* policies.setUsageLimit(projectId, policy, instance.personId)
  })
const waits = rule('wait')
const asks = rule('ask')

/** The call that waits on the person, once there is one: its id, and its payload read. */
const openCall = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [call] = yield* until(
    sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
    (rows) => rows.length === 1,
  )
  return { id: call?.id ?? '', payload: JSON.parse(call?.payload ?? '{}') as Record<string, unknown> }
})

/** The person's answer to a call. */
const answer = (attentionId: string, said: StuckAnswer) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.answerStuck({ envelope: yield* Runtime.envelope('attention.answer_stuck', {}), attentionId, answer: said })
  })

/** An agent's first account: its usual one. */
const usual = (agentId: string) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const [first] = yield* accounts.of(agentId)
    return first?.id ?? ''
  })

/** A reset as the agent's error gives it: to the second. */
const reset = (at: number) => new Date(Math.ceil(at / 1000) * 1000).toISOString()

const lead = (agentId: string, model: string | null = null): PlanStep => ({ key: 'implement', agentId, model, skipped: false })

describe('an agent out of usage', () => {
  it.live('hands a lead’s step to the next free agent, on the model it last ran in the project, and says so', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      // Codex ran Large in this project before.
      const before = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Earlier' })
      yield* sessions.start({ threadId: before.threadId, agentId: 'codex', model: 'large' })
      yield* sessions.stop(before.threadId)
      yield* start
      const [ready] = yield* until(cardOf(projectId), (cards) => cards.some((card) => card.phase === 'ready'))
      assert.strictEqual(ready?.lead, 'codex')
      assert.deepStrictEqual(yield* said(task.threadId), [
        `Fake claude-code ran out of usage while working on the task, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Fake codex takes the work over, on Large.`,
        'implement: Did the task.',
        'The task ends on its branch.',
      ])
      const sessionsOn = yield* sql<{ agentId: string; model: string | null }>`
        SELECT agent_id, model FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at`
      assert.deepStrictEqual(
        sessionsOn.map((session) => [session.agentId, session.model]),
        [
          ['claude-code', 'small'],
          ['codex', 'large'],
        ],
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('holds a step until the reset where the project waits, and runs it again then, on the same agent', () => {
    const back = Date.now() + 2500
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* waits(projectId)
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual([held?.phase, held?.step, held?.waits?.agentId], ['running', 'implement', 'claude-code'])
      assert.match(
        (yield* said(task.threadId))[0] ?? '',
        /^Fake claude-code ran out of usage while working on the task\. The work waits until .+, when Fake claude-code is back\. To carry on now, pick another model on the task\.$/,
      )
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual([ready?.lead, ready?.waits], ['claude-code', null])
      assert.include(yield* said(task.threadId), 'implement: Did the task.')
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('runs a held step again at its reset after Althar restarts', () => {
    const back = Date.now() + 3000
    const database = join(mkdtempSync(join(tmpdir(), 'althar-limits-')), 'profile.sqlite')
    const layer = (agents: Readonly<Record<string, FakeAgentOptions>>) =>
      Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { each: agents })))
    return Effect.gen(function* () {
      const projectId = yield* Effect.gen(function* () {
        const { projectId, start } = yield* planned([lead('claude-code')])
        yield* waits(projectId)
        yield* start
        yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
        return projectId
      }).pipe(Effect.provide(layer({ 'claude-code': { outOfUsage: { until: back } } })))
      // Started again, it waits on for the reset, and then the step runs on a new session.
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready').pipe(Effect.provide(layer({})))
      assert.strictEqual(ready?.lead, 'claude-code')
    })
  })

  it.live('runs the other held steps at their reset past one it can’t read and one that can’t go on, which waits a while', () => {
    const back = Date.now() + 4000
    const reported: Array<Failure> = []
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const unreadable = yield* planned([lead('claude-code')], 'Unreadable [lead:finish]')
      const stuck = yield* planned([lead('claude-code')], 'Stuck [lead:finish]')
      const kept = yield* planned([lead('claude-code')], 'Kept [lead:finish]')
      const heldOf = (taskId: string) =>
        Effect.map(
          sql<{ id: string; state: string }>`
            SELECT a.id, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} ORDER BY a.rowid DESC LIMIT 1`,
          ([attempt]) => attempt,
        )
      for (const one of [unreadable, stuck, kept]) {
        yield* waits(one.projectId)
        yield* one.start
        yield* until(cardOf(one.projectId), (cards) => cards[0]?.waits != null)
      }
      // One's record no longer reads, and the store won't change another's.
      const unread = yield* heldOf(unreadable.task.taskId)
      yield* sql`UPDATE node_attempts SET output = 'null' WHERE id = ${unread?.id ?? ''}`
      const held = yield* heldOf(stuck.task.taskId)
      yield* sql.unsafe(
        `CREATE TRIGGER stuck_step BEFORE UPDATE ON node_attempts WHEN OLD.id = '${held?.id ?? ''}' BEGIN SELECT RAISE(ABORT, 'The step is stuck'); END`,
      )
      // At the reset, the third carries on all the same.
      const [ready] = yield* until(cardOf(kept.projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'claude-code')
      yield* Effect.sleep('500 millis')
      assert.deepStrictEqual([(yield* heldOf(unreadable.task.taskId))?.state, (yield* heldOf(stuck.task.taskId))?.state], ['held', 'held'])
      // The one that couldn't go on was tried once, not again at once; the one it can't read is said where it is.
      assert.deepStrictEqual(reported.filter((failure) => failure.where === 'Runs.resume').length, 1)
      assert.isTrue(reported.some((failure) => failure.where === 'Runs.held'))
    }).pipe(
      Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })),
      Effect.provideService(Failures, {
        report: (cause, where, agent) => Effect.sync(() => void reported.push(failureOf(cause, where, agent ?? null))),
        events: Stream.empty,
      }),
    )
  })

  it.live('needs the person when the reset isn’t known and nothing else is free', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, start } = yield* planned([lead('claude-code')])
      yield* start
      const [call] = yield* until(
        sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      assert.deepInclude(JSON.parse(call?.payload ?? '{}'), { step: 'implement', why: 'usage_limit', agentId: 'claude-code' })
      // The window reads it as such.
      const queries = yield* Queries
      const [card] = yield* cardOf(projectId)
      const snapshot = yield* Effect.orDie(queries.thread(card?.threadId ?? ''))
      assert.strictEqual(snapshot.attention[0]?.stuck?.why, 'usage_limit')
      // It says the reset isn't known, and lists who could take over as they stood, signed out too: the window reads them as it asks.
      assert.deepStrictEqual(snapshot.attention[0]?.stuck?.limit, {
        accountId: yield* usual('claude-code'),
        resetsAt: null,
        choices: [
          { agentId: 'codex', accountId: yield* usual('codex'), model: null },
          { agentId: 'opencode', accountId: yield* usual('opencode'), model: null },
        ],
      })
      assert.strictEqual((yield* cardOf(projectId))[0]?.phase, 'waiting')
      // With no reset to wait for, it can't wait for one.
      const open = yield* openCall
      const refused = yield* Effect.flip(answer(open.id, { kind: 'wait' }))
      assert.strictEqual((refused as { readonly _tag?: string })._tag, 'NothingToWaitFor')
      assert.strictEqual((yield* openCall).id, open.id)
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: {} } }, ['codex', 'opencode']))),
  )

  it.live('waits for the reset where no other agent is free', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const { projectId, start } = yield* planned([lead('claude-code')])
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.strictEqual(held?.waits?.until, new Date(Math.ceil(back / 1000) * 1000).toISOString())
      // Held for the reset, it is still under way: its project's tab says so.
      const queries = yield* Queries
      assert.deepInclude(
        (yield* queries.projects).projects.find((project) => project.id === projectId),
        { working: 1, ready: 0 },
      )
    }).pipe(
      Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } }, codex: { outOfUsage: { until: back } } }, ['opencode'])),
    )
  })

  /** A task planned on Claude Code with Codex reviewing, Codex already out from another task, and what its thread said once it is ready. */
  const reviewerOut = Effect.gen(function* () {
    const sessions = yield* Sessions
    const projects = yield* Projects
    const limits = yield* Limits
    const { projectId, task, start } = yield* planned(
      [lead('claude-code'), { key: 'review', agentId: 'codex', model: null, skipped: false }],
      'Retry the checkout [lead:finish] [review:pass]',
    )
    const other = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Elsewhere' })
    yield* sessions.start({ threadId: other.threadId, agentId: 'codex' })
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: other.threadId, body: 'hello' })
    yield* until(
      Effect.map(limits.out('codex'), (out) => (Option.isSome(out) ? [out] : [])),
      (outs) => outs.length === 1,
    )
    yield* start
    yield* until(cardOf(projectId), (cards) => cards.some((card) => card.taskId === task.taskId && card.phase === 'ready'))
    return yield* said(task.threadId)
  })

  it.live('starts a planned reviewer that is out on the next free agent instead, other than the lead’s', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const lines = yield* reviewerOut
      assert.include(
        lines,
        `Fake codex ran out of usage during the review, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Fake opencode takes the review over.`,
      )
      assert.include(lines, 'review: The change holds.')
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: { until: back } } })))
  })

  it.live('gives a review to the lead’s own agent only when nothing else is free, and says so', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const lines = yield* reviewerOut
      assert.include(
        lines,
        `Fake codex ran out of usage during the review, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Fake claude-code takes the review over, on Small, and reviews its own work.`,
      )
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: { until: back } } }, ['opencode'])))
  })

  it.live('never moves work to an agent paid per use: it waits for the reset instead', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* start
      yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      // It moves work on, but no other was free on a plan: it says so, and that the person can pick one.
      assert.match(
        (yield* said(task.threadId))[0] ?? '',
        /\. No other model was free, so the work waits until .+\. Pick one on the task to carry on now\.$/,
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', {}, { each: { 'claude-code': { outOfUsage: { until: back } } }, perUse: ['codex', 'opencode'] }),
          ),
        ),
      ),
    )
  })

  it.live('moves the coordinator on, with what the person said waiting for the agent that takes over', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Is the checkout slow?',
        disposition: 'after_current',
      })
      const answered = yield* until(replies(threadId), (all) => all.some((reply) => reply.agentId === 'codex'))
      const reply = answered.find((answer) => answer.agentId === 'codex')?.text
      assert.include(reply, 'Is the checkout slow?')
      // It hears the message may have been acted on already.
      assert.include(reply, 'Fake claude-code was working on this when it reached its usage limit, and may have done some of it already.')
      assert.include(
        yield* said(threadId),
        `Fake claude-code ran out of usage, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Fake codex takes over.`,
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('keeps what the person said for the reset where the project waits', () => {
    const back = Date.now() + 5000
    return Effect.gen(function* () {
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* waits(project.projectId)
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Is the checkout slow?',
        disposition: 'after_current',
      })
      yield* until(said(threadId), (lines) => lines.some((line) => line.includes('Your message waits until')))
      // Back at its reset, the same agent answers.
      const [answer] = yield* until(replies(threadId), (all) => all.length > 0)
      assert.strictEqual(answer?.agentId, 'claude-code')
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })
})

describe('an agent out of usage, where the project asks', () => {
  it.live('asks the person, with every other account and the model each would run, and when the agent is back', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const queries = yield* Queries
      const work = yield* accounts.add({ agentId: 'claude-code', name: 'Work' })
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* asks(projectId)
      yield* start
      const call = yield* openCall
      assert.deepInclude(call.payload, { step: 'implement', why: 'usage_limit', agentId: 'claude-code' })
      // The agent's other account runs the model the step was on; the others, their own.
      const limit = {
        accountId: yield* usual('claude-code'),
        resetsAt: reset(back),
        choices: [
          { agentId: 'claude-code', accountId: work.id, model: 'small' },
          { agentId: 'codex', accountId: yield* usual('codex'), model: null },
          { agentId: 'opencode', accountId: yield* usual('opencode'), model: null },
        ],
      }
      assert.deepStrictEqual(call.payload['limit'], limit)
      const snapshot = yield* Effect.orDie(queries.thread(task.threadId))
      assert.deepStrictEqual(snapshot.attention[0]?.stuck?.limit, limit)
      // Nothing moved it, and nothing holds it: it waits on the person, on the home and the board too.
      const [card] = yield* cardOf(projectId)
      assert.deepStrictEqual([card?.phase, card?.waits], ['waiting', null])
      assert.isFalse((yield* said(task.threadId)).some((line) => line.includes('takes over')))
      assert.deepStrictEqual(
        (yield* Effect.orDie(queries.home())).calls.map((each) => [each.taskId, each.stuck?.why]),
        [[task.taskId, 'usage_limit']],
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('moves the step to the account and model the person picks', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* asks(projectId)
      yield* start
      const call = yield* openCall
      const codex = yield* usual('codex')
      // An account that isn't the agent's own is refused, and the call stays open.
      const refused = yield* Effect.flip(answer(call.id, { kind: 'retry', agentId: 'codex', accountId: yield* usual('claude-code') }))
      assert.deepInclude(refused, { _tag: 'NotFound', kind: 'account' })
      assert.strictEqual((yield* openCall).id, call.id)
      yield* answer(call.id, { kind: 'retry', agentId: 'codex', accountId: codex, model: 'large' })
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'codex')
      const sessionsOn = yield* sql<{ agentId: string; model: string | null; accountId: string | null }>`
        SELECT agent_id, model, account_id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at`
      assert.deepStrictEqual(
        sessionsOn.map((session) => [session.agentId, session.model, session.accountId]),
        [
          ['claude-code', 'small', yield* usual('claude-code')],
          ['codex', 'large', codex],
        ],
      )
      const [decision] = yield* sql<{ reason: string }>`SELECT reason FROM decisions WHERE attention_request_id = ${call.id}`
      assert.strictEqual(decision?.reason, 'Hand the step to codex')
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('holds the step until the reset when the person waits, and runs it again then, on the same agent', () => {
    const back = Date.now() + 4000
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* asks(projectId)
      yield* start
      const call = yield* openCall
      yield* answer(call.id, { kind: 'wait' })
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual([held?.phase, held?.waits?.agentId, held?.waits?.until], ['running', 'claude-code', reset(back)])
      assert.include(
        yield* said(task.threadId),
        `The work waits until ${whenWords(reset(back), Date.now())}, when Fake claude-code is back, as you said.`,
      )
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual([ready?.lead, ready?.waits], ['claude-code', null])
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('carries a step the person held on at the reset after Althar restarts, on the account and model it was on', () => {
    const back = Date.now() + 6000
    const database = join(mkdtempSync(join(tmpdir(), 'althar-limits-')), 'profile.sqlite')
    const layer = (agents: Readonly<Record<string, FakeAgentOptions>>) =>
      Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { each: agents })))
    return Effect.gen(function* () {
      const held = yield* Effect.gen(function* () {
        const accounts = yield* Accounts
        const work = yield* accounts.add({ agentId: 'claude-code', name: 'Work' })
        const { projectId, task, start } = yield* planned([lead('claude-code')])
        yield* asks(projectId)
        yield* start
        // Moved to the agent's other account, on another model, which is out too: this time the person waits.
        const first = yield* openCall
        yield* answer(first.id, { kind: 'retry', agentId: 'claude-code', accountId: work.id, model: 'large' })
        const second = yield* openCall
        assert.notStrictEqual(second.id, first.id)
        assert.strictEqual((second.payload['limit'] as { readonly accountId: string }).accountId, work.id)
        yield* answer(second.id, { kind: 'wait' })
        yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
        return { projectId, threadId: task.threadId, work: work.id }
      }).pipe(Effect.provide(layer({ 'claude-code': { outOfUsage: { until: back } } })))
      // Started again, it carries on at the reset where it was.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* until(cardOf(held.projectId), (cards) => cards[0]?.phase === 'ready')
        const [last] = yield* sql<{ agentId: string; accountId: string | null; model: string | null }>`
          SELECT agent_id, account_id, model FROM provider_sessions WHERE thread_id = ${held.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
        assert.deepStrictEqual({ ...last }, { agentId: 'claude-code', accountId: held.work, model: 'large' })
      }).pipe(Effect.provide(layer({})))
    })
  })

  it.live('carries the step on at once when the person waits for a reset already past', () => {
    // Long enough for the limit to be reached first on a busy machine; the answer comes after the reset.
    const back = Date.now() + 6000
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* asks(projectId)
      yield* start
      const call = yield* openCall
      yield* Effect.sleep(Duration.millis(Math.max(0, back - Date.now() + 1000)))
      yield* answer(call.id, { kind: 'wait' })
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'claude-code')
      assert.isFalse((yield* said(task.threadId)).some((line) => line.startsWith('The work waits until')))
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('offers a review’s other agents before the lead’s own, and runs the review on the one picked', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned(
        [lead('claude-code'), { key: 'review', agentId: 'codex', model: null, skipped: false }],
        'Retry the checkout [lead:finish] [review:pass]',
      )
      yield* asks(projectId)
      yield* start
      const call = yield* openCall
      assert.deepInclude(call.payload, { step: 'review', agentId: 'codex' })
      const limit = call.payload['limit'] as { readonly choices: ReadonlyArray<{ readonly agentId: string }> }
      assert.deepStrictEqual(
        limit.choices.map((choice) => choice.agentId),
        ['opencode', 'claude-code'],
      )
      yield* answer(call.id, { kind: 'retry', agentId: 'opencode', accountId: yield* usual('opencode') })
      yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.include(yield* said(task.threadId), 'review: The change holds.')
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: { until: back } } })))
  })
})

/** The person hands the task's step held for a usage limit to an agent, as they picked. */
const handOver = (taskId: string, to: Extract<StuckAnswer, { readonly kind: 'retry' }>) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.handOverHeld({ envelope: yield* Runtime.envelope('task.hand_over_held', {}), taskId, answer: to })
  })

/** Who ran on the thread, in order: agent and model. */
const ranOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ agentId: string; model: string | null }>`
      SELECT agent_id, model FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
    return rows.map((row) => [row.agentId, row.model])
  })

describe('a step held for a usage limit, handed over by the person', () => {
  it.live('goes to the model picked where the project waits, and isn’t run again at the reset', () => {
    const back = Date.now() + 3000
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* waits(projectId)
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      // The card says whose account ran out, why it waits, and who could take it over.
      assert.deepInclude(held?.waits, { agentId: 'claude-code', accountId: yield* usual('claude-code'), why: 'waits' })
      assert.deepStrictEqual(
        held?.waits?.choices?.map((choice) => choice.agentId),
        ['codex', 'opencode'],
      )
      const codex = yield* usual('codex')
      // An account that isn't the agent's own is refused, and the step stays held.
      const refused = yield* Effect.flip(handOver(task.taskId, { kind: 'retry', agentId: 'codex', accountId: yield* usual('claude-code') }))
      assert.deepInclude(refused, { _tag: 'NotFound', kind: 'account' })
      yield* handOver(task.taskId, { kind: 'retry', agentId: 'codex', accountId: codex, model: 'large' })
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.deepStrictEqual([ready?.lead, ready?.waits], ['codex', null])
      // Past the reset, nothing brings the step back on the agent it was held for.
      yield* Effect.sleep(Duration.millis(Math.max(0, back - Date.now() + 1500)))
      assert.deepStrictEqual(yield* ranOn(task.threadId), [
        ['claude-code', 'small'],
        ['codex', 'large'],
      ])
      assert.strictEqual((yield* said(task.threadId)).filter((line) => line === 'implement: Did the task.').length, 1)
      assert.strictEqual((yield* cardOf(projectId))[0]?.phase, 'ready')
      // Nothing is held now, so there is nothing to hand over.
      const after = yield* Effect.flip(handOver(task.taskId, { kind: 'retry', agentId: 'opencode' }))
      assert.deepInclude(after, { _tag: 'NotHeld' })
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })))
  })

  it.live('goes to the model picked where the project moves on but nothing was free, as it said', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.strictEqual(held?.waits?.why, 'nothing_free')
      assert.include((yield* said(task.threadId))[0], 'No other model was free')
      // Paid per use, Codex is never moved to unasked; the person may pick it.
      yield* handOver(task.taskId, { kind: 'retry', agentId: 'codex', accountId: yield* usual('codex') })
      const [ready] = yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.strictEqual(ready?.lead, 'codex')
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(':memory:', {}, { each: { 'claude-code': { outOfUsage: { until: back } } }, perUse: ['codex', 'opencode'] }),
          ),
        ),
      ),
    )
  })

  it.live('runs a held review on the agent picked, as a new round', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const { projectId, task, start } = yield* planned(
        [lead('claude-code'), { key: 'review', agentId: 'codex', model: null, skipped: false }],
        'Retry the checkout [lead:finish] [review:pass]',
      )
      yield* waits(projectId)
      yield* start
      const [held] = yield* until(cardOf(projectId), (cards) => cards[0]?.waits != null)
      assert.deepStrictEqual([held?.step, held?.waits?.agentId], ['review', 'codex'])
      assert.match((yield* said(task.threadId)).at(-1) ?? '', /^Fake codex ran out of usage during the review\. The review waits until /)
      yield* handOver(task.taskId, { kind: 'retry', agentId: 'opencode', accountId: yield* usual('opencode') })
      yield* until(cardOf(projectId), (cards) => cards[0]?.phase === 'ready')
      assert.include(yield* said(task.threadId), 'review: The change holds.')
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: { until: back } } })))
  })

  it.live('waits its turn for a place where every place is taken, and carries on as handed once one frees', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const { projectId, task, start } = yield* planned([lead('claude-code')])
      yield* waits(projectId)
      yield* start
      yield* until(cardOf(projectId), (cards) => cards.some((card) => card.waits != null))
      // Held, it takes no place: another task's lead takes the one there is, and stays at work.
      const other = yield* planned([lead('opencode')], 'Hold the place [lead:wait]')
      yield* other.start
      yield* until(cardOf(other.projectId), (cards) =>
        cards.some((card) => card.taskId === other.task.taskId && card.phase === 'running' && card.queued === null),
      )
      yield* handOver(task.taskId, { kind: 'retry', agentId: 'codex', accountId: yield* usual('codex') })
      const [queued] = yield* until(cardOf(projectId), (cards) => cards.some((card) => card.taskId === task.taskId && card.queued !== null))
      assert.isNotNull(queued)
      assert.strictEqual((yield* cardOf(projectId)).find((card) => card.taskId === task.taskId)?.waits, null)
      // The place frees: it carries on, on the agent picked.
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: other.task.threadId, body: '[lead:finish]' })
      const [ready] = yield* until(cardOf(projectId), (cards) =>
        cards.some((card) => card.taskId === task.taskId && card.phase === 'ready'),
      )
      assert.isDefined(ready)
      assert.deepStrictEqual(
        (yield* ranOn(task.threadId)).map(([agentId]) => agentId),
        ['claude-code', 'codex'],
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              { each: { 'claude-code': { outOfUsage: { until: back } } }, busy: { machine: { cores: 3, memory: 7 * 1024 ** 3 } } },
            ),
          ),
        ),
      ),
    )
  })
})

/**
 * In the store at `file`: a task whose lead, out of usage, the person handed
 * to Codex on its large model while another task's lead held the only place,
 * so it waits its turn in Up next as Althar stops.
 */
const handedWhileBusy = (file: string, back: number) =>
  Effect.gen(function* () {
    const { projectId, task, start } = yield* planned([lead('claude-code')])
    yield* waits(projectId)
    yield* start
    yield* until(cardOf(projectId), (cards) => cards.some((card) => card.waits != null))
    const other = yield* planned([lead('opencode')], 'Hold the place [lead:wait]')
    yield* other.start
    yield* until(cardOf(other.projectId), (cards) =>
      cards.some((card) => card.taskId === other.task.taskId && card.phase === 'running' && card.queued === null),
    )
    yield* handOver(task.taskId, { kind: 'retry', agentId: 'codex', accountId: yield* usual('codex'), model: 'large' })
    yield* until(cardOf(projectId), (cards) => cards.some((card) => card.taskId === task.taskId && card.queued !== null))
    return { projectId, task }
  }).pipe(
    Effect.provide(
      Queries.layer.pipe(
        Layer.provideMerge(
          runtime(
            file,
            {},
            { each: { 'claude-code': { outOfUsage: { until: back } } }, busy: { machine: { cores: 3, memory: 7 * 1024 ** 3 } } },
          ),
        ),
      ),
    ),
  )

describe('a held step handed over while every place is taken, across a restart', () => {
  const store = () => join(mkdtempSync(join(tmpdir(), 'althar-handed-')), 'althar.sqlite')

  it.live('carries on, on the agent, account and model picked', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const file = store()
      const { projectId, task } = yield* handedWhileBusy(file, back)
      yield* Effect.gen(function* () {
        // With a place free at the next launch, it starts as the person handed it, and not on the agent it was held for.
        yield* until(cardOf(projectId), (cards) => cards.some((card) => card.taskId === task.taskId && card.phase === 'ready'))
        assert.deepStrictEqual(yield* ranOn(task.threadId), [
          ['claude-code', 'small'],
          ['codex', 'large'],
        ])
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { each: { 'claude-code': { outOfUsage: { until: back } } } }))),
        ),
      )
    })
  })

  it.live('needs the person where the agent picked can’t start once it has a place', () => {
    const back = Date.now() + HOUR
    return Effect.gen(function* () {
      const file = store()
      const { task } = yield* handedWhileBusy(file, back)
      // Codex no longer starts by the next launch.
      const broken = Layer.effect(
        Agents,
        Effect.gen(function* () {
          const agents = yield* Agents
          const missing = yield* Effect.orDie(agents.get('missing'))
          const failing = (entry: (typeof agents.list)[number]) =>
            entry.definition.id === 'codex' ? { ...entry, transport: missing.transport } : entry
          return Agents.of({ list: agents.list.map(failing), get: (agentId) => Effect.map(agents.get(agentId), failing) })
        }),
      ).pipe(Layer.provide(fakeAgents()))
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [call] = yield* until(
          sql<{ why: string }>`
            SELECT json_extract(payload, '$.why') AS why FROM attention_requests
            WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.strictEqual(call?.why, 'failed_to_start')
        const states = yield* sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND n.node_key = 'implement' ORDER BY a.rowid DESC LIMIT 1`
        assert.deepStrictEqual(states, [{ state: 'waiting_attention' }])
      }).pipe(Effect.provide(runtime(file, {}, { agents: broken })))
    })
  })
})

describe('a message waiting for a reset', () => {
  it.live('is answered then after Althar restarts, by the agent it waited for', () => {
    const back = Date.now() + 3000
    const database = join(mkdtempSync(join(tmpdir(), 'althar-limits-')), 'profile.sqlite')
    const layer = (agents: Readonly<Record<string, FakeAgentOptions>>) =>
      Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { each: agents })))
    return Effect.gen(function* () {
      const threadId = yield* Effect.gen(function* () {
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        yield* waits(project.projectId)
        const thread = yield* coordinator.thread(project.projectId)
        yield* coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: thread,
          body: 'Is the checkout slow?',
          disposition: 'after_current',
        })
        yield* until(said(thread), (lines) => lines.some((line) => line.includes('Your message waits until')))
        return thread
      }).pipe(Effect.provide(layer({ 'claude-code': { outOfUsage: { until: back } } })))
      const [answer] = yield* until(replies(threadId), (all) => all.length > 0).pipe(Effect.provide(layer({})))
      assert.strictEqual(answer?.agentId, 'claude-code')
      assert.include(answer?.text, 'Is the checkout slow?')
    })
  })
})

describe('limits', () => {
  it.live('count an agent out for an hour when its limit gave no reset, and keep each project’s policy', () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const sessions = yield* Sessions
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'hello' })
      const [out] = yield* until(
        Effect.map(limits.out('codex'), (found) => (Option.isSome(found) ? [found.value] : [])),
        (outs) => outs.length === 1,
      )
      assert.isNull(out?.resetsAt)
      assert.closeTo(Date.parse(out?.until ?? '') - Date.now(), HOUR, 60_000)
      assert.isTrue(Option.isNone(yield* limits.out('opencode')))
      assert.strictEqual(yield* limits.free(['claude-code']), 'opencode')

      // The rule is the project's: a revision of its rules each time the person changes it, recorded as theirs.
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      assert.strictEqual(usageLimitOf((yield* policies.current(project.projectId as ProjectId)).rules), 'move')
      assert.strictEqual((yield* queries.projects).projects[0]?.usageLimit, 'move')
      yield* policies.setUsageLimit(project.projectId, 'wait', instance.personId)
      yield* policies.setUsageLimit(project.projectId, 'wait', instance.personId)
      const revised = yield* policies.current(project.projectId as ProjectId)
      assert.deepStrictEqual([usageLimitOf(revised.rules), revised.rules.alwaysAsk], ['wait', [...RULES]])
      assert.deepStrictEqual(yield* policies.rulesOf(revised.id), revised.rules)
      assert.strictEqual((yield* queries.projects).projects[0]?.usageLimit, 'wait')
      const facts = yield* sql<{ revision: number; actor: string }>`
        SELECT json_extract(payload, '$.revision') AS revision, actor_id AS actor FROM record_events WHERE type = 'policy.revised' ORDER BY sequence`
      assert.deepStrictEqual(
        facts.map((recorded) => [recorded.revision, recorded.actor === instance.personId]),
        [
          [1, false],
          [2, true],
        ],
      )
      assert.instanceOf(yield* Effect.flip(policies.setUsageLimit('proj_none', 'move', instance.personId)), NotFound)
      assert.instanceOf(yield* Effect.flip(policies.rulesOf('pol_none')), NotFound)

      // The plan's model for its own agent, else the last the agent ran in the project, else its own.
      assert.strictEqual(
        yield* limits.modelFor({ agentId: 'codex', projectId: project.projectId, planned: { agentId: 'codex', model: 'large' } }),
        'large',
      )
      assert.strictEqual(yield* limits.modelFor({ agentId: 'codex', projectId: project.projectId }), 'small')
      assert.isNull(yield* limits.modelFor({ agentId: 'opencode', projectId: project.projectId }))
      assert.deepStrictEqual(yield* limits.named('codex', 'large'), { agent: 'Fake codex', model: 'Large' })
      assert.deepStrictEqual(yield* limits.named('codex', 'huge'), { agent: 'Fake codex', model: 'huge' })
      assert.deepStrictEqual(yield* limits.named('opencode', 'large'), { agent: 'Fake opencode', model: 'large' })
      // An account given is the agent's own, or none.
      assert.instanceOf(yield* Effect.flip(limits.pick({ agentId: 'opencode', accountId: yield* usual('codex') })), NotFound)
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: {} } }))),
  )

  it('say when an agent is back, and what its work does meanwhile', () => {
    const now = Date.parse('2026-10-03T12:00:00')
    const later = new Date('2026-10-03T15:40:00')
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(later)
    assert.strictEqual(whenWords(later.toISOString(), now), time)
    assert.match(whenWords(new Date('2026-10-05T09:00:00').toISOString(), now), /, /)
    assert.match(whenWords(new Date('2026-11-20T09:00:00').toISOString(), now), /20/)
    assert.strictEqual(outWords({ from: 'Codex', resetsAt: null, now }), 'Codex ran out of usage.')
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, now, step: 'review', waits: 'step' }),
      'Codex ran out of usage during the review. The review waits until Codex is back. To carry on now, pick another model on the task.',
    )
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: later.toISOString(), now, step: 'implement', waits: 'step', nothingFree: true }),
      `Codex ran out of usage while working on the task. No other model was free, so the work waits until ${whenWords(later.toISOString(), now)}, when Codex is back. Pick one on the task to carry on now.`,
    )
    // The fixes are many, so they wait.
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, now, step: 'settle', waits: 'step' }),
      'Codex ran out of usage while fixing what the review found. The fixes wait until Codex is back. To carry on now, pick another model on the task.',
    )
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, now, step: 'settle', waits: 'step', nothingFree: true }),
      'Codex ran out of usage while fixing what the review found. No other model was free, so the fixes wait until Codex is back. Pick one on the task to carry on now.',
    )
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, now, step: 'settle', to: { agent: 'Claude Code', model: null } }),
      'Codex ran out of usage while fixing what the review found. Claude Code takes the fixes over.',
    )
    assert.strictEqual(
      outWords({ from: 'Codex', resetsAt: null, now, to: { agent: 'Claude Code', model: null } }),
      'Codex ran out of usage. Claude Code takes over.',
    )
  })
})
