import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { launches, notices, repository, runtime, task, until, withWork } from './support'

/*
 * An agent's list of models can come back short for a while: Codex's, fetched from OpenAI, once left out GPT-6.2 Sol and
 * GPT-6.1 Terra for minutes, and two reviews on Sol went straight to Stuck. A step on a model its agent listed lately and
 * doesn't now asks it again a while; still missing, it goes to the same model on another agent, never one the person
 * turned it off for; only then does it ask the person, saying what happened.
 */

const SOL = { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }
const LUNA = { id: 'gpt-6-luna', name: 'GPT-6 Luna' }
const SMALL = { id: 'small', name: 'Small' }

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

/** Every agent's models as it said them, once none is being asked. */
const catalogRead = Effect.gen(function* () {
  const models = yield* Models
  return yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
})

/** A task Claude Code leads and Codex reviews on GPT-6.2 Sol, its lead done at once, started. */
const reviewedOnSol = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const plans = yield* Plans
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Release branches with a cascade',
    description: withWork('Do it. [lead:finish] [review:wait]', true),
    draft: true,
  })
  const planId = yield* plans.propose({
    projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
    taskId: task.taskId,
    steps: [
      { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
      { key: 'review', agentId: 'codex', model: SOL.id, skipped: false },
    ],
    reason: null,
    actorId: actor,
  })
  yield* plans.start(planId, actor)
  return { projectId: project.projectId, ...task }
})

/** The review's thread, once the step has made it. */
const reviewThread = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* until(
      sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'step' AND node_key = 'review'`,
      (rows) => rows.length === 1,
    )
    return thread?.id ?? ''
  })

/** The reviewer's session under way, by its agent and model. */
const reviewerOn = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* until(
      sql<{ agentId: string; model: string | null }>`
        SELECT s.agent_id, s.model FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
        WHERE t.task_id = ${taskId} AND t.kind = 'step' AND t.node_key = 'review' AND s.state = 'active'`,
      (rows) => rows.length === 1,
    )
    return session
  })

/** The step's call on the person, once there is one. */
const stuckCall = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [call] = yield* until(
      sql<{ payload: string }>`SELECT payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
      (rows) => rows.length === 1,
    )
    return JSON.parse(call?.payload ?? '{}') as { step: string; why: string; detail: string | null; agentId: string | null }
  })

const openCalls = (taskId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck' AND state = 'open'`,
  )

/** How many sessions of the agent have been launched so far: its models probes left out. */
const sessionLaunches = (agentId: string) => launches.filter((one) => one.agentId === agentId && one.env.ALTHAR_WORKER !== undefined).length

/** The models the catalog says the agent offers, once none is being asked. */
const offeredBy = (agentId: string) =>
  Effect.map(catalogRead, (all) => all.find((agent) => agent.agentId === agentId)?.models.map((model) => model.id) ?? [])

const titles = (threadId: string) => Effect.map(notices(threadId), (all) => all.map((notice) => notice.title ?? ''))

