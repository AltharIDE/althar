import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { holds, type FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from '../src/Config'
import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { atReset, fakeAgents, items, later, onTestClock, repository, runtime, turns, until } from './support'

const claude = { id: 'claude-strong', name: 'Claude Strong' }
const weak = { id: 'gpt-weak', name: 'GPT Weak' }
const sol = { id: 'gpt-strong', name: 'GPT Strong' }
const third = { id: 'opencode-go/deepseek-strong', name: 'OpenCode Go/DeepSeek Strong' }
const sameMaker = { id: 'opencode-go/claude-strong', name: 'OpenCode Go/Claude Strong' }

// The same cached Artificial Analysis scores list_models reads. The strongest
// route on OpenCode is deliberately the same maker as the lead.
const cache = join(mkdtempSync(join(tmpdir(), 'althar-takeover-')), 'models.json')
writeFileSync(
  cache,
  JSON.stringify({
    data: [
      ['anthropic/claude-strong', 99],
      ['openai/gpt-weak', 20],
      ['openai/gpt-strong', 95],
      ['deepseek/deepseek-strong', 90],
    ].map(([id, score]) => ({
      id,
      benchmarks: { artificial_analysis: { intelligence_index: score, coding_index: score, agentic_index: score } },
    })),
  }),
)

const withAgents = (each: Readonly<Record<string, FakeAgentOptions>> = {}, perUse: ReadonlyArray<string> = [], providerPlans = false) => {
  const options = {
    'claude-code': { models: [claude], ...each['claude-code'] },
    codex: { models: [weak, sol], ...each.codex },
    opencode: { models: [sameMaker, third], ...each.opencode },
  }
  const agents = Layer.effect(
    Agents,
    Effect.gen(function* () {
      const all = yield* Agents
      const list = all.list.map((entry) =>
        entry.definition.id !== 'opencode'
          ? entry
          : {
              ...entry,
              definition: {
                ...entry.definition,
                signIn: {
                  ...entry.definition.signIn,
                  providers: {
                    read: () => [
                      { id: 'opencode-go', name: 'OpenCode Go', connections: 'subscription' },
                      { id: 'opencode-zen', name: 'OpenCode Zen', connections: 'key' },
                    ],
                    of: (model: string) => model.split('/')[0],
                    plans: ['opencode-go'],
                  },
                },
              },
            },
      )
      return Agents.of({ list, get: (id) => Effect.succeed(list.find((entry) => entry.definition.id === id)!) })
    }),
  ).pipe(Layer.provide(fakeAgents({}, [], options, perUse)))
  return Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        {
          modelFacts: {
            url: 'https://models.test',
            cache,
            fetch: async () => {
              throw new Error('Use the cached scores')
            },
          },
          perUse,
          each: options,
          ...(providerPlans ? { agents } : {}),
        },
      ),
    ),
  )
}

const startTask = (title = 'Continue the work [lead:finish]', reviewer?: string) =>
  Effect.gen(function* () {
    const models = yield* Models
    yield* until(models.catalog, (catalog) => catalog.every((agent) => !agent.probing))
    const projects = yield* Projects
    const instance = yield* Instance
    const plans = yield* Plans
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const id = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      actorId: instance.personId,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: claude.id, skipped: false },
        ...(reviewer === undefined
          ? []
          : [{ key: 'review' as const, agentId: reviewer, model: reviewer === 'codex' ? sol.id : third.id, skipped: false }]),
      ],
      reason: null,
      startsIn: Duration.minutes(5),
      end: null,
    })
    return { ...task, projectId: project.projectId, start: plans.start(id, instance.personId) }
  })

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* queries.coordinator(projectId)
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })
const ready = (projectId: string) => until(cards(projectId), (all) => all.some((card) => card.phase === 'ready'))
const agentsOn = (threadId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ agentId: string; model: string | null }>`
  SELECT agent_id, model FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`,
  )
const noCall = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const calls = yield* sql`SELECT id FROM attention_requests WHERE state = 'open'`
  assert.lengthOf(calls, 0)
})

