import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Busy } from '../src/Busy'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs, type StuckAnswer } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, until } from './support'

/*
 * A step that needs the person, and what their answer does, where
 * coordinator.test.ts and limits.test.ts don't go: a lead whose turn fails,
 * the lead or a review handed back to its own agent on a model its session
 * won't take or on another of its accounts, a settling given up or settled
 * after all, a step held for a usage limit handed to an agent that can't
 * start, and a stopped task resumed on another lead than the one on its
 * thread.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** A task planned on these steps, as its description says, and started now; on a project whose usage limits wait, where asked. */
const planned = (
  description: string,
  steps: ReadonlyArray<{ readonly key: 'implement' | 'review'; readonly agentId: string }> = [{ key: 'implement', agentId: 'codex' }],
  waits = false,
) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    if (waits) yield* (yield* Policies).setUsageLimit(project.projectId, 'wait', instance.personId)
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Retry the checkout',
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return { projectId: project.projectId, ...task }
  })

/** The task's open call for a step that needs the person, other than `not`: its id, and what it says. */
const stuckCall = (taskId: string, not?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ id: string; payload: string }>`
        SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1 && rows[0]?.id !== not,
      Duration.seconds(15),
    )
    return {
      id: call?.id ?? '',
      ...(JSON.parse(call?.payload ?? '{}') as { step: string; why: string; agentId: string | null; detail: string | null }),
    }
  })

const answer = (attentionId: string, said: StuckAnswer) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.answerStuck({ envelope: yield* Runtime.envelope('attention.answer_stuck', {}), attentionId, answer: said })
  })

/** The sessions on the thread, oldest first: their agent, account and where each stands. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; agentId: string; accountId: string; state: string }>`
      SELECT id, agent_id, account_id, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** The sessions of the task's review, oldest first. */
const reviewersOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string; accountId: string; state: string }>`
      SELECT s.agent_id, s.account_id, s.state FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
      WHERE t.task_id = ${taskId} AND t.kind = 'step' AND t.node_key = 'review' ORDER BY s.started_at, s.rowid`
  })

/** A task whose lead is done, and whose reviewer, Codex, never reports: its review needs the person. */
const unreported = Effect.gen(function* () {
  const task = yield* planned('Fix the heading. [lead:finish]', [
    { key: 'implement', agentId: 'claude-code' },
    { key: 'review', agentId: 'codex' },
  ])
  const call = yield* stuckCall(task.taskId)
  assert.deepStrictEqual([call.step, call.why, call.agentId], ['review', 'no_report', 'codex'])
  return { task, call }
})

/** The task's step attempts, oldest first: which step, and where it stands. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string }>`
      SELECT n.node_key AS step, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

const runOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [run] = yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId}`
    return run?.state
  })

/** A task whose review found something, and whose lead settles it without saying so: its settling needs the person. */
const settledQuietly = Effect.gen(function* () {
  const task = yield* planned('Fix the heading. [lead:finish] [review:findings] [lead:settle-quietly]', [
    { key: 'implement', agentId: 'claude-code' },
    { key: 'review', agentId: 'codex' },
  ])
  const call = yield* stuckCall(task.taskId)
  assert.deepStrictEqual([call.step, call.why], ['settle', 'no_report'])
  return { task, call }
})

describe('a lead’s step that needs the person, handed back to its own agent on another model', () => {
  it.live('starts the lead afresh where the session it has says yes to the model but stays where it was', () =>
    Effect.gen(function* () {
      const task = yield* planned('Do it. [lead:refuse]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['implement', 'refused', 'codex'])
      yield* answer(call.id, { kind: 'retry', agentId: 'codex', model: 'large' })
      // The session it had stays on Small, so it isn't kept: another starts in its place, and refuses again.
      const again = yield* stuckCall(task.taskId, call.id)
      assert.strictEqual(again.why, 'refused')
      assert.deepStrictEqual(
        (yield* sessionsOn(task.threadId)).map((session) => [session.agentId, session.state]),
        [
          ['codex', 'completed'],
          ['codex', 'active'],
        ],
      )
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { codex: { staysOn: ['large'] } } }))),
  )
})