describe('a step on a model its agent stops listing', () => {
  // What each agent offers as it starts, by `<agent>@usual`; changed as a test goes, as each start reads it afresh.
  const offering = (): Record<string, FakeAgentOptions> => ({
    'codex@usual': { models: [SOL, LUNA] },
    'claude-code@usual': { models: [SMALL] },
    'opencode@usual': { models: [SMALL] },
  })

  it.live('asks the agent again while its list is short, and the step carries on there once it lists the model again', () => {
    const each = offering()
    return Effect.gen(function* () {
      assert.include((yield* catalogRead).find((agent) => agent.agentId === 'codex')?.models.map((model) => model.id) ?? [], SOL.id)
      // Codex's list comes back short, without Sol, as OpenAI's did.
      each['codex@usual'] = { models: [LUNA] }
      const task = yield* reviewedOnSol
      const thread = yield* reviewThread(task.taskId)
      // The review waits on Codex rather than stopping, and says why its start takes longer.
      yield* until(titles(thread), (said) =>
        said.includes(
          "Fake codex doesn't list GPT-6.2 Sol just now. Asking it again for up to 30 seconds before the work goes to another agent.",
        ),
      )
      // Asked again, Codex's own list, all Althar knew Sol from, comes back short too, and several more starts find it missing:
      // the wait goes on, on what it saw first.
      const before = sessionLaunches('codex')
      yield* until(offeredBy('codex'), (ids) => !ids.includes(SOL.id))
      yield* until(
        Effect.sync(() => sessionLaunches('codex')),
        (count) => count >= before + 4,
      )
      assert.deepStrictEqual(yield* openCalls(task.taskId), [])
      each['codex@usual'] = { models: [SOL, LUNA] }
      assert.deepStrictEqual(yield* reviewerOn(task.taskId), { agentId: 'codex', model: SOL.id })
      assert.deepStrictEqual(yield* openCalls(task.taskId), [])
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each, modelWait: { every: Duration.millis(50), within: Duration.seconds(30) } })))
  })

  it.live('goes to the same model on another agent once asking again has not brought it back', () => {
    const each = offering()
    return Effect.gen(function* () {
      // Claude Code offers Sol too, beside the model its lead is on.
      each['claude-code@usual'] = { models: [SMALL, SOL] }
      yield* catalogRead
      each['codex@usual'] = { models: [LUNA] }
      const task = yield* reviewedOnSol
      const thread = yield* reviewThread(task.taskId)
      // The same model, through Claude Code: never another model unasked, and nothing asks the person.
      assert.deepStrictEqual(yield* reviewerOn(task.taskId), { agentId: 'claude-code', model: SOL.id })
      assert.include(yield* titles(thread), 'Fake codex stopped listing GPT-6.2 Sol: it carries on through Fake claude-code.')
      assert.deepStrictEqual(yield* openCalls(task.taskId), [])
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each })))
  })

  it.live('asks the person, saying what happened, where the only other agent offering it has it turned off', () => {
    const each = offering()
    return Effect.gen(function* () {
      // OpenCode offers Sol, but the person turned it off there: Sol never runs on OpenCode.
      each['opencode@usual'] = { models: [SOL, SMALL] }
      yield* catalogRead
      yield* (yield* Models).setModelBlocked({ agentId: 'opencode', model: SOL.id, blocked: true })
      each['codex@usual'] = { models: [LUNA] }
      const task = yield* reviewedOnSol
      const call = yield* stuckCall(task.taskId)
      assert.deepInclude(call, {
        step: 'review',
        why: 'failed_to_start',
        agentId: 'codex',
        detail: "It stopped listing GPT-6.2 Sol, and still didn't after a second of asking again. No other agent with room offers it.",
      })
      // Nothing started on OpenCode, nor on another model.
      const sql = yield* SqlClient.SqlClient
      const started = yield* sql<{ agentId: string }>`
        SELECT DISTINCT s.agent_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step'`
      assert.deepStrictEqual(started, [{ agentId: 'codex' }])
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each, modelWait: { every: Duration.millis(100), within: Duration.seconds(1) } })))
  })

  it.live('goes on past another agent that stopped listing it too, and says so where none is left', () => {
    const each = offering()
    return Effect.gen(function* () {
      // Claude Code listed Sol too, and OpenCode offers it turned off; then neither Codex nor Claude Code lists it.
      each['claude-code@usual'] = { models: [SMALL, SOL] }
      each['opencode@usual'] = { models: [SOL, SMALL] }
      yield* catalogRead
      yield* (yield* Models).setModelBlocked({ agentId: 'opencode', model: SOL.id, blocked: true })
      each['codex@usual'] = { models: [LUNA] }
      each['claude-code@usual'] = { models: [SMALL] }
      const task = yield* reviewedOnSol
      assert.deepInclude(yield* stuckCall(task.taskId), {
        step: 'review',
        why: 'failed_to_start',
        agentId: 'codex',
        detail:
          "It stopped listing GPT-6.2 Sol, and still didn't after a second of asking again. Fake claude-code stopped listing it too, and no other agent with room offers it.",
      })
      const sql = yield* SqlClient.SqlClient
      const started = yield* sql<{ agentId: string }>`
        SELECT DISTINCT s.agent_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
        WHERE t.task_id = ${task.taskId} AND t.kind = 'step' ORDER BY s.agent_id`
      assert.deepStrictEqual(started, [{ agentId: 'claude-code' }, { agentId: 'codex' }])
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each, modelWait: { every: Duration.millis(100), within: Duration.seconds(1) } })))
  })

  it.live('goes on past a first agent whose list Althar held from before, to a third that starts on the model', () => {
    const each = offering()
    return Effect.gen(function* () {
      // OpenCode was asked once and said Sol, but its sessions no longer list it; Claude Code's do.
      const opencode: FakeAgentOptions = {
        get models() {
          return launches.at(-1)?.env.ALTHAR_WORKER === undefined ? [SOL, SMALL] : [SMALL]
        },
      }
      each['opencode@usual'] = opencode
      each['claude-code@usual'] = { models: [SMALL, SOL] }
      yield* catalogRead
      each['codex@usual'] = { models: [LUNA] }
      const task = yield* reviewedOnSol
      const thread = yield* reviewThread(task.taskId)
      assert.deepStrictEqual(yield* reviewerOn(task.taskId), { agentId: 'claude-code', model: SOL.id })
      assert.include(yield* titles(thread), 'Fake codex stopped listing GPT-6.2 Sol: it carries on through Fake claude-code.')
      // OpenCode, first in line, was tried and passed over.
      const sql = yield* SqlClient.SqlClient
      const tried = yield* sql<{ agentId: string }>`
        SELECT DISTINCT s.agent_id FROM provider_sessions s WHERE s.thread_id = ${thread} ORDER BY s.agent_id`
      assert.deepStrictEqual(tried, [{ agentId: 'claude-code' }, { agentId: 'codex' }, { agentId: 'opencode' }])
      assert.deepStrictEqual(yield* openCalls(task.taskId), [])
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each })))
  })

  it.live('refuses a model the agent never listed with its kind, so handing on can tell it from another failure', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      yield* catalogRead
      const { task: made } = yield* task()
      const failed = yield* Effect.flip(sessions.start({ threadId: made.threadId, agentId: 'codex', model: 'nowhere' }))
      assert.deepInclude(failed, { summary: "The agent doesn't offer nowhere.", modelRefused: 'nowhere' })
      assert.notProperty(failed, 'modelGone')
    }).pipe(Effect.provide(withQueries())),
  )

  // A try held as it starts, as an agent slow to start is: the stop comes while it is under way.
  const heldTry = (models: ReadonlyArray<{ readonly id: string; readonly name: string }>) => {
    let release = () => {}
    const gate = new Promise<void>((done) => (release = done))
    const held = { entered: false, release: () => release() }
    const options: FakeAgentOptions = {
      models,
      // A models probe goes through at once.
      get beforeNewSession() {
        const session = launches.at(-1)?.env.ALTHAR_WORKER !== undefined
        return async () => {
          if (!session) return
          held.entered = true
          await gate
        }
      },
    }
    return { held, options }
  }

  for (const [back, words] of [
    [true, 'its agent lists the model again'],
    [false, 'the model is still missing, and another agent offers it'],
  ] as const)
    it.live(`stops on a stop during a try under way, where ${words}: nothing takes the thread, here or elsewhere`, () => {
      const each = offering()
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        each['claude-code@usual'] = { models: [SMALL, SOL] }
        yield* catalogRead
        each['codex@usual'] = { models: [LUNA] }
        const { task: made } = yield* task()
        const starting = yield* Effect.forkChild(Effect.flip(sessions.start({ threadId: made.threadId, agentId: 'codex', model: SOL.id })))
        yield* until(titles(made.threadId), (said) => said.some((title) => title.includes('just now')))
        const { held, options } = heldTry(back ? [SOL, LUNA] : [LUNA])
        each['codex@usual'] = options
        yield* until(
          Effect.sync(() => held.entered),
          (entered) => entered,
        )
        const stopping = yield* Effect.forkChild(sessions.stop(made.threadId))
        yield* Effect.sleep(Duration.millis(100))
        held.release()
        yield* Fiber.join(stopping).pipe(Effect.timeout(Duration.seconds(10)))
        const failed = yield* Fiber.join(starting)
        const said = 'summary' in failed ? String(failed.summary) : ''
        // Back on its list, the try that started is let go; still missing, it says so, and nothing is handed on.
        if (back) assert.strictEqual(said, 'Stopped while it waited for its agent to list its model again.')
        else assert.include(said, 'It stopped listing GPT-6.2 Sol')
        assert.isTrue(Option.isNone(yield* sessions.running(made.threadId)))
        // Nothing was handed on to Claude Code.
        const sql = yield* SqlClient.SqlClient
        const on = yield* sql<{ agentId: string }>`SELECT DISTINCT agent_id FROM provider_sessions WHERE thread_id = ${made.threadId}`
        assert.deepStrictEqual(on, [{ agentId: 'codex' }])
      }).pipe(
        Effect.provide(
          withQueries(
            ':memory:',
            {},
            {
              each,
              modelWait: back
                ? { every: Duration.millis(300), within: Duration.seconds(30) }
                : { every: Duration.millis(300), within: Duration.millis(300) },
            },
          ),
        ),
      )
    })

  it.live('stops waiting at once where its thread is stopped, starting nothing more here or elsewhere', () => {
    const each = offering()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      each['claude-code@usual'] = { models: [SMALL, SOL] }
      yield* catalogRead
      each['codex@usual'] = { models: [LUNA] }
      const { task: made } = yield* task()
      const starting = yield* Effect.forkChild(Effect.flip(sessions.start({ threadId: made.threadId, agentId: 'codex', model: SOL.id })))
      yield* until(titles(made.threadId), (said) => said.some((title) => title.includes('just now')))
      // Stop answers within the wait, though the start holds the thread.
      yield* sessions.stop(made.threadId).pipe(Effect.timeout(Duration.seconds(5)))
      const failed = yield* Fiber.join(starting)
      assert.strictEqual('summary' in failed ? failed.summary : '', 'Stopped while it waited for its agent to list its model again.')
      const after = { codex: sessionLaunches('codex'), claude: sessionLaunches('claude-code') }
      yield* Effect.sleep(Duration.millis(500))
      assert.deepStrictEqual({ codex: sessionLaunches('codex'), claude: sessionLaunches('claude-code') }, after)
      assert.isTrue(Option.isNone(yield* sessions.running(made.threadId)))
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each, modelWait: { every: Duration.millis(100), within: Duration.seconds(30) } })))
  })

  it.live('says at once a model its agent never listed, without asking again', () =>
    Effect.gen(function* () {
      yield* catalogRead
      const task = yield* reviewedOnSol
      const thread = yield* reviewThread(task.taskId)
      const call = yield* stuckCall(task.taskId)
      assert.deepInclude(call, { step: 'review', why: 'failed_to_start', detail: "The agent doesn't offer gpt-6.2-sol." })
      assert.notInclude((yield* titles(thread)).join('\n'), 'just now')
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each: { 'codex@usual': { models: [LUNA] } } }))),
  )

  it.live('leaves a model gone from its agent out of the pickers, its earlier sessions’ lists included, until it lists it again', () => {
    const each = offering()
    const codexModels = Effect.map(catalogRead, (all) => all.find((agent) => agent.agentId === 'codex')?.models.map((model) => model.id))
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      yield* catalogRead
      // A session whose list said Sol, as Codex's did all day.
      const { task: earlier } = yield* task()
      yield* sessions.start({ threadId: earlier.threadId, agentId: 'codex', model: LUNA.id })
      yield* sessions.stop(earlier.threadId)
      // Then Codex stops listing it, and asking again doesn't bring it back.
      each['codex@usual'] = { models: [LUNA] }
      const { task: later } = yield* task()
      const failed = yield* Effect.flip(sessions.start({ threadId: later.threadId, agentId: 'codex', model: SOL.id }))
      assert.strictEqual(
        'summary' in failed ? failed.summary : '',
        "It stopped listing GPT-6.2 Sol, and still didn't after a second of asking again. No other agent with room offers it.",
      )
      assert.deepStrictEqual(yield* codexModels, [LUNA.id])
      // Listed again, it is offered again.
      each['codex@usual'] = { models: [SOL, LUNA] }
      yield* (yield* Models).refresh('codex')
      yield* until(codexModels, (ids) => ids?.includes(SOL.id) === true)
    }).pipe(Effect.provide(withQueries(':memory:', {}, { each, modelWait: { every: Duration.millis(100), within: Duration.seconds(1) } })))
  })
})
