import type { ProjectId } from '@althar/domain'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Limits, whenWords } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { standInOf } from '../src/standIn'
import { atReset, items, later, onTestClock, repository, runtime, until } from './support'
import { knownModels } from './knownModels'

/*
 * A task's lead that runs out of usage outside a step (a turn after its plan,
 * as the person writes to it) is handed to another agent only for a while:
 * the thread names the model that ran out, the one that takes over, and until
 * when; the stand-in is shown as one; and the lead the task was given leads
 * again once its usage is back. Before, the other agent kept the task for
 * good, and the thread named agents only (a Kimi K3.1 Pro prototype went on
 * as Claude Opus 5.5 with nobody asking).
 */

const withAgents = (each: Readonly<Record<string, FakeAgentOptions>>) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each })))

/** The notices a thread says, in order. */
const said = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** The notices the window shows in the thread, in order. */
const shown = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const thread = yield* queries.thread(threadId)
    return thread.items.flatMap((item) => (item.kind === 'notice' ? [item.content.title] : []))
  })

/** The lead queued to take the thread over from its next turn, where one is. */
const queued = (threadId: string) =>
  Effect.gen(function* () {
    const live = yield* (yield* Sessions).running(threadId)
    return Option.isSome(live) && live.value.nextLead !== undefined ? [live.value.nextLead] : []
  })

/** A task, planned on this lead and started now: as its description says, it finishes its step. */
const planned = (agentId: string, model: string | null, title = 'Prototype a better About screen [lead:finish]') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      description: title,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId, model, skipped: false }],
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    return { projectId: project.projectId, task, start: plans.start(planId, instance.personId) }
  })

/** Waits until the task has done its plan's steps. */
const ready = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return yield* until(
      Effect.map(queries.board(projectId), (board) => board.tasks),
      (cards) => cards[0]?.phase === 'ready',
    )
  })

