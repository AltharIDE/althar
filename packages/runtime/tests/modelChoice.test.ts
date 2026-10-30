import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { factFor, factsIn } from '../src/ModelFacts'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { setDefaultEffort, setModelBlocked } from '../src/preferences'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { whenWords } from '../src/Limits'
import { describeModels, type Route, routeTo } from '../src/usableModels'
import { callTool, repository, runtime, until } from './support'

/*
 * The coordinator picks models, not agents (ADR-015): what is known of each
 * model, from OpenRouter's public list, read from the profile's copy and
 * fetched again without anything waiting on it; the models it can use, each
 * once, however many agents offer it, with the efforts each takes; and a plan
 * that names models, and how hard each thinks, which Althar takes the best
 * way there is.
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

describe('the models as the coordinator reads them', () => {
  const route = (over: Partial<Route> = {}): Route => ({
    agentId: 'codex',
    agentName: 'Codex',
    model: 'gpt-x',
    plan: false,
    efforts: [],
    effort: null,
    defaultEffort: null,
    room: null,
    ...over,
  })

  it('says each one’s efforts as the tools take them, the one it starts at and the person’s default, as far as they are known', () => {
    const said = describeModels(
      [
        {
          name: 'GPT-X',
          maker: 'OpenAI',
          fact: { slug: 'openai/gpt-x', intelligence: null, coding: 70, agentic: null, price: { input: 1.25, output: 10 }, context: null },
          // What it starts at isn't known, and the person's default is one it doesn't offer.
          routes: [
            route({
              efforts: [
                { id: 'low', name: 'Low' },
                { id: 'xhigh', name: 'Extra high' },
              ],
              defaultEffort: 'max',
            }),
          ],
        },
        {
          name: 'Mystery',
          maker: null,
          fact: null,
          routes: [route({ model: 'mystery', plan: true, efforts: [{ id: 'high', name: 'High' }], effort: 'high', defaultEffort: 'high' })],
        },
        { name: 'Nobody', maker: null, fact: null, routes: [] },
      ],
      0,
    )
    assert.include(
      said,
      '\nOpenAI\n- GPT-X: intelligence unknown, coding 70, agentic unknown; per use, $1.25 in and $10.00 out per million tokens; effort low, xhigh\n',
    )
    assert.include(said, "\nOthers\n- Mystery: no scores known; on a plan; effort high (its own: high; the person's default: high)\n")
    assert.match(said, /\n- Nobody: no scores known; per use; no effort to set$/)
  })

  it('says how much of its plan’s tightest limit each has left, and when it resets, as last read', () => {
    const now = Date.parse('2026-10-03T12:00:00')
    const resetsAt = new Date(now + 2 * 60 * 60 * 1000).toISOString()
    const room = (leftPercent: number) =>
      ({ agentId: 'codex', accountId: 'a', leftPercent, resetsAt, kind: 'five_hour', label: null }) as const
    const said = describeModels(
      [
        { name: 'Roomy', maker: null, fact: null, routes: [route({ model: 'roomy', plan: true, room: room(62.4) })] },
        { name: 'Tight', maker: null, fact: null, routes: [route({ model: 'tight', plan: true, room: room(3) })] },
      ],
      now,
    )
    assert.include(said, 'A step on a plan with under 5% left goes elsewhere or waits')
    assert.include(
      said,
      `- Roomy: no scores known; on a plan, 62% of its five-hour limit left, until ${whenWords(resetsAt, now)}; no effort to set`,
    )
    assert.include(
      said,
      `- Tight: no scores known; on a plan, nearly out, 3% of its five-hour limit left, until ${whenWords(resetsAt, now)}; no effort to set`,
    )
  })

  it('takes a model the way the agent named goes, else the best way, and nothing where it has none', () => {
    const usable = [
      {
        name: 'Large',
        maker: null,
        fact: null,
        routes: [route({ agentId: 'claude-code', model: 'large', plan: true }), route({ model: 'large' })],
      },
      { name: 'Gone', maker: null, fact: null, routes: [] },
    ]
    assert.strictEqual(routeTo(usable, ' LARGE ')?.agentId, 'claude-code')
    assert.strictEqual(routeTo(usable, 'large', 'codex')?.agentId, 'codex')
    assert.strictEqual(routeTo(usable, 'Large', 'opencode')?.agentId, 'claude-code')
    assert.isNull(routeTo(usable, 'gone'))
    assert.isNull(routeTo(usable, 'small'))
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

  it.live('says the efforts each model takes the way it goes, the one it starts at, and the person’s default where they set one', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* known
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const said = yield* callTool(access, 'list_models', {})
      assert.include(
        said,
        "an effort it lists. Without an effort, a step starts at the person's default for its model, or else at the model's own.",
      )
      // Claude Code's: each model's levels, and the one it starts at.
      assert.include(said, '- Claude Large: no scores known; on a plan; effort low, medium, high (its own: medium)\n')
      // Codex's, as OpenCode offers them: a model's own levels, and none at all for the small one.
      assert.include(said, '- Huge: no scores known; on a plan; effort high, max, default (its own: high)\n')
      assert.match(said, /- Small: no scores known; on a plan; no effort to set(\n|$)/)
      // The person's default, where it is one the model offers.
      yield* setDefaultEffort('claude-code', 'large', 'high')
      yield* setDefaultEffort('claude-code', 'small', 'max')
      const now = yield* callTool(access, 'list_models', {})
      assert.include(
        now,
        "- Claude Large: no scores known; on a plan; effort low, medium, high (its own: medium; the person's default: high)\n",
      )
      assert.include(now, '- Claude Small: no scores known; on a plan; effort low, medium, high (its own: medium)\n')
    }).pipe(Effect.provide(runtime(':memory:', {}, { signedOut: ['opencode'], each: { codex: { variants: true } } }))),
  )

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

/** The steps of a task's plan, as kept. */
const stepsOf = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      parameters: string
    }>`SELECT p.parameters FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE k.slug = ${slug}`
    return (
      JSON.parse(rows[0]?.parameters ?? '{}') as {
        steps: Array<{ key: string; agentId: string; model: string | null; effort?: string | null; skipped: boolean }>
      }
    ).steps
  })

