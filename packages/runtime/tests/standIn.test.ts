import type { ProjectId } from '@althar/domain'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { whenWords } from '../src/Limits'
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

      // Its usage back, the given lead takes over again from the next turn, and the thread says so then.
      yield* atReset(back)
      const after = yield* until(said(task.threadId), (lines) => lines.some((line) => line.includes('has usage again')))
      assert.include(after, 'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.')
      assert.include(
        yield* shown(task.threadId),
        'Large on Fake claude-code has usage again and takes over again from Small on Fake codex.',
      )
      assert.isTrue(Option.isNone(yield* standInOf(standIn?.id ?? '')))
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'How does it look?' })
      const answered = yield* until(replies(task.threadId), (rows) =>
        rows.some((row) => row.agentId === 'claude-code' && row.content.includes('How does it look?')),
      )
      assert.isTrue(answered.length > 0)
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
})