/** The thread's sessions, oldest first: who led it, on which model. */
const leads = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; agentId: string; model: string | null; state: string }>`
      SELECT id, agent_id, model, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** The agents' replies in a thread, and the agent each came from. */
const replies = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string; content: string }>`
      SELECT s.agent_id, i.content FROM thread_items i JOIN provider_sessions s ON s.id = i.provider_session_id
      WHERE i.thread_id = ${threadId} AND i.kind = 'agent_message' ORDER BY i.sequence`
  })

describe('a task’s lead out of usage outside a step', () => {
  it.effect('stands another in until its reset, says who and why, and leads again once its usage is back', () => {
    const back = later()
    return Effect.gen(function* () {
      yield* knownModels
      const projects = yield* Projects
      const sessions = yield* Sessions
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId as ProjectId,
        title: 'Prototype a better About screen',
      })
      // The task was given Fake claude-code on Large; its first turn reaches the limit.
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code', model: 'large' })
      const handed = yield* until(said(task.threadId), (lines) => lines.some((line) => line.includes('ran out of usage')))
      // Said as it happens: the model that ran out and its agent, until when, and who takes over only until then.
      assert.include(
        handed,
        `Large on Fake claude-code ran out of usage, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Small on Fake codex takes over until then.`,
      )
      // The window shows it in the thread, where the passive lines of a limit stay out of it.
      assert.include(
        yield* shown(task.threadId),
        handed.find((line) => line.includes('ran out of usage')),
      )
      const [given, standIn] = yield* until(leads(task.threadId), (rows) => rows.at(-1)?.state === 'active' && rows.length === 2)
      assert.deepInclude(given, { agentId: 'claude-code', model: 'large' })
      assert.deepInclude(standIn, { agentId: 'codex' })
      // The window shows it as standing in for the lead the task was given, until its reset.
      const summary = (yield* queries.thread(task.threadId)).session
      assert.deepInclude(summary?.standsIn ?? {}, { agentId: 'claude-code', model: 'large' })
      assert.strictEqual(Date.parse(summary?.standsIn?.until ?? ''), Math.ceil(back / 1000) * 1000)

      // Its usage back, the given lead is queued to take over from the next turn; the stand-in stays one until it has.
      yield* atReset(back)
      const [next] = yield* until(queued(task.threadId), (leads) => leads.length === 1)
      assert.deepInclude(next, { agentId: 'claude-code', model: 'large' })
      assert.isTrue(Option.isSome(yield* standInOf(standIn?.id ?? '')))
      assert.notInclude(
        yield* said(task.threadId),
        'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.',
      )
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'How does it look?' })
      const answered = yield* until(replies(task.threadId), (rows) =>
        rows.some((row) => row.agentId === 'claude-code' && row.content.includes('How does it look?')),
      )
      assert.isTrue(answered.length > 0)
      // Said as it takes over, in the thread the window shows.
      assert.include(yield* said(task.threadId), 'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.')
      assert.include(
        yield* shown(task.threadId),
        'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.',
      )
      const last = (yield* leads(task.threadId)).at(-1)
      assert.deepInclude(last, { agentId: 'claude-code', model: 'large' })
      // Leading as given again, it stands in for nobody.
      assert.isNull((yield* queries.thread(task.threadId)).session?.standsIn ?? null)
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })

  it.effect('starts again on the lead it was given, where the stand-in was stopped and that lead has usage again', () => {
    const back = later()
    return Effect.gen(function* () {
      yield* knownModels
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId as ProjectId,
        title: 'Prototype a better About screen',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code', model: 'large' })
      yield* until(leads(task.threadId), (rows) => rows.at(-1)?.agentId === 'codex' && rows.at(-1)?.state === 'active')
      // Stopped while it stands in, as the person's Stop or Althar quitting leaves it.
      yield* sessions.stop(task.threadId)
      yield* atReset(back)
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'Carry on.' })
      yield* sessions.startLast(task.threadId)
      const lines = yield* until(said(task.threadId), (all) => all.some((line) => line.includes('has usage again')))
      assert.include(lines, 'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.')
      const last = yield* until(leads(task.threadId), (rows) => rows.at(-1)?.state === 'active')
      assert.deepInclude(last.at(-1), { agentId: 'claude-code', model: 'large' })
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })

  it.effect('starts again on the lead it was given, where it was queued back and the stand-in stopped before the next turn', () => {
    const back = later()
    return Effect.gen(function* () {
      yield* knownModels
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId as ProjectId,
        title: 'Prototype a better About screen',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code', model: 'large' })
      yield* until(leads(task.threadId), (rows) => rows.at(-1)?.agentId === 'codex' && rows.at(-1)?.state === 'active')
      yield* atReset(back)
      yield* until(queued(task.threadId), (leads) => leads.length === 1)
      // Stopped, as Althar quitting leaves it, after the reset and before anything more was said.
      yield* sessions.stop(task.threadId)
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'Carry on.' })
      yield* sessions.startLast(task.threadId)
      const rows = yield* until(leads(task.threadId), (all) => all.at(-1)?.state === 'active' && all.length === 3)
      assert.deepInclude(rows.at(-1), { agentId: 'claude-code', model: 'large' })
      assert.include(yield* said(task.threadId), 'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.')
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })

  it.effect('keeps the stand-in where the given lead can’t start at its reset, and gives it back once it can', () => {
    const back = later()
    let refuse = false
    return Effect.gen(function* () {
      yield* knownModels
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId as ProjectId,
        title: 'Prototype a better About screen',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code', model: 'large' })
      const [, standIn] = yield* until(leads(task.threadId), (rows) => rows.at(-1)?.agentId === 'codex' && rows.at(-1)?.state === 'active')
      yield* atReset(back)
      yield* until(queued(task.threadId), (leads) => leads.length === 1)
      // The given lead can't start as it takes over: the stand-in carries on, and still stands in.
      refuse = true
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'First.' })
      yield* until(replies(task.threadId), (rows) => rows.some((row) => row.agentId === 'codex' && row.content.includes('First.')))
      assert.include(yield* said(task.threadId), 'Fake codex carries on: the agent it was changed to couldn’t start.')
      assert.isTrue(Option.isSome(yield* standInOf(standIn?.id ?? '')))
      // Tried again for the next turn, it takes over.
      yield* until(queued(task.threadId), (leads) => leads.length === 1)
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'Second.' })
      yield* until(replies(task.threadId), (rows) => rows.some((row) => row.agentId === 'claude-code' && row.content.includes('Second.')))
      assert.deepInclude((yield* leads(task.threadId)).at(-1), { agentId: 'claude-code', model: 'large' })
      assert.include(yield* said(task.threadId), 'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.')
    }).pipe(
      Effect.provide(
        withAgents({
          'claude-code': {
            outOfUsage: { until: back },
            beforeNewSession: async () => {
              if (!refuse) return
              refuse = false
              throw new Error('Could not start')
            },
          },
        }),
      ),
      onTestClock,
    )
  })

  it.effect('never gives the lead back over a choice made for the stand-in, however the two cross', () => {
    const back = later()
    return Effect.gen(function* () {
      yield* knownModels
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId as ProjectId,
        title: 'Prototype a better About screen',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code', model: 'large' })
      const [, standIn] = yield* until(leads(task.threadId), (rows) => rows.at(-1)?.agentId === 'codex' && rows.at(-1)?.state === 'active')
      // The person picks another model for the stand-in just as Althar gives the lead back: theirs stands, in either order.
      yield* Effect.all(
        [
          sessions.giveBack({ threadId: task.threadId, sessionId: standIn?.id ?? '' }),
          sessions.changeLead({ threadId: task.threadId, agentId: 'codex', model: 'large' }),
        ],
        { concurrency: 'unbounded' },
      )
      assert.deepStrictEqual(yield* queued(task.threadId), [{ agentId: 'codex', model: 'large' }])
      assert.isTrue(Option.isNone(yield* standInOf(standIn?.id ?? '')))
      // And once chosen, nothing gives it back.
      assert.isFalse(yield* sessions.giveBack({ threadId: task.threadId, sessionId: standIn?.id ?? '' }))
      assert.deepStrictEqual(yield* queued(task.threadId), [{ agentId: 'codex', model: 'large' }])
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })
})

describe('a task’s planned lead already out of usage as its step starts', () => {
  it.effect('starts another in its place only until its reset, and leads the next turn after it', () => {
    const back = later()
    return Effect.gen(function* () {
      yield* knownModels
      const sessions = yield* Sessions
      const projects = yield* Projects
      const limits = yield* Limits
      const { projectId, task, start } = yield* planned('claude-code', 'large')
      // Out from another task before this one's step starts, so nothing of this task's runs yet.
      const other = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId, title: 'Elsewhere' })
      yield* sessions.start({ threadId: other.threadId, agentId: 'claude-code' })
      yield* until(
        Effect.map(limits.out('claude-code'), (out) => (Option.isSome(out) ? [out] : [])),
        (outs) => outs.length === 1,
      )
      yield* start
      yield* ready(projectId)
      const [standIn] = yield* leads(task.threadId)
      assert.deepInclude(standIn, { agentId: 'codex' })
      assert.deepInclude(Option.getOrUndefined(yield* standInOf(standIn?.id ?? '')) ?? {}, { agentId: 'claude-code', model: 'large' })
      yield* atReset(back)
      yield* until(queued(task.threadId), (leads) => leads.length === 1)
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'How does it look?' })
      // The fake lead of a planned task answers in its own words: the turn is the given lead's.
      yield* until(replies(task.threadId), (rows) => rows.at(-1)?.agentId === 'claude-code')
      assert.deepInclude((yield* leads(task.threadId)).at(-1), { agentId: 'claude-code', model: 'large' })
      assert.include(
        yield* shown(task.threadId),
        'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.',
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })
})

describe('a step handed on after it ended twice without its report', () => {
  it.effect('goes back to the lead the task was given once that step is done, for the next turn', () =>
    Effect.gen(function* () {
      yield* knownModels
      const sessions = yield* Sessions
      const { projectId, task, start } = yield* planned('claude-code', 'large', 'Fix the heading. [lead:finish]')
      yield* start
      yield* ready(projectId)
      const rows = yield* leads(task.threadId)
      assert.deepInclude(rows[0], { agentId: 'claude-code', model: 'large' })
      const taker = rows.at(-1)
      assert.notStrictEqual(taker?.agentId, 'claude-code')
      // Its step done, the given lead leads the next turn, and the thread says why.
      const [next] = yield* until(queued(task.threadId), (leads) => leads.length === 1)
      assert.deepInclude(next, { agentId: 'claude-code', model: 'large' })
      const before = (yield* replies(task.threadId)).length
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: task.threadId,
        body: 'Thanks. One more thing.',
      })
      yield* until(replies(task.threadId), (all) => all.length > before && all.at(-1)?.agentId === 'claude-code')
      assert.deepInclude((yield* leads(task.threadId)).at(-1), { agentId: 'claude-code', model: 'large' })
      const lines = yield* shown(task.threadId)
      assert.isTrue(
        lines.some((line) => /^The step .+ took over is done: Large on Fake claude-code leads again\.$/.test(line)),
        lines.join('\n'),
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { noReport: true } })), onTestClock),
  )
})
