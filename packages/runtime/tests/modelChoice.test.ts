import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { factFor, factsIn } from '../src/ModelFacts'
import { Models } from '../src/Models'
import { setModelBlocked } from '../src/preferences'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * The coordinator picks models, not agents (ADR-015): what is known of each
 * model, from OpenRouter's public list, read from the profile's copy and
 * fetched again without anything waiting on it; the models it can use, each
 * once, however many agents offer it; and a plan that names models, which
 * Althar takes the best way there is.
 */

/** OpenRouter's list, as it gives it: a model with Artificial Analysis's scores, its batch variant, and a reseller's copy without. */
const LIST = {
  data: [
    {
      id: 'anthropic/claude-sonnet-5.5',
      context_length: 1_000_000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      benchmarks: { artificial_analysis: { intelligence_index: 56, coding_index: null, agentic_index: null } },
    },
    { id: 'anthropic/claude-sonnet-5.5:batch', pricing: { prompt: '0.0000015', completion: '0.0000075' } },
    {
      id: 'openai/gpt-6-astra',
      context_length: 400_000,
      pricing: { prompt: '0', completion: '0' },
      benchmarks: { artificial_analysis: { intelligence_index: 52.7, coding_index: 76.9, agentic_index: 51 } },
    },
    { id: 'reseller/gpt-6-astra', pricing: { prompt: '0.00001', completion: '0.00003' } },
    { id: 'z-ai/glm-5.3', benchmarks: { artificial_analysis: { intelligence_index: 44.8, coding_index: 74.8, agentic_index: 53.1 } } },
    {
      id: 'fake/large',
      pricing: { prompt: '0.000002', completion: '0.000008' },
      benchmarks: { artificial_analysis: { intelligence_index: 60, coding_index: 70, agentic_index: 50 } },
    },
    { id: 7 },
  ],
}

describe('what is known of models', () => {
  it('reads the list: plain models only, scores and price where given, the maker’s listing over a reseller’s', () => {
    const facts = factsIn(LIST)
    assert.deepStrictEqual(facts.get('claude-sonnet-5.5'), {
      slug: 'anthropic/claude-sonnet-5.5',
      intelligence: 56,
      coding: null,
      agentic: null,
      price: { input: 3, output: 15 },
      context: 1_000_000,
    })
    assert.strictEqual(facts.get('gpt-6-astra')?.slug, 'openai/gpt-6-astra')
    assert.isNull(facts.get('gpt-6-astra')?.price)
    assert.isFalse([...facts.keys()].some((key) => key.includes(':')))
    assert.strictEqual(factsIn({ data: 'nothing' }).size, 0)
    assert.strictEqual(factsIn(null).size, 0)
  })

  it('finds each agent’s model in it: by its id, or by its name as people know it', () => {
    const facts = factsIn(LIST)
    const claude = { id: 'claude-code', name: 'Claude Code' }
    assert.strictEqual(factFor(facts, claude, { id: 'sonnet', name: 'Sonnet 5.5' })?.slug, 'anthropic/claude-sonnet-5.5')
    assert.strictEqual(factFor(facts, { id: 'codex', name: 'Codex' }, { id: 'gpt-6-astra', name: '6 Astra' })?.slug, 'openai/gpt-6-astra')
    assert.strictEqual(
      factFor(facts, { id: 'opencode', name: 'OpenCode' }, { id: 'opencode-go/glm-5.3', name: 'OpenCode Go/GLM-5.3 (New)' })?.slug,
      'z-ai/glm-5.3',
    )
    assert.isNull(factFor(facts, claude, { id: 'haiku', name: 'Haiku 4.5' }))
    // A free copy scores as the model does.
    assert.strictEqual(
      factFor(facts, { id: 'opencode', name: 'OpenCode' }, { id: 'opencode/glm-5.3-free', name: 'GLM-5.3 Free' })?.slug,
      'z-ai/glm-5.3',
    )
  })
})

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId, threadId: yield* coordinator.thread(project.projectId) }
})

/** Every agent asked what it offers, so the models are known. */
const known = Effect.gen(function* () {
  const models = yield* Models
  yield* models.catalog
  yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
})

/** A list that answers as OpenRouter does, counting how often it was asked. */
const listing = (answer: () => Promise<Response>) => {
  const asked: string[] = []
  return {
    asked,
    fetch: (url: string | URL | Request) => {
      asked.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
      return answer()
    },
  }
}

