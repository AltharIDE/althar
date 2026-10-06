import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentDefinition } from '@althar/provider-adapters'
import { fakeAgent, fakeAgentMain } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { type AgentEntry, Agents } from '../src/Config'
import { EffortUnchanged, UnknownAgent } from '../src/errors'
import { Models, modelsOf } from '../src/Models'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { Sessions } from '../src/Sessions'
import { definition, fakeConnectors, items, repository, runtime, until } from './support'

/** What the fake agent offers: two models, and three efforts. */
const OFFERED = {
  models: [
    { id: 'small', name: 'Small', description: 'Quick, for small things' },
    { id: 'large', name: 'Large', description: 'The most capable' },
  ],
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
}

/** A task's thread, for a session to run on. */
const thread = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const created = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Retry the checkout',
  })
  return created.threadId
})

/** A runtime with these agents: `process` runs as a real process, and `missing` can't be started. */
const withAgents = (ids: ReadonlyArray<string>, define: (agentId: string) => AgentDefinition) =>
  Runtime.layer({
    database: ':memory:',
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: Layer.succeed(
      Agents,
      Agents.from(
        ids.map((agentId): AgentEntry => ({
          definition: define(agentId),
          transport: (cwd) =>
            agentId === 'process'
              ? { _tag: 'Process', spec: { command: 'bun', args: [fakeAgentMain] }, cwd }
              : agentId === 'missing'
                ? { _tag: 'Process', spec: { command: 'althar-no-such-agent', args: [] }, cwd }
                : { _tag: 'InProcess', agent: fakeAgent() },
        })),
      ),
    ),
    secrets: Secrets.memory(),
    connectors: fakeConnectors({}),
  })

