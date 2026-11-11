import type { MessageSender } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions, passedOn } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until, withWork } from './support'

/*
 * Any message the person sends to a task answers its lead's call waiting on them, whichever way it is delivered: the
 * card closes as they send, not when a turn starts. Althar's own words and what the coordinator or another lead passes on
 * aren't the person's, so they leave it open.
 */

const GB = 1024 ** 3

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** The runtime on a machine that runs one agent at once. */
const oneAtOnce = withQueries(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } } })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

/** A task whose lead is Claude Code, planned as its description says with no review, started now. */
const started = (projectId: ProjectId, title: string, description: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description: withWork(description, false),
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return created
  })

/** The calls of the task's lead waiting on the person, oldest first. */
const calls = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; state: string }>`
      SELECT id, state FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck'
        AND json_extract(payload, '$.why') = 'waiting_on_person' ORDER BY created_at, rowid`
  })

/** The call the lead has open: it asked, and its turn ended. */
const asked = (taskId: string) =>
  Effect.map(
    until(calls(taskId), (rows) => rows.some((row) => row.state === 'open')),
    (rows) => rows.filter((row) => row.state === 'open')[0]?.id ?? '',
  )

const stateOf = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${id}`
    return row?.state
  })

const attemptState = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string }>`
      SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
      JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} AND n.node_key = 'implement' ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
    return row?.state
  })

const phaseOf = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const board = yield* (yield* Queries).board(projectId)
    return board.tasks.find((task) => task.taskId === taskId)?.phase
  })

/** The person says it, as the window or a paired device sends it. */
const says = (
  threadId: string,
  body: string,
  sender: MessageSender,
  disposition: 'after_current' | 'interrupt_and_continue' = 'after_current',
) =>
  Effect.gen(function* () {
    yield* (yield* Sessions).send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      sender,
      disposition,
    })
  })

const leadOf = (projectId: ProjectId, taskId: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
    return { role: 'lead', projectId, threadId, sessionId: session?.id ?? '', taskId } satisfies ToolAccess
  })

const ASK = 'Ask first. [lead:wait-for-person] [lead:finish]'