/** The task cards in the project's coordinator thread, as the window reads them. */
const cardsOf = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/** A task's latest card, by its slug. */
const cardOf = (projectId: string, slug: string) => Effect.map(cardsOf(projectId), (cards) => cards.findLast((card) => card.slug === slug))

describe('a plan that names models', () => {
  it.live('takes each model the best way there is, refuses one that can’t be used, and still takes an agent', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* known
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
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
      // Named by agent alone, on its own default model, whose efforts aren't known: an effort is refused, and none plans as before.
      yield* callTool(access, 'draft_task', { title: 'Tidy last' })
      assert.strictEqual(
        yield* callTool(access, 'propose_plan', { task: 'tidy-last', lead: { agent: 'codex', effort: 'high' } }),
        "Fake codex's default model has no effort to set. Leave effort out.",
      )
      // Named by agent and an id the agent doesn't offer: none known there either.
      assert.strictEqual(
        yield* callTool(access, 'propose_plan', { task: 'tidy-last', lead: { agent: 'codex', model: 'mystery-9', effort: 'high' } }),
        'mystery-9 has no effort to set. Leave effort out.',
      )
      assert.match(yield* callTool(access, 'propose_plan', { task: 'tidy-last', lead: { agent: 'codex', model: 'mystery-9' } }), /^Planned/)
    }).pipe(Effect.provide(runtime(':memory:', {}, { perUse: ['codex'] }))),
  )

  it.live(
    'takes an effort the model offers the way it goes, shows it on the card, keeps it through the person’s changes, and starts the lead at it',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const plans = yield* Plans
        const instance = yield* Instance
        const { projectId, threadId } = yield* opened
        yield* known
        const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
        yield* callTool(access, 'draft_task', { title: 'Rework the cache' })
        // One the model doesn't offer is refused, with the ones it does, and nothing is planned.
        assert.strictEqual(
          yield* callTool(access, 'propose_plan', { task: 'rework-the-cache', lead: { model: 'large', effort: 'extreme' } }),
          'large has no effort extreme. Name one of its efforts, as list_models writes them: low, medium, high; or leave effort out.',
        )
        // Codex's small model, as OpenCode offers it, has none to set.
        assert.strictEqual(
          yield* callTool(access, 'propose_plan', {
            task: 'rework-the-cache',
            lead: { model: 'large' },
            review: { model: 'Small', agent: 'codex', effort: 'low' },
          }),
          'Small has no effort to set. Leave effort out.',
        )
        assert.isEmpty(yield* sql`SELECT id FROM task_plans`)
        // One it offers, by its id or by its name, is kept as its id.
        assert.match(
          yield* callTool(access, 'propose_plan', {
            task: 'rework-the-cache',
            lead: { model: 'large', effort: 'high', reason: 'Open-ended.' },
            review: { model: 'Huge', effort: 'Max' },
          }),
          /^Planned rework-the-cache\./,
        )
        assert.deepStrictEqual(
          (yield* stepsOf('rework-the-cache')).map((step) => [step.key, step.agentId, step.model, step.effort]),
          [
            ['implement', 'claude-code', 'large', 'high'],
            ['review', 'codex', 'huge', 'max'],
          ],
        )
        // Its card shows each step's effort, as one the person chose; skipping the review there keeps them.
        const [card] = yield* cardsOf(projectId)
        assert.deepStrictEqual(card?.plan?.steps, [
          { key: 'implement', agentId: 'claude-code', model: 'large', effort: 'high', skipped: false },
          { key: 'review', agentId: 'codex', model: 'huge', effort: 'max', skipped: false },
        ])
        // Its lead's, beside its model, the plan's until a lead has started.
        assert.deepStrictEqual([card?.lead, card?.leadModel, card?.leadEffort], ['claude-code', 'large', 'high'])
        const planId = card?.plan?.id ?? ''
        yield* plans.change(
          planId,
          (card?.plan?.steps ?? []).map((step) => ({ ...step, skipped: step.key === 'review' })),
          instance.personId,
        )
        assert.deepStrictEqual(
          (yield* stepsOf('rework-the-cache')).map((step) => [step.key, step.effort, step.skipped]),
          [
            ['implement', 'high', false],
            ['review', 'max', true],
          ],
        )
        // Started, its lead is at that effort.
        yield* plans.start(planId, instance.personId)
        const [lead] = yield* until(
          sql<{ effort: string | null }>`
          SELECT s.effort FROM provider_sessions s JOIN threads t ON t.id = s.thread_id JOIN tasks k ON k.id = t.task_id
          WHERE k.slug = 'rework-the-cache' AND t.kind = 'task' AND s.state <> 'starting'`,
          (rows) => rows.length === 1,
        )
        assert.strictEqual(lead?.effort, 'high')
        // Running, its card says what its lead is on.
        assert.strictEqual((yield* cardOf(projectId, 'rework-the-cache'))?.leadEffort, 'high')

        // Left out, the step names none: it starts at the person's default for the model, or the model's own, as before.
        yield* callTool(access, 'draft_task', { title: 'Fix a typo' })
        assert.match(
          yield* callTool(access, 'propose_plan', { task: 'fix-a-typo', lead: { model: 'Claude Small' }, review: null }),
          /^Planned/,
        )
        assert.deepStrictEqual(
          (yield* stepsOf('fix-a-typo')).map((step) => [step.key, step.model, step.effort]),
          [['implement', 'small', undefined]],
        )
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(':memory:', {}, { signedOut: ['opencode'], each: { codex: { variants: true } }, countdown: Duration.minutes(5) }),
            ),
          ),
        ),
      ),
  )

  it.live(
    'starts a mini task’s lead at the effort named, refuses one its model doesn’t offer, and without one starts it at the person’s default',
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { projectId, threadId } = yield* opened
        yield* known
        const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
        const leadOf = (slug: string) =>
          until(
            sql<{ model: string | null; effort: string | null }>`
            SELECT s.model, s.effort FROM provider_sessions s JOIN threads t ON t.id = s.thread_id JOIN tasks k ON k.id = t.task_id
            WHERE k.slug = ${slug} AND t.kind = 'task' AND s.state <> 'starting'`,
            (rows) => rows.length === 1,
          )
        // One its model doesn't offer drafts nothing.
        assert.strictEqual(
          yield* callTool(access, 'start_task', { title: 'Try the cache', lead: { model: 'Claude Large', effort: 'max' } }),
          'Claude Large has no effort max. Name one of its efforts, as list_models writes them: low, medium, high; or leave effort out.',
        )
        assert.isEmpty(yield* sql`SELECT id FROM tasks`)
        // Named, it starts there.
        assert.match(
          yield* callTool(access, 'start_task', { title: 'Try the cache', lead: { model: 'Claude Large', effort: 'high' } }),
          /^Started try-the-cache/,
        )
        assert.deepStrictEqual(
          (yield* leadOf('try-the-cache')).map((lead) => [lead.model, lead.effort]),
          [['large', 'high']],
        )
        // With no plan to show it, its card says it.
        const tried = yield* cardOf(projectId, 'try-the-cache')
        assert.deepStrictEqual([tried?.leadModel, tried?.leadEffort], ['large', 'high'])
        // Left out, it starts at the person's default for the model, as before.
        yield* setDefaultEffort('claude-code', 'small', 'low')
        assert.match(
          yield* callTool(access, 'start_task', { title: 'Try the queue', lead: { model: 'Claude Small' } }),
          /^Started try-the-queue/,
        )
        assert.deepStrictEqual(
          (yield* leadOf('try-the-queue')).map((lead) => [lead.model, lead.effort]),
          [['small', 'low']],
        )
        assert.strictEqual((yield* cardOf(projectId, 'try-the-queue'))?.leadEffort, 'low')
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { signedOut: ['opencode'] }))))),
  )
})