describe('a lead whose turn fails', () => {
  it.live('is reminded of its step, and then needs the person', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Its first turn fails as Claude Code's does when Anthropic's API gives up.
      const task = yield* planned('Do it. [fails-after:0s]')
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['implement', 'no_report'])
      const turns = yield* sql<{ state: string; prompt: string | null }>`
        SELECT state, prompt FROM turn_deliveries WHERE thread_id = ${task.threadId} ORDER BY requested_at, rowid`
      assert.deepStrictEqual(
        turns.map((turn) => turn.state),
        ['failed', 'completed'],
      )
      assert.match(turns[1]?.prompt ?? '', /^Your step isn't done until you call Althar's finish_step tool/)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a review that needs the person, handed back to its own reviewer', () => {
  it.live('needs the person again where the reviewer can’t be put on the model picked', () =>
    Effect.gen(function* () {
      const { task, call } = yield* unreported
      yield* answer(call.id, { kind: 'retry', agentId: 'codex', model: 'large' })
      const again = yield* stuckCall(task.taskId, call.id)
      assert.deepStrictEqual([again.step, again.why, again.agentId], ['review', 'failed_to_start', 'codex'])
      // The session it had wouldn't move to Large, so it went, and a fresh one couldn't start on it.
      assert.deepStrictEqual(
        (yield* reviewersOf(task.taskId)).map((session) => session.state),
        ['completed', 'failed'],
      )
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { codex: { failsOnce: ['large'] } } }))),
  )

  it.live('starts it afresh on the account picked, where it ran on another', () => {
    const workFolder = join(mkdtempSync(join(tmpdir(), 'althar-home-')), 'work')
    mkdirSync(workFolder)
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: workFolder })
      const { task, call } = yield* unreported
      const [usual] = yield* accounts.of('codex')
      yield* answer(call.id, { kind: 'retry', agentId: 'codex', accountId: work.id })
      yield* stuckCall(task.taskId, call.id)
      assert.deepStrictEqual(
        (yield* reviewersOf(task.taskId)).map((session) => [session.agentId, session.accountId]),
        [
          ['codex', usual?.id],
          ['codex', work.id],
        ],
      )
    }).pipe(Effect.provide(withQueries()))
  })
})

