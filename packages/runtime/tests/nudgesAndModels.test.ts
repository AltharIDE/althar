import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Limits } from '../src/Limits'
import { ModelFacts } from '../src/ModelFacts'
import { Models } from '../src/Models'
import { type NudgeEvent, Nudges } from '../src/Nudges'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { usableModels } from '../src/usableModels'
import { callTool, repository, runtime, turns, until } from './support'

/*
 * What waits on the person and what work can go to, at turns their own
 * tests don't take: a lead's question nudging them as a call, an agent out
 * of usage leaving the models usable now, a model switched off that its
 * agent doesn't offer, what is known of models read with no copy kept, and
 * a settled task's card read again as it was.
 */

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

/** A task in a new project whose lead, on `agentId`, has finished its first turn. */
const leading = (title: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const project = yield* open
    const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: project.projectId, title })
    yield* sessions.start({ threadId: task.threadId, agentId })
    yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
    return { projectId: project.projectId, ...task }
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
  })

describe('a lead’s question', () => {
  it.live('nudges the person as a call on its task', () =>
    Effect.gen(function* () {
      const nudges = yield* Nudges
      const events: Array<NudgeEvent> = []
      const fiber = yield* Effect.forkChild(Stream.runForEach(nudges.events, (event) => Effect.sync(() => void events.push(event))))
      const task = yield* leading('Pick the cache')
      yield* say(task.threadId, scenarios.question)
      const [nudge] = yield* until(
        Effect.sync(() => events.flatMap((event) => (event._tag === 'Nudge' ? [event] : []))),
        (found) => found.length > 0,
        Duration.seconds(20),
      )
      assert.deepInclude(nudge, { kind: 'call', title: 'Pick the cache', threadId: task.threadId })
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provide(Nudges.layer.pipe(Layer.provideMerge(Queries.layer), Layer.provideMerge(runtime())))),
  )
})

describe('the models usable now', () => {
  it.live('leave out an agent out of usage', () =>
    Effect.gen(function* () {
      const models = yield* Models
      const limits = yield* Limits
      yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      const agentsOf = Effect.map(usableModels(), (usable) =>
        [...new Set(usable.flatMap((model) => model.routes.map((route) => route.agentId)))].toSorted(),
      )
      assert.deepStrictEqual(yield* agentsOf, ['claude-code', 'codex', 'opencode'])
      const task = yield* leading('Retry')
      yield* say(task.threadId, 'hello')
      yield* until(
        Effect.map(limits.out('codex'), (out) => (Option.isSome(out) ? [out] : [])),
        (outs) => outs.length === 1,
      )
      assert.deepStrictEqual(yield* agentsOf, ['claude-code', 'opencode'])
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { codex: { outOfUsage: {} } } }))),
  )
})

describe('what is known of models', () => {
  it.live('is read from the list where Althar keeps no copy of it, and kept nowhere', () => {
    const asked: Array<string> = []
    const fetch = async (url: string) => {
      asked.push(url)
      return Response.json({
        data: [
          {
            id: 'fake/large',
            benchmarks: { artificial_analysis: { intelligence_index: 60, coding_index: 70, agentic_index: 50 } },
            pricing: { prompt: '0.000001', completion: '0.000002' },
            context_length: 200_000,
          },
        ],
      })
    }
    return Effect.gen(function* () {
      const facts = yield* ModelFacts
      const large = Effect.sync(() => [facts.of({ id: 'codex', name: 'Fake codex' }, { id: 'large', name: 'Large' })?.intelligence])
      yield* until(large, ([intelligence]) => intelligence === 60)
      assert.deepStrictEqual(asked, ['https://openrouter.test/models'])
    }).pipe(Effect.provide(runtime(':memory:', {}, { modelFacts: { url: 'https://openrouter.test/models', fetch } })))
  })
})

describe('a step’s model named by its agent', () => {
  it.live('is refused where the person switched it off, though the agent doesn’t offer it', () =>
    Effect.gen(function* () {
      const models = yield* Models
      const project = yield* open
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      yield* models.setModelBlocked({ agentId: 'codex', model: 'mystery-9', blocked: true })
      yield* callTool(access, 'draft_task', { title: 'Tidy up' })
      assert.match(
        yield* callTool(access, 'propose_plan', { task: 'tidy-up', lead: { agent: 'codex', model: 'mystery-9' } }),
        /^The person switched mystery-9 off\./,
      )
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a settled task’s card', () => {
  it.live('reads the same on the board again, as it settled', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      const tasks = yield* Tasks
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const project = yield* open
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(
        yield* callTool(access, 'start_task', { title: 'Check the partners', description: '[lead:finish]', lead: { agent: 'codex' } }),
        /^Started /,
      )
      const [task] = yield* sql<{ taskId: string; threadId: string }>`
        SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.project_id = ${project.projectId}`
      yield* until(
        turns(task?.threadId ?? ''),
        (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
      )
      yield* sessions.stop(task?.threadId ?? '')
      assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: task?.taskId ?? '' }))
      const cardOf = Effect.map(queries.board(project.projectId), (board) => board.tasks.find((card) => card.taskId === task?.taskId))
      const first = yield* cardOf
      assert.strictEqual(first?.phase, 'settled')
      assert.deepStrictEqual(yield* cardOf, first)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
