import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { whenWords } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { atReset, items, later, onTestClock, repository, runtime, until } from './support'

/*
 * The coordinator out of usage, where limits.test.ts and accounts.test.ts
 * don't go: carried on by its own agent's next account where the project
 * turns that on, or left waiting where nothing else is free; a plan whose
 * lead was out before it started, with nothing free to start instead; and a
 * call an earlier Althar made without the account that ran out, waited on.
 */

const HOUR = 60 * 60 * 1000

const withAgents = (each: Readonly<Record<string, FakeAgentOptions>>, signedOut: ReadonlyArray<string> = []) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each, signedOut })))

/** A project, and the person asking its coordinator something. */
const asked = (body: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const threadId = yield* coordinator.thread(project.projectId)
    return {
      projectId: project.projectId as ProjectId,
      threadId,
      say: coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body,
        disposition: 'after_current',
      }),
    }
  })

/** The notices a thread says, in order. */
const said = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** The agents' replies in a thread, and the agent and account each came from. */
const replies = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string; accountId: string }>`
      SELECT s.agent_id, s.account_id FROM thread_items i JOIN provider_sessions s ON s.id = i.provider_session_id
      WHERE i.thread_id = ${threadId} AND i.kind = 'agent_message' ORDER BY i.sequence`
  })

describe('the coordinator out of usage', () => {
  it.live('carries on on its own agent’s next account where the project turns that on, with what the person said', () => {
    const back = Date.now() + HOUR
    const workFolder = join(mkdtempSync(join(tmpdir(), 'althar-home-')), 'work')
    mkdirSync(workFolder)
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const policies = yield* Policies
      const instance = yield* Instance
      const work = yield* accounts.add({ agentId: 'claude-code', name: 'work', folder: workFolder })
      const { projectId, threadId, say } = yield* asked('Is the checkout slow?')
      yield* policies.setAccounts(projectId, { rotate: true }, instance.personId)
      yield* say
      const [reply] = yield* until(replies(threadId), (all) => all.length > 0)
      assert.deepStrictEqual(reply, { agentId: 'claude-code', accountId: work.id })
      assert.include(
        yield* said(threadId),
        `Fake claude-code (main) ran out of usage, until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), Date.now())}. Fake claude-code (work) takes over, on Small.`,
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code@usual': { outOfUsage: { until: back } } })))
  })

  it.live(
    'leaves what the person said waiting where it moves work on but nothing else is free; a plan it leads then needs the person',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const plans = yield* Plans
        const projects = yield* Projects
        const instance = yield* Instance
        const { projectId, threadId, say } = yield* asked('Is the checkout slow?')
        yield* say
        const lines = yield* until(said(threadId), (all) => all.some((line) => line.includes('ran out of usage')))
        assert.include(lines, 'Fake claude-code ran out of usage. Your message waits until Fake claude-code is back.')
        assert.lengthOf(yield* replies(threadId), 0)

        // Out already, and nothing else free to start instead: the plan's lead starts all the same, and its step needs the person.
        const task = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId,
          title: 'Retry the checkout [lead:finish]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId,
          taskId: task.taskId,
          steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
          reason: null,
          actorId: instance.personId,
          end: null,
          held: true,
        })
        yield* plans.start(planId, instance.personId)
        const [call] = yield* until(
          sql<{
            payload: string
          }>`SELECT payload FROM attention_requests WHERE task_id = ${task.taskId} AND kind = 'stuck' AND state = 'open'`,
          (rows) => rows.length === 1,
        )
        assert.deepInclude(JSON.parse(call?.payload ?? '{}'), { step: 'implement', why: 'usage_limit', agentId: 'claude-code' })
        const ran = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${task.threadId}`
        assert.deepStrictEqual(ran, [{ agentId: 'claude-code' }])
      }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: {} } }, ['codex', 'opencode']))),
  )
})

describe('a usage-limit call made without the account that ran out, as an earlier Althar made one', () => {
  it.effect('holds the step until the reset when the person waits, and carries it on then on the agent’s own account', () => {
    const back = later()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const plans = yield* Plans
      const projects = yield* Projects
      const policies = yield* Policies
      const instance = yield* Instance
      const runs = yield* Runs
      const accounts = yield* Accounts
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* policies.setUsageLimit(project.projectId, 'ask', instance.personId)
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout [lead:finish]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      yield* sql`UPDATE attention_requests SET payload = json_set(payload, '$.limit.accountId', NULL) WHERE id = ${call?.id ?? ''}`
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'wait' },
      })
      const [held] = yield* sql<{ output: string }>`SELECT output FROM node_attempts WHERE state = 'held'`
      assert.deepInclude(JSON.parse(held?.output ?? '{}'), { heldFor: 'claude-code', account: null, why: 'asked' })
      assert.include(
        yield* said(task.threadId),
        `The work waits until ${whenWords(new Date(Math.ceil(back / 1000) * 1000).toISOString(), yield* Clock.currentTimeMillis)}.`,
      )
      // At the reset, its lead carries on, on the agent's first account, and finishes.
      yield* atReset(back)
      yield* until(sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${task.taskId}`, (rows) => rows[0]?.state === 'succeeded')
      const [usual] = yield* accounts.of('claude-code')
      const ran = yield* sql<{ accountId: string }>`
        SELECT account_id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at, rowid`
      assert.deepStrictEqual(
        ran.map((row) => row.accountId),
        [usual?.id],
      )
    }).pipe(Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back } } })), onTestClock)
  })
})
