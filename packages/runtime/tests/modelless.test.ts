import { Ids } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { FakeAgentOptions } from '@althar/provider-adapters/testing'

import { type AgentEntry, Agents, type StallOptions } from '../src/Config'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { PermissionJudge } from '../src/PermissionJudge'
import { Plans } from '../src/Plans'
import { Policies, ruleSetOf } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeAgents, items, notices, repository, runtime, task, turns, until } from './support'

/*
 * Agents that offer no choice of model, as some ACP agents don't: OpenCode
 * here offers neither a model nor an effort, and Claude Code an effort
 * only. Their sessions run on what the agent picks, and keep nothing of a
 * model wherever one would be kept: started again, started afresh after a
 * stall or to keep its context small, held for a usage limit, and judging a
 * permission request as the coordinator.
 */

/**
 * The fake agents, as given, but OpenCode with no model or effort to set, and Claude Code with no model: each named as
 * offering a model option its sessions don't have, as an agent whose choice of model is gone.
 */
const withoutModels = (each: Readonly<Record<string, FakeAgentOptions>> = {}) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const plain = (entry: AgentEntry): AgentEntry =>
        entry.definition.id === 'opencode'
          ? { ...entry, definition: { ...entry.definition, options: { mode: 'mode', model: 'model-choice' } } }
          : entry.definition.id === 'claude-code'
            ? { ...entry, definition: { ...entry.definition, options: { mode: 'mode', model: 'model-choice', effort: 'effort' } } }
            : entry
      return Agents.of({ list: agents.list.map(plain), get: (agentId) => Effect.map(agents.get(agentId), plain) })
    }),
  ).pipe(Layer.provide(fakeAgents({}, [], each)))

const withQueries = (more: Parameters<typeof runtime>[2] = {}, each: Readonly<Record<string, FakeAgentOptions>> = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { agents: withoutModels(each), ...more })))

/** Stalls told in a moment rather than minutes. */
const FAST: StallOptions = {
  every: Duration.millis(50),
  quiet: Duration.millis(400),
  quietInTool: Duration.millis(400),
  cancelGrace: Duration.seconds(2),
}

/** The thread's sessions, oldest first: their agent, model, effort and where each stands. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string; model: string | null; effort: string | null; state: string }>`
      SELECT agent_id, model, effort, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

describe('an agent that offers no choice of model', () => {
  it.live('is started again on no model for an answer to a question it asked before it went', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const runs = yield* Runs
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'opencode' })
      yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      yield* say(created.threadId, scenarios.question)
      const [question] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE kind = 'question' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      yield* sessions.stop(created.threadId)
      yield* runs.answer({
        envelope: yield* Runtime.envelope('attention.answer_question', {}),
        attentionId: question?.id ?? '',
        answers: { database: { values: ['sqlite'] } },
      })
      yield* until(
        Effect.map(items(created.threadId), (all) =>
          all.filter((item) => item.kind === 'agent_message' && String(item.content.text).startsWith('told=')),
        ),
        (told) => told.length === 1,
      )
      assert.deepStrictEqual(
        (yield* sessionsOn(created.threadId)).map((session) => [session.agentId, session.model, session.effort]),
        [
          ['opencode', null, null],
          ['opencode', null, null],
        ],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is started afresh after a stall on no model or effort', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Quiet')
      yield* sessions.start({ threadId: created.threadId, agentId: 'opencode' })
      yield* say(created.threadId, 'Serve it. [lead:hang]')
      yield* until(
        Effect.map(notices(created.threadId), (said) =>
          said.filter((notice) => notice.title === 'Fake opencode showed no sign of work again, so Althar started it afresh.'),
        ),
        (said) => said.length === 1,
      )
      const started = yield* until(sessionsOn(created.threadId), (rows) => rows.length === 2 && rows[1]?.state === 'active')
      assert.deepStrictEqual(
        started.map((row) => [row.model, row.effort]),
        [
          [null, null],
          [null, null],
        ],
      )
    }).pipe(Effect.provide(withQueries({ stalls: FAST }))),
  )

  it.live('puts a session on the effort asked for where it offers one', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code', effort: 'high' })
      yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      assert.deepStrictEqual(
        (yield* sessionsOn(created.threadId)).map((session) => [session.model, session.effort]),
        [[null, 'high']],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('judges a request as the coordinator on the model it picks itself', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const policies = yield* Policies
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task('Run the checkout tests')
      yield* policies.set(project.projectId, { permissions: 'coordinator', alwaysAsk: [] }, instance.personId)
      yield* sessions.start({ threadId: project.coordinatorThreadId, agentId: 'opencode' })
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      const projectId = Schema.decodeUnknownSync(Ids.project.schema)(project.projectId)
      const judged = yield* (yield* PermissionJudge).judge({
        projectId,
        threadId: created.threadId,
        taskId: created.taskId,
        request: {
          sessionId: 'provider-session',
          toolCallId: 'call-1',
          title: 'npm test',
          kind: 'execute',
          paths: [],
          rawInput: { command: 'npm test' },
          options: [
            { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
          ],
        },
        rules: ruleSetOf((yield* policies.current(projectId)).rules),
        workspace: { worktree: workspace?.path ?? '', defaultBranch: 'main' },
      })
      assert.deepStrictEqual([judged.decision, judged.agentId, judged.model], ['allow', 'opencode', null])
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('an agent that offers no choice of model, further on', () => {
  it.live('is handed to a fresh session as the coordinator, on no model or effort', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const coordinator = yield* Coordinator
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* sessions.start({ threadId, agentId: 'opencode' })
      const say = (body: string) =>
        Effect.flatMap(Runtime.envelope('thread.send', { body }), (envelope) =>
          coordinator.say({ envelope, threadId, body, disposition: 'after_current' }),
        )
      yield* say('hello')
      yield* until(turns(threadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
      yield* say('Where are we? [context:85]')
      const handed = yield* until(sessionsOn(threadId), (rows) => rows.length === 2 && rows[1]?.state === 'active', Duration.seconds(20))
      assert.deepStrictEqual(
        handed.map((row) => [row.agentId, row.model, row.effort, row.state]),
        [
          ['opencode', null, null, 'superseded'],
          ['opencode', null, null, 'active'],
        ],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is held for a usage limit where its project waits, on no model', () => {
    const back = Date.now() + 60 * 60 * 1000
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* policies.setUsageLimit(project.projectId, 'wait', instance.personId)
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout [lead:finish]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'opencode', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const [held] = yield* until(
        sql<{ output: string }>`SELECT output FROM node_attempts WHERE state = 'held' AND hold_reason = 'usage_limit'`,
        (rows) => rows.length === 1,
        Duration.seconds(15),
      )
      assert.deepInclude(JSON.parse(held?.output ?? '{}'), { heldFor: 'opencode', model: null, why: 'waits' })
    }).pipe(Effect.provide(withQueries({}, { opencode: { outOfUsage: { until: back } } })))
  })
})