describe('a review whose copy of the work can’t be made', () => {
  it.live('needs the person, and again once they tell it what to do and it still can’t start', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout',
        description: 'Fix the heading. [lead:finish]',
        draft: true,
      })
      // Where its reviewer's copy goes is a folder git doesn't know: the copy can't be made there.
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      const path = worktree?.path ?? ''
      mkdirSync(join(dirname(dirname(path)), '.review', basename(dirname(path)), basename(path)), { recursive: true })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: instance.personId,
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why, call.agentId], ['review', 'failed_to_start', 'codex'])
      yield* answer(call.id, { kind: 'tell', note: 'Look at the README only.' })
      const again = yield* stuckCall(task.taskId, call.id)
      assert.deepStrictEqual([again.step, again.why], ['review', 'failed_to_start'])
      // It never started, so it was told nothing.
      assert.lengthOf(yield* sql`SELECT id FROM threads WHERE task_id = ${task.taskId} AND kind = 'step'`, 0)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a settling that needs the person', () => {
  it.live('stops the run when the person gives it up, with the findings left as they were', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task, call } = yield* settledQuietly
      yield* answer(call.id, { kind: 'abandon' })
      assert.strictEqual(yield* runOf(task.taskId), 'cancelled')
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), { step: 'settle', state: 'cancelled' })
      const findings = yield* sql<{ state: string }>`SELECT state FROM findings`
      assert.deepStrictEqual(findings, [{ state: 'open' }])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('settles the findings its lead names when it reports after all, past one the review never raised', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task, call } = yield* settledQuietly
      const [finding] = yield* sql<{ id: string }>`SELECT id FROM findings`
      const [lead] = yield* sessionsOn(task.threadId)
      const access: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: lead?.id ?? '',
        taskId: task.taskId,
      }
      const said = yield* callTool(access, 'finish_step', {
        summary: 'Left the heading as it is.',
        findings: [
          { id: finding?.id ?? '', outcome: 'set_aside', reason: 'It reads as intended.' },
          { id: 'find_00000000000000000000000000000000', outcome: 'fixed' },
        ],
      })
      // Settling changed nothing, so no review looks again: the task is ready.
      assert.strictEqual(said, 'Althar has your summary. The task is ready for the person.')
      assert.deepStrictEqual(yield* sql<{ id: string; state: string; response: string | null }>`SELECT id, state, response FROM findings`, [
        { id: finding?.id ?? '', state: 'set_aside', response: 'It reads as intended.' },
      ])
      const [withdrawn] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${call.id}`
      assert.strictEqual(withdrawn?.state, 'withdrawn')
      assert.strictEqual(yield* runOf(task.taskId), 'succeeded')
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a settling an earlier Althar kept waiting for a place', () => {
  /** The stuck settling, as an earlier Althar would have kept it waiting for a place, to start as `place` says. */
  const keptWaiting = (taskId: string, callId: string, place: unknown) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [settling] = yield* sql<{ id: string }>`
        SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
        JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} AND n.node_key = 'settle' ORDER BY a.admitted_at DESC LIMIT 1`
      yield* sql`UPDATE attention_requests SET state = 'withdrawn' WHERE id = ${callId}`
      yield* sql`
        UPDATE node_attempts SET state = 'held', hold_reason = 'machine_busy',
          output = ${JSON.stringify({ place, since: new Date().toISOString() })}
        WHERE id = ${settling?.id ?? ''}`
      yield* (yield* Busy).wake
    })

  /** What the lead was told to settle, in order. */
  const toldToSettle = (threadId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ prompt: string }>`
        SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} AND prompt LIKE '%Settle each%' ORDER BY requested_at`
    })

  for (const [how, place] of [
    ['as the person resumed it', { how: 'resume', lead: { agentId: 'claude-code', model: null, effort: null } }],
    ['as the step after the review', { how: 'next' }],
  ] as const)
    it.live(`tells its lead again what is open once it has a place, ${how}`, () =>
      Effect.gen(function* () {
        const { task, call } = yield* settledQuietly
        assert.lengthOf(yield* toldToSettle(task.threadId), 1)
        yield* keptWaiting(task.taskId, call.id, place)
        const told = yield* until(toldToSettle(task.threadId), (rows) => rows.length === 2)
        assert.match(told[1]?.prompt ?? '', /find_[0-9a-f]{32} \[major\] README\.md:1: The heading is wrong\./)
        // It settles quietly again: the step needs the person once more.
        const again = yield* stuckCall(task.taskId, call.id)
        assert.deepStrictEqual([again.step, again.why], ['settle', 'no_report'])
      }).pipe(Effect.provide(withQueries())),
    )
})

describe('a step held for a usage limit, handed to an agent that can’t start', () => {
  it.live('needs the person, saying why it couldn’t start', () => {
    const back = Date.now() + 60 * 60 * 1000
    return Effect.gen(function* () {
      const runs = yield* Runs
      const task = yield* planned('Do it. [lead:finish]', [{ key: 'implement', agentId: 'claude-code' }], true)
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.state === 'held', Duration.seconds(15))
      yield* runs.handOverHeld({
        envelope: yield* Runtime.envelope('task.hand_over_held', {}),
        taskId: task.taskId,
        answer: { kind: 'retry', agentId: 'missing' },
      })
      const call = yield* stuckCall(task.taskId)
      assert.deepStrictEqual([call.step, call.why], ['implement', 'failed_to_start'])
      assert.isNotNull(call.detail)
      assert.deepStrictEqual((yield* attempts(task.taskId)).at(-1), { step: 'implement', state: 'waiting_attention' })
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { 'claude-code': { outOfUsage: { until: back } } } })))
  })
})

describe('a stopped task resumed on a lead the person names', () => {
  it.live('hands its thread to that lead, at the effort named, from the agent the person had switched it to', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const task = yield* planned('Work on it. [lead:wait]')
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.state === 'running')
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      // Stopped, its thread is switched to OpenCode, which takes it over at once.
      yield* sessions.switchAgent({ threadId: task.threadId, agentId: 'opencode', byPerson: true })
      yield* tasks.resume({
        envelope: yield* Runtime.envelope('task.resume', {}),
        taskId: task.taskId,
        lead: { agentId: 'claude-code', model: null, effort: 'high' },
      })
      const sql = yield* SqlClient.SqlClient
      const ran = yield* until(
        sql<{ agentId: string; effort: string | null; state: string }>`
          SELECT agent_id, effort, state FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at, rowid`,
        (rows) => rows.length === 3,
      )
      assert.deepStrictEqual(
        ran.map((row) => [row.agentId, row.state]),
        [
          ['codex', 'completed'],
          ['opencode', 'superseded'],
          ['claude-code', 'active'],
        ],
      )
      assert.strictEqual(ran[2]?.effort, 'high')
      assert.strictEqual(yield* runOf(task.taskId), 'running')
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a stopped task with an answer an earlier Althar kept for a place', () => {
  it.live('tells its lead the answer as it is resumed', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tasks = yield* Tasks
      const task = yield* planned('Ask which database first. [lead:ask]')
      const [question] = yield* until(
        sql<{ id: string; payload: string }>`
          SELECT id, payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'question' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      // Its answer was kept to be told once its lead had a place, as answers once were, and the task stopped before it was.
      const at = new Date().toISOString()
      const payload = {
        ...(JSON.parse(question?.payload ?? '{}') as object),
        answers: { question_0: { values: ['SQLite'] } },
        waitsForPlace: at,
      }
      yield* sql`UPDATE attention_requests SET state = 'answered', answered_at = ${at}, payload = ${JSON.stringify(payload)} WHERE id = ${question?.id ?? ''}`
      yield* tasks.resume({ envelope: yield* Runtime.envelope('task.resume', {}), taskId: task.taskId })
      const said = yield* until(
        Effect.map(items(task.threadId), (all) =>
          all.flatMap((item) =>
            item.kind === 'agent_message' && String(item.content.text).startsWith('told=') ? [String(item.content.text)] : [],
          ),
        ),
        (texts) => texts.length === 1,
      )
      assert.include(said[0], 'SQLite')
      const [kept] = yield* sql<{ waits: string | null }>`
        SELECT json_extract(payload, '$.waitsForPlace') AS waits FROM attention_requests WHERE id = ${question?.id ?? ''}`
      assert.isNull(kept?.waits)
    }).pipe(Effect.provide(withQueries())),
  )
})