describe('the models each agent offers', () => {
  it.live('are asked of an agent never run, once, in the background, then known', () =>
    Effect.gen(function* () {
      const models = yield* Models
      const first = yield* models.catalog
      assert.deepStrictEqual(
        first.map((agent) => [agent.agentId, agent.probing, agent.models.length]),
        [
          ['claude-code', true, 0],
          ['codex', true, 0],
          ['opencode', true, 0],
        ],
      )
      const known = yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      assert.deepStrictEqual(known[0], {
        agentId: 'claude-code',
        ...OFFERED,
        model: 'small',
        effort: 'medium',
        defaults: [],
        probing: false,
      })
      // Asking left nothing behind: no session was recorded for it.
      const sql = yield* SqlClient.SqlClient
      assert.lengthOf(yield* sql`SELECT id FROM provider_sessions`, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('are read from an agent’s latest session until it is asked, with what it was set to', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const models = yield* Models
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'codex', model: 'large', effort: 'high' })
      const codex = () => Effect.map(models.catalog, (all) => all.find((agent) => agent.agentId === 'codex'))
      assert.deepStrictEqual(yield* codex(), { agentId: 'codex', ...OFFERED, model: 'large', effort: 'high', defaults: [], probing: true })
      const [asked] = yield* until(
        Effect.map(models.catalog, (all) => all.filter((agent) => agent.agentId === 'codex')),
        (found) => found[0]?.probing === false,
      )
      assert.deepStrictEqual(asked, { agentId: 'codex', ...OFFERED, model: 'large', effort: 'high', defaults: [], probing: false })
      // Changed while it runs, it says what it is on now.
      yield* sessions.setModel({ threadId, model: 'small' })
      yield* sessions.setEffort({ threadId, effort: 'low' })
      assert.deepStrictEqual([(yield* codex())?.model, (yield* codex())?.effort], ['small', 'low'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('are asked again of an agent whose latest session was kept without their names', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const models = yield* Models
      const sql = yield* SqlClient.SqlClient
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'codex', model: 'large', effort: 'high' })
      // As a session started before Althar kept the names recorded it: values alone.
      const [row] = yield* sql<{ id: string; config: string }>`SELECT id, config FROM provider_sessions WHERE agent_id = 'codex'`
      const config = JSON.parse(row?.config ?? '{}') as { options: Array<Record<string, unknown>> }
      const bare = { ...config, options: config.options.map(({ choices: _, ...option }) => option) }
      yield* sql`UPDATE provider_sessions SET config = ${JSON.stringify(bare)} WHERE id = ${row?.id ?? ''}`
      const codex = () => Effect.map(models.catalog, (all) => all.find((agent) => agent.agentId === 'codex'))
      const first = yield* codex()
      assert.deepStrictEqual([first?.probing, first?.models.map((model) => model.name), first?.model], [true, ['small', 'large'], 'large'])
      // Named once it has said, and still on what its session was set to.
      const [named] = yield* until(
        Effect.map(models.catalog, (all) => all.filter((agent) => agent.agentId === 'codex')),
        (found) => found[0]?.probing === false,
      )
      assert.deepStrictEqual(named, { agentId: 'codex', ...OFFERED, model: 'large', effort: 'high', defaults: [], probing: false })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('are asked again each launch: a model the agent offers since its latest session is there', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const models = yield* Models
      const sql = yield* SqlClient.SqlClient
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'codex', model: 'small', effort: 'high' })
      // As an older version of the agent recorded it: without its newest model.
      const [row] = yield* sql<{ id: string; config: string }>`SELECT id, config FROM provider_sessions WHERE agent_id = 'codex'`
      const config = JSON.parse(row?.config ?? '{}') as {
        options: Array<{ category?: string; choices?: Array<{ value: string }>; values?: Array<string> }>
      }
      const older = {
        ...config,
        options: config.options.map((option) =>
          option.category === 'model'
            ? {
                ...option,
                values: option.values?.filter((value) => value !== 'large'),
                choices: option.choices?.filter((choice) => choice.value !== 'large'),
              }
            : option,
        ),
      }
      yield* sql`UPDATE provider_sessions SET config = ${JSON.stringify(older)} WHERE id = ${row?.id ?? ''}`
      const codex = Effect.map(models.catalog, (all) => all.filter((agent) => agent.agentId === 'codex'))
      const [first] = yield* codex
      assert.deepStrictEqual([first?.probing, first?.models.map((model) => model.id)], [true, ['small']])
      const [asked] = yield* until(codex, (found) => found[0]?.probing === false)
      assert.deepStrictEqual([asked?.models.map((model) => model.id), asked?.model], [['small', 'large'], 'small'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('aren’t asked of an agent that is signed out, nor again of one that couldn’t say', () =>
    Effect.gen(function* () {
      const models = yield* Models
      yield* models.catalog
      const settled = yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      assert.deepStrictEqual(
        settled.map((agent) => [agent.agentId, agent.models.length]),
        [
          ['claude-code', 2],
          ['codex', 0],
          ['missing', 0],
        ],
      )
      // Asked once a launch: the one that couldn't start isn't asked again.
      assert.isFalse((yield* models.catalog).some((agent) => agent.probing))
    }).pipe(Effect.provide(withAgents(['claude-code', 'codex', 'missing'], (agentId) => definition(agentId, ['codex'])))),
  )

  it.live('record the process asking starts, as any agent’s, ended once asked', () =>
    Effect.gen(function* () {
      const models = yield* Models
      const sql = yield* SqlClient.SqlClient
      yield* models.catalog
      const [asked] = yield* until(models.catalog, (all) => all.every((agent) => !agent.probing), Duration.seconds(20))
      assert.strictEqual(asked?.models.length, 2)
      const processes = yield* sql<{
        purpose: string
        state: string
        executable: string
        pid: number | null
        providerSessionId: string | null
      }>`
        SELECT purpose, state, executable, pid, provider_session_id FROM processes ORDER BY executable`
      assert.deepStrictEqual(
        processes.map((process) => [process.purpose, process.state, process.executable, process.pid !== null, process.providerSessionId]),
        [
          ['probe', 'unknown', 'althar-no-such-agent', false, null],
          ['probe', 'exited', 'bun', true, null],
        ],
      )
      // A default is for an agent Althar has.
      assert.instanceOf(yield* Effect.flip(models.setDefaultEffort({ agentId: 'cursor', model: 'm', effort: 'high' })), UnknownAgent)
    }).pipe(Effect.provide(withAgents(['process', 'missing'], (agentId) => definition(agentId)))),
  )

  it('read settings kept before they had names, by their values', () => {
    const read = modelsOf(definition('codex'), [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'large', values: ['small', 'large'] } as never,
      { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: true, values: [], choices: [] },
    ])
    assert.deepStrictEqual(read.models, [
      { id: 'small', name: 'small', description: null },
      { id: 'large', name: 'large', description: null },
    ])
    assert.deepStrictEqual([read.model, read.effort], ['large', null])
    // An agent that names no effort option has its thought level found by category.
    const unnamed = modelsOf({ ...definition('opencode'), options: { mode: 'mode', model: 'model' } }, [
      {
        id: 'level',
        name: 'Level',
        category: 'thought_level',
        type: 'select',
        currentValue: 'deep',
        values: ['deep'],
        choices: [{ value: 'deep', name: 'Deep' }],
      },
    ])
    assert.deepStrictEqual(unnamed.efforts, [{ id: 'deep', name: 'Deep' }])
  })
})

describe('how hard an agent thinks', () => {
  it.live('starts at the person’s default for the model, unless the plan or the person picks another', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const models = yield* Models
      const sql = yield* SqlClient.SqlClient
      yield* models.setDefaultEffort({ agentId: 'codex', model: 'large', effort: 'high' })
      yield* models.setDefaultEffort({ agentId: 'codex', model: 'large', effort: 'low' })
      yield* models.setDefaultEffort({ agentId: 'codex', model: 'small', effort: 'high' })
      const codex = (yield* models.catalog).find((agent) => agent.agentId === 'codex')
      assert.deepStrictEqual(codex?.defaults, [
        { model: 'large', effort: 'low' },
        { model: 'small', effort: 'high' },
      ])
      const effortOf = (threadId: string) =>
        Effect.map(
          sql<{ effort: string | null }>`SELECT effort FROM provider_sessions WHERE thread_id = ${threadId}`,
          (rows) => rows[0]?.effort,
        )
      // On the model it names, on the one the agent starts on, and with an effort of its own.
      const named = yield* thread
      yield* sessions.start({ threadId: named, agentId: 'codex', model: 'large' })
      const own = yield* thread
      yield* sessions.start({ threadId: own, agentId: 'codex' })
      const picked = yield* thread
      yield* sessions.start({ threadId: picked, agentId: 'codex', model: 'large', effort: 'medium' })
      assert.deepStrictEqual([yield* effortOf(named), yield* effortOf(own), yield* effortOf(picked)], ['low', 'high', 'medium'])
      // Another agent's models have defaults of their own.
      const other = yield* thread
      yield* sessions.start({ threadId: other, agentId: 'claude-code', model: 'large' })
      assert.strictEqual(yield* effortOf(other), 'medium')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is set as a session starts, changed in it, and says so', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'claude-code', effort: 'high' })
      const effort = () =>
        Effect.map(
          sql<{ effort: string | null }>`SELECT effort FROM provider_sessions WHERE thread_id = ${threadId}`,
          (rows) => rows[0]?.effort,
        )
      assert.strictEqual(yield* effort(), 'high')
      yield* sessions.setEffort({ threadId, effort: 'low' })
      assert.strictEqual(yield* effort(), 'low')
      const said = (yield* items(threadId))
        .filter((item) => item.kind === 'notice')
        .map((item) => (item.content as { title: string }).title)
      assert.include(said, 'Effort changed to low.')
      // One the agent doesn't offer leaves it as it was, and says why.
      assert.instanceOf(yield* Effect.flip(sessions.setEffort({ threadId, effort: 'ludicrous' })), EffortUnchanged)
      assert.strictEqual(yield* effort(), 'low')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('can’t be set for an agent that offers no choice of it', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'opencode', effort: 'high' })
      const refused = yield* Effect.flip(sessions.setEffort({ threadId, effort: 'high' }))
      assert.instanceOf(refused, EffortUnchanged)
      assert.strictEqual(refused.summary, 'It offers no choice of effort.')
    }).pipe(
      Effect.provide(
        withAgents(['opencode'], (agentId) => {
          const { effort: _, ...options } = definition(agentId).options
          return { ...definition(agentId), options }
        }),
      ),
    ),
  )

  it.live('stays at the agent’s own when the effort asked for isn’t offered', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'opencode', effort: 'ludicrous' })
      const [row] = yield* sql<{ effort: string | null }>`SELECT effort FROM provider_sessions WHERE thread_id = ${threadId}`
      assert.strictEqual(row?.effort, 'medium')
    }).pipe(Effect.provide(runtime())),
  )
})