describe('automatic usage takeover by model', () => {
  it.live('continues a turn on another maker’s strongest plan model with its brief, commits and unfinished work', () => {
    const back = Date.now() + 3_600_000
    return Effect.gen(function* () {
      const task = yield* startTask()
      yield* task.start
      yield* ready(task.projectId)
      assert.deepStrictEqual(yield* agentsOn(task.threadId), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'codex', model: sol.id },
      ])
      const prompts = yield* turns(task.threadId)
      const taken = prompts.find((turn) => turn.prompt?.includes('You are taking over a task'))?.prompt ?? ''
      assert.include(taken, 'Task: Continue the work')
      assert.include(taken, 'Commits so far:')
      assert.include(taken, 'Finish the first half')
      assert.include(taken, 'The first half is committed; the second half and its tests remain.')
      assert.include(taken, 'Carry on with the task from where it stands')
      const notices = (yield* items(task.threadId)).filter((item) => item.kind === 'notice' && item.content.about === 'limit')
      assert.lengthOf(notices, 1)
      assert.include(notices[0]?.content.title, 'Fake codex takes the work over, on GPT Strong.')
      yield* noCall
    }).pipe(
      Effect.provide(
        withAgents({
          'claude-code': {
            outOfUsage: {
              until: back,
              message: 'The first half is committed; the second half and its tests remain.',
              beforeLimit: async (cwd) => {
                writeFileSync(join(cwd, 'half.txt'), 'First half\n')
                execFileSync('git', ['add', 'half.txt'], { cwd })
                execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@test', 'commit', '-m', 'Finish the first half'], {
                  cwd,
                })
              },
            },
          },
        }),
      ),
    )
  })

  it.live('reviews with a third maker even when its agent also offers a stronger model from the lead’s maker', () => {
    const back = Date.now() + 3_600_000
    return Effect.gen(function* () {
      const task = yield* startTask('Review independently [lead:finish] [review:pass]', 'codex')
      yield* task.start
      yield* ready(task.projectId)
      const sql = yield* SqlClient.SqlClient
      const review = yield* sql<{
        agentId: string
        model: string
      }>`SELECT s.agent_id, s.model FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.task_id = ${task.taskId} AND t.kind = 'step'`
      assert.deepStrictEqual(review, [
        { agentId: 'codex', model: sol.id },
        { agentId: 'opencode', model: third.id },
      ])
      const notices = (yield* items(task.threadId)).filter((item) => item.kind === 'notice' && item.content.about === 'limit')
      assert.lengthOf(notices, 1)
      assert.include(notices[0]?.content.title, 'on DeepSeek Strong.')
      assert.notInclude(notices[0]?.content.title, 'opencode-go')
      assert.notInclude(notices[0]?.content.title, 'reviews its own work')
      yield* noCall
    }).pipe(Effect.provide(withAgents({ codex: { outOfUsage: { until: back, message: 'I checked the first file; the rest remains.' } } })))
  })

  it.effect('keeps the replacement through the reset, then returns the next lead step to the planned model', () => {
    const back = later()
    const held = holds()
    return Effect.gen(function* () {
      const task = yield* startTask('Continue [lead:slowly] [lead:finish] [review:findings]', 'opencode')
      yield* task.start
      const sessions = yield* Sessions
      yield* until(sessions.running(task.threadId), (live) => Option.isSome(live) && live.value.agentId === 'codex')
      yield* until(turns(task.threadId), (all) =>
        all.some((turn) => turn.prompt?.includes('You are taking over a task') && turn.state === 'delivered'),
      )
      yield* atReset(back)
      yield* Effect.sleep('100 millis')
      assert.strictEqual(Option.getOrThrow(yield* sessions.running(task.threadId)).agentId, 'codex')
      assert.lengthOf(yield* agentsOn(task.threadId), 2)
      held.open('[lead:slowly]')
      yield* ready(task.projectId)
      assert.deepStrictEqual(yield* agentsOn(task.threadId), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'codex', model: sol.id },
        { agentId: 'claude-code', model: claude.id },
      ])
      yield* noCall
    }).pipe(
      Effect.provide(withAgents({ 'claude-code': { outOfUsage: { until: back }, holds: held }, codex: { holds: held } })),
      onTestClock,
    )
  })

  it.live('ranks strength before recent choices, respects blocked models, and never picks a key', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const models = yield* Models
      assert.strictEqual(
        (yield* limits.free({ besides: ['claude-code'], projectId: task.projectId, planned: { agentId: 'claude-code', model: claude.id } }))
          ?.model,
        sol.id,
      )
      assert.strictEqual(yield* limits.modelFor({ agentId: 'codex', projectId: task.projectId }), sol.id)
      yield* models.setModelBlocked({ agentId: 'codex', model: sol.id, blocked: true })
      assert.strictEqual(
        (yield* limits.free({ besides: ['claude-code'], projectId: task.projectId, planned: { agentId: 'claude-code', model: claude.id } }))
          ?.model,
        weak.id,
      )
      const accounts = yield* Accounts
      const account = (yield* accounts.of('codex'))[0]
      assert.strictEqual((yield* limits.free({ besides: ['claude-code'], projectId: task.projectId }))?.accountId, account?.id)
    }).pipe(Effect.provide(withAgents({}, ['opencode']))),
  )
  it.live('uses a subscribed provider on a key-paid agent, never its stronger per-use route', () => {
    const back = Date.now() + 3_600_000
    return Effect.gen(function* () {
      const task = yield* startTask()
      yield* task.start
      yield* ready(task.projectId)
      assert.deepStrictEqual(yield* agentsOn(task.threadId), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'opencode', model: third.id },
      ])
      yield* noCall
    }).pipe(
      Effect.provide(
        withAgents(
          {
            'claude-code': { outOfUsage: { until: back } },
            opencode: { models: [third, { id: 'opencode-zen/gpt-strong', name: 'OpenCode Zen/GPT Strong' }] },
          },
          ['codex', 'opencode'],
          true,
        ),
      ),
    )
  })

  it.live('checks each model’s own window, then uses preferences to break equal scores', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const accounts = yield* Accounts
      const sql = yield* SqlClient.SqlClient
      const [account] = yield* accounts.of('codex')
      yield* sql`INSERT INTO plan_usage_readings ${sql.insert({
        accountId: account!.id,
        agentId: 'codex',
        source: 'agent',
        windows: JSON.stringify([
          { kind: 'weekly', model: sol.id, usedPercent: 99, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
        ]),
        observedAt: new Date().toISOString(),
      })}`
      assert.strictEqual(
        (yield* limits.free({
          besides: ['claude-code'],
          projectId: task.projectId,
          withRoom: true,
          planned: { agentId: 'claude-code', model: claude.id },
        }))?.model,
        third.id,
      )
      const models = yield* Models
      yield* models.setModelBlocked({ agentId: 'codex', model: weak.id, blocked: true })
      yield* models.setModelBlocked({ agentId: 'opencode', model: sameMaker.id, blocked: true })
      yield* models.setModelBlocked({ agentId: 'opencode', model: third.id, blocked: true })
      assert.isUndefined(yield* limits.free({ besides: ['claude-code'], projectId: task.projectId, withRoom: true }))
      yield* sql`UPDATE plan_usage_readings SET windows = ${JSON.stringify([{ kind: 'weekly', model: sol.id, usedPercent: 100, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }])} WHERE account_id = ${account!.id}`
      assert.isUndefined(yield* limits.free({ besides: ['claude-code'], projectId: task.projectId }))
      // Without scores, the last model the person used breaks the tie.
      const sessions = yield* Sessions
      const projects = yield* Projects
      const earlier = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: task.projectId,
        title: 'Preference',
      })
      yield* sessions.start({ threadId: earlier.threadId, agentId: 'claude-code', model: 'unknown-preferred' })
      yield* sessions.stop(earlier.threadId)
      assert.strictEqual(yield* limits.modelFor({ agentId: 'claude-code', projectId: task.projectId }), 'unknown-preferred')
    }).pipe(
      Effect.provide(
        withAgents({
          'claude-code': {
            models: [
              { id: 'unknown-first', name: 'First' },
              { id: 'unknown-preferred', name: 'Preferred' },
            ],
          },
        }),
      ),
    ),
  )
})