describe('the models the coordinator can use', () => {
  it.live('lists each model once, by maker, with its scores and how it is paid for, and leaves out what can’t be used', () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'althar-facts-')), 'profile', 'model-facts.json')
    const list = listing(async () => new Response(JSON.stringify(LIST)))
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* known
      const models = yield* Models
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      yield* until(
        Effect.sync(() => (existsSync(cache) ? [readFileSync(cache, 'utf8')] : [])),
        (copies) => copies.length > 0,
      )
      assert.deepStrictEqual(list.asked, ['https://openrouter.test/models'])
      // Large is known to the list, as Fake's, and listed once for every agent that offers it; Small isn't known.
      // OpenCode is signed out; Codex is paid per use. Claude Code's models take back their family.
      const said = yield* callTool(access, 'list_models', {})
      assert.include(said, 'Fake\n- Claude Large: intelligence 60, coding 70, agentic 50; on a plan')
      assert.strictEqual(said.match(/Large/g)?.length, 1)
      assert.include(said, 'Anthropic\n- Claude Small: no scores known; on a plan')
      assert.include(said, 'OpenAI\n- Small: no scores known; per use')
      // Switched off, it is gone.
      yield* models.setModelBlocked({ agentId: 'claude-code', model: 'small', blocked: true })
      yield* models.setModelBlocked({ agentId: 'codex', model: 'small', blocked: true })
      assert.notInclude(yield* callTool(access, 'list_models', {}), 'Small')
      assert.include(yield* callTool(access, 'list_models', {}), 'Large')
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          { signedOut: ['opencode'], perUse: ['codex'], modelFacts: { url: 'https://openrouter.test/models', cache, fetch: list.fetch } },
        ),
      ),
    )
  })

  it.live('keeps going on the profile’s copy when the list can’t be read, and says nothing of it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-facts-'))
    const cache = join(folder, 'model-facts.json')
    writeFileSync(cache, JSON.stringify(LIST))
    const list = listing(async () => new Response('down', { status: 503 }))
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* known
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(yield* callTool(access, 'list_models', {}), '- Claude Large: intelligence 60')
      yield* until(
        Effect.sync(() => list.asked),
        (asked) => asked.length > 0,
      )
      assert.strictEqual(readFileSync(cache, 'utf8'), JSON.stringify(LIST))
    }).pipe(Effect.provide(runtime(':memory:', {}, { modelFacts: { url: 'https://openrouter.test/models', cache, fetch: list.fetch } })))
  })

  it.live('says when no model can be used', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* known
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(yield* callTool(access, 'list_models', {}), /^No model can be used now/)
    }).pipe(Effect.provide(runtime(':memory:', {}, { signedOut: ['claude-code', 'codex', 'opencode'] }))),
  )

  it.live('asks an agent again once it is installed, and drops what an asking from before found', () =>
    Effect.gen(function* () {
      yield* opened
      yield* known
      const models = yield* Models
      const agentId = (yield* models.catalog)[0]?.agentId ?? ''
      // Asked again at once; what the first asking found doesn't stand in for it.
      yield* models.forget(agentId)
      assert.isTrue((yield* models.catalog).find((agent) => agent.agentId === agentId)?.probing)
      // Forgotten again while being asked: that asking's answer counts for nothing, and the next is waited for.
      yield* models.forget(agentId)
      assert.isTrue((yield* models.catalog).find((agent) => agent.agentId === agentId)?.probing)
      yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
    }).pipe(Effect.provide(runtime(':memory:', {}))),
  )
})

describe('a plan that names models', () => {
  it.live('takes each model the best way there is, refuses one that can’t be used, and still takes an agent', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId } = yield* opened
      yield* known
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const stepsOf = (slug: string) =>
        Effect.map(
          sql<{ parameters: string }>`SELECT p.parameters FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = ${slug}`,
          (rows) =>
            (JSON.parse(rows[0]?.parameters ?? '{}') as { steps: Array<{ key: string; agentId: string; model: string | null }> }).steps,
        )
      yield* callTool(access, 'draft_task', { title: 'Add a retry' })
      // Large, offered by every agent: on a plan before a key, so Claude Code's or OpenCode's, not Codex's.
      assert.match(
        yield* callTool(access, 'propose_plan', {
          task: 'add-a-retry',
          lead: { model: 'large' },
          review: { model: 'Small', agent: 'opencode' },
        }),
        /^Planned add-a-retry\./,
      )
      assert.deepStrictEqual(
        (yield* stepsOf('add-a-retry')).map((step) => [step.key, step.agentId, step.model]),
        [
          ['implement', 'claude-code', 'large'],
          ['review', 'opencode', 'small'],
        ],
      )
      yield* callTool(access, 'draft_task', { title: 'Bump the version' })
      assert.match(
        yield* callTool(access, 'propose_plan', { task: 'bump-the-version', lead: { model: 'GPT-9' } }),
        /^No model called GPT-9 can be used now\./,
      )
      assert.match(yield* callTool(access, 'propose_plan', { task: 'bump-the-version', lead: {} }), /Name the model/)
      // As plans once did: an agent, on its own default.
      assert.match(yield* callTool(access, 'propose_plan', { task: 'bump-the-version', lead: { agent: 'codex' } }), /^Planned/)
      assert.deepStrictEqual(
        (yield* stepsOf('bump-the-version')).map((step) => [step.agentId, step.model]),
        [['codex', null]],
      )
      // Named by agent, a model the person switched off there is still off: the same model another way, or none.
      yield* setModelBlocked('codex', 'small', true)
      yield* callTool(access, 'draft_task', { title: 'Tidy up' })
      assert.match(yield* callTool(access, 'propose_plan', { task: 'tidy-up', lead: { agent: 'codex', model: 'small' } }), /^Planned/)
      assert.notDeepEqual(
        (yield* stepsOf('tidy-up')).map((step) => [step.agentId, step.model]),
        [['codex', 'small']],
      )
      for (const agentId of ['claude-code', 'opencode']) yield* setModelBlocked(agentId, 'small', true)
      yield* callTool(access, 'draft_task', { title: 'Tidy more' })
      assert.match(
        yield* callTool(access, 'propose_plan', { task: 'tidy-more', lead: { agent: 'codex', model: 'small' } }),
        /^The person switched small off\./,
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { perUse: ['codex'] }))),
  )
})