describe('the person’s message to a lead waiting on them', () => {
  for (const sender of [{ kind: 'window' }, { kind: 'paired_device', deviceId: 'phone-1' }] as const) {
    it.live(`closes the call whatever it is sent from: ${sender.kind}`, () =>
      Effect.gen(function* () {
        const projectId = yield* opened
        const task = yield* started(projectId, 'Compact the ADRs', ASK)
        const call = yield* asked(task.taskId)
        assert.strictEqual(yield* phaseOf(projectId, task.taskId), 'waiting')
        yield* says(task.threadId, 'Keep the dozen current-state decisions.', sender)
        yield* until(
          Effect.map(stateOf(call), (state) => (state === 'answered' ? [state] : [])),
          (rows) => rows.length === 1,
        )
        // Nothing waits on them now: the lead finishes, and the board no longer says it waits.
        yield* until(
          Effect.map(phaseOf(projectId, task.taskId), (phase) => (phase === 'ready' ? [phase] : [])),
          (rows) => rows.length === 1,
        )
        assert.deepStrictEqual(
          (yield* calls(task.taskId)).map((row) => row.state),
          ['answered'],
        )
      }).pipe(Effect.provide(withQueries())),
    )
  }

  it.live('closes the call as it is sent, while the lead’s own turn still runs and holds what was said back', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      // A lead that keeps its turn going, and asks without ending it.
      const task = yield* started(projectId, 'Still at work', 'Work on it. [lead:wait]')
      yield* until(attemptState(task.taskId).pipe(Effect.map((state) => (state === 'running' ? [state] : []))), (rows) => rows.length === 1)
      const lead = yield* leadOf(projectId, task.taskId, task.threadId)
      yield* callTool(lead, 'wait_for_person', { question: 'Which one?' })
      const call = yield* asked(task.taskId)
      assert.strictEqual(yield* phaseOf(projectId, task.taskId), 'waiting')
      yield* says(task.threadId, 'B please.', { kind: 'window' })
      yield* until(
        Effect.map(stateOf(call), (state) => (state === 'answered' ? [state] : [])),
        (rows) => rows.length === 1,
      )
      // The turn that carries it hasn't started: the lead is still in the one it asked in, so the step waits for its own turn.
      const [held] = yield* sql<{ n: number }>`
        SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${task.threadId} AND body = 'B please.' AND state = 'queued'`
      assert.strictEqual(held?.n, 1)
      // The board stops saying it waits on the person.
      yield* until(
        Effect.map(phaseOf(projectId, task.taskId), (phase) => (phase !== 'waiting' ? [phase] : [])),
        (rows) => rows.length === 1,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('closes the call when the message interrupts the lead’s turn', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Still at work', 'Work on it. [lead:wait]')
      yield* until(attemptState(task.taskId).pipe(Effect.map((state) => (state === 'running' ? [state] : []))), (rows) => rows.length === 1)
      const lead = yield* leadOf(projectId, task.taskId, task.threadId)
      yield* callTool(lead, 'wait_for_person', { question: 'Which one?' })
      const call = yield* asked(task.taskId)
      yield* says(task.threadId, 'B please.', { kind: 'paired_device', deviceId: 'phone-1' }, 'interrupt_and_continue')
      yield* until(
        Effect.map(stateOf(call), (state) => (state === 'answered' ? [state] : [])),
        (rows) => rows.length === 1,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('closes the call though every place among the agents at work is taken', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Compact the ADRs', ASK)
      const call = yield* asked(task.taskId)
      // Another task's lead holds the only place.
      const other = yield* started(projectId, 'Holds the place', 'Work on it. [lead:wait]')
      yield* until(
        attemptState(other.taskId).pipe(Effect.map((state) => (state === 'running' ? [state] : []))),
        (rows) => rows.length === 1,
      )
      yield* says(task.threadId, 'Keep the dozen current-state decisions.', { kind: 'window' })
      yield* until(
        Effect.map(stateOf(call), (state) => (state === 'answered' ? [state] : [])),
        (rows) => rows.length === 1,
      )
      // The other's lead worked on all along.
      assert.strictEqual(yield* attemptState(other.taskId), 'running')
    }).pipe(Effect.provide(oneAtOnce)),
  )

  it.live('leaves a call the lead asks after the person sent their reply open when the reply’s turn starts', () => {
    const hold = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const task = yield* started(projectId, 'Still at work', 'Work on it. [lead:wait]')
      yield* until(attemptState(task.taskId).pipe(Effect.map((state) => (state === 'running' ? [state] : []))), (rows) => rows.length === 1)
      const lead = yield* leadOf(projectId, task.taskId, task.threadId)
      yield* callTool(lead, 'wait_for_person', { question: 'Which one?' })
      const first = yield* asked(task.taskId)
      // The reply is kept behind the lead's turn, and closes the call as it is sent.
      yield* says(task.threadId, 'B please.', { kind: 'window' })
      yield* until(
        Effect.map(stateOf(first), (state) => (state === 'answered' ? [state] : [])),
        (rows) => rows.length === 1,
      )
      // Before the reply's turn starts, the lead asks again: a question the person hasn't answered.
      yield* callTool(lead, 'wait_for_person', { question: 'And the colour?' })
      const both = yield* until(calls(task.taskId), (rows) => rows.length === 2)
      assert.strictEqual(both[1]?.state, 'open')
      // The coordinator passes something on after that question: its turn carries both, with the person's reply first.
      const instance = yield* Instance
      const passed = passedOn('Which direction did you pick?')
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body: passed }, undefined, instance.coordinatorId),
        threadId: task.threadId,
        body: passed,
        disposition: 'after_current',
        quiet: true,
      })
      // The lead's turn ends, and the reply's turn starts.
      hold.open('[lead:wait]')
      yield* until(
        Effect.gen(function* () {
          return yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${task.threadId} AND body = 'B please.' AND state = 'delivered'`
        }),
        (rows) => rows[0]?.n === 1,
      )
      yield* Effect.sleep('1 second')
      assert.deepStrictEqual(
        (yield* calls(task.taskId)).map((row) => row.state),
        ['answered', 'open'],
      )
      assert.strictEqual(yield* phaseOf(projectId, task.taskId), 'waiting')
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { 'claude-code': { holds: hold } } })))
  })

  it.live('leaves a call the lead asks again in the turn that was answered open', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Compact the ADRs', ASK)
      const first = yield* asked(task.taskId)
      // Its answer carries the marker, so the lead asks again.
      yield* says(task.threadId, 'Maybe both. [lead:wait-for-person]', { kind: 'window' })
      const both = yield* until(calls(task.taskId), (rows) => rows.length === 2)
      assert.strictEqual(both[0]?.id, first)
      assert.strictEqual(both[0]?.state, 'answered')
      assert.strictEqual(both[1]?.state, 'open')
      assert.strictEqual(yield* phaseOf(projectId, task.taskId), 'waiting')
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('what isn’t the person’s word to a lead waiting on them', () => {
  it.live('leaves the call open: the coordinator’s message_lead, and Althar’s own words', () =>
    Effect.gen(function* () {
      const instance = yield* Instance
      const sessions = yield* Sessions
      const projectId = yield* opened
      const task = yield* started(projectId, 'Compact the ADRs', ASK)
      const call = yield* asked(task.taskId)
      const before = yield* until(
        Effect.map(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            return yield* sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${task.threadId}`
          }),
          (rows) => rows,
        ),
        (rows) => rows.length >= 1,
      )
      // As the coordinator's message_lead sends it: quietly, signed as the coordinator's, with no sender.
      const body = passedOn('Which direction did you pick?')
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }, undefined, instance.coordinatorId),
        threadId: task.threadId,
        body,
        disposition: 'after_current',
        quiet: true,
      })
      // As a lead's passes on another's, and as Althar's own word goes.
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}, undefined, instance.systemId),
        threadId: task.threadId,
        body: 'The checks failed.',
        disposition: 'after_current',
        quiet: true,
      })
      // Its turn takes both, and the call is still the person's to answer.
      yield* until(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${task.threadId}`
        }),
        (rows) => rows.length > before.length,
      )
      assert.strictEqual(yield* stateOf(call), 'open')
      assert.strictEqual(yield* phaseOf(projectId, task.taskId), 'waiting')
    }).pipe(Effect.provide(withQueries())),
  )
})
