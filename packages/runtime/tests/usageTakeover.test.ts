import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import { holds, type FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from '../src/Automations'
import { Agents } from '../src/Config'
import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits, type ModelChoice } from '../src/Limits'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { atReset, fakeAgents, items, later, onTestClock, repository, runtime, turns, until } from './support'

const claude = { id: 'claude-strong', name: 'Claude Strong' }
const weak = { id: 'gpt-weak', name: 'GPT Weak' }
const sol = { id: 'gpt-strong', name: 'GPT Strong' }
const third = { id: 'opencode-go/deepseek-strong', name: 'OpenCode Go/DeepSeek Strong' }
const unscored = { id: 'unknown', name: 'New Model' }
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

const withAgents = (
  each: Readonly<Record<string, FakeAgentOptions>> = {},
  perUse: ReadonlyArray<string> = [],
  providerPlans = false,
  /** OpenCode Go refused its sign-in, and the agents named are signed out. */
  trouble: { readonly goRefused?: boolean; readonly signedOut?: ReadonlyArray<string> } = {},
) => {
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
                      {
                        id: 'opencode-go',
                        name: 'OpenCode Go',
                        connections: 'subscription',
                        ...(trouble.goRefused === true ? { needsSignIn: true as const } : {}),
                      },
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
  ).pipe(Layer.provide(fakeAgents({}, trouble.signedOut ?? [], options, perUse)))
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
          ...(trouble.signedOut === undefined ? {} : { signedOut: trouble.signedOut }),
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
  const calls =
    yield* sql`SELECT id FROM attention_requests WHERE state = 'open' OR (kind = 'stuck' AND json_extract(payload, '$.why') = 'usage_limit')`
  assert.lengthOf(calls, 0)
})

const automationFor = (projectId: string, lead: ModelChoice, review: ModelChoice | null = null) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    return yield* (yield* Automations).make({
      projectId: projectId as ProjectId,
      actorId: instance.personId,
      definition: {
        name: 'Subscription run',
        prompt: 'Finish this run [lead:finish] [review:pass]',
        schedule: { every: 'week', days: [1], at: '09:00' },
        zone: 'Europe/London',
        lead,
        work: { kind: 'task', review, end: null },
        allowEverything: true,
        minutes: 45,
        late: 'once',
      },
    })
  })
const automationRuns = (automationId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) =>
      sql<{ threadId: string; taskId: string; state: string }>`SELECT h.id AS thread_id, o.task_id, o.state FROM automation_occurrences o
    JOIN threads h ON h.task_id = o.task_id AND h.kind = 'task' WHERE o.automation_id = ${automationId}`,
  )

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

  it.live('moves work planned for an agent out of usage only where the project’s rule is move; under wait it is left to the run', () =>
    Effect.gen(function* () {
      // No task runs: only where work planned for the agent stands.
      const models = yield* Models
      yield* until(models.catalog, (catalog) => catalog.every((agent) => !agent.probing))
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const projectId = project.projectId as ProjectId
      const limits = yield* Limits
      const policies = yield* Policies
      const instance = yield* Instance
      // Claude Code said it ran out of usage a moment ago, until an hour on.
      const [account] = yield* (yield* Accounts).of('claude-code')
      const sql = yield* SqlClient.SqlClient
      const principalId = yield* newId(Ids.principal)
      const at = new Date().toISOString()
      yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId: 'claude-code', accountId: account!.id, deviceId: instance.deviceId, subjectHint: 'Fake sign-in', authMode: 'vendor_cli', observedAt: at })}`
      yield* sql`INSERT INTO account_statuses ${sql.insert({
        id: yield* newId(Ids.accountStatus),
        principalId,
        state: 'limited',
        windows: JSON.stringify([{ kind: 'usage', resetsAt: new Date(Date.now() + 3_600_000).toISOString() }]),
        source: 'error',
        observedAt: at,
      })}`
      const planned = { agentId: 'claude-code', model: null, projectId }
      const moving = yield* limits.standing(planned)
      assert.strictEqual(moving.kind, 'instead')
      assert.strictEqual(moving.kind === 'instead' ? moving.because.why : undefined, 'out')
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      assert.deepStrictEqual(yield* limits.standing(planned), { kind: 'ok' })
    }).pipe(Effect.provide(withAgents({}))),
  )

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
        { agentId: 'opencode', model: sameMaker.id },
      ])
      yield* noCall
    }).pipe(
      Effect.provide(
        withAgents(
          {
            'claude-code': { outOfUsage: { until: back } },
            opencode: { models: [third, sameMaker, { id: 'opencode-zen/gpt-strong', name: 'OpenCode Zen/GPT Strong' }] },
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
        sameMaker.id,
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
  it.live('keeps comparable strength ahead of a weak or unscored different maker', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const models = yield* Models
      const input = { besides: ['claude-code'], projectId: task.projectId, planned: { agentId: 'claude-code', model: claude.id } }
      assert.strictEqual((yield* limits.free(input))?.model, sameMaker.id)
      yield* models.setModelBlocked({ agentId: 'codex', model: weak.id, blocked: true })
      assert.strictEqual((yield* limits.free(input))?.model, sameMaker.id)
      assert.strictEqual(yield* limits.modelFor({ agentId: 'opencode', projectId: task.projectId }), sameMaker.id)
    }).pipe(Effect.provide(withAgents({ codex: { models: [weak] }, opencode: { models: [unscored, sameMaker] } }))),
  )

  it.live('takes over on a default-only agent, unless its default is blocked', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const models = yield* Models
      assert.deepInclude(yield* limits.free({ besides: ['claude-code', 'codex'], projectId: task.projectId }), {
        agentId: 'opencode',
        model: null,
      })
      yield* models.setModelBlocked({ agentId: 'opencode', model: 'default', blocked: true })
      assert.isUndefined(yield* limits.free({ besides: ['claude-code', 'codex'], projectId: task.projectId }))
    }).pipe(Effect.provide(withAgents({ opencode: { models: [{ id: 'default', name: 'Default (recommended)' }] } }))),
  )

  it.live('continues an automation on a subscribed provider whose account otherwise pays per use', () => {
    const back = Date.now() + 3_600_000
    return Effect.gen(function* () {
      const { projectId } = yield* startTask()
      const instance = yield* Instance
      const automations = yield* Automations
      const automationId = yield* automations.make({
        projectId: projectId as ProjectId,
        actorId: instance.personId,
        definition: {
          name: 'Carry on',
          prompt: 'Finish this run [lead:finish]',
          schedule: { every: 'week', days: [1], at: '09:00' },
          zone: 'Europe/London',
          lead: { agentId: 'claude-code', model: claude.id },
          work: { kind: 'task', review: null, end: null },
          allowEverything: true,
          minutes: 45,
          late: 'once',
        },
      })
      yield* automations.runNow(automationId, instance.personId)
      const sql = yield* SqlClient.SqlClient
      const [run] = yield* until(
        sql<{ threadId: string; state: string }>`SELECT h.id AS thread_id, o.state FROM automation_occurrences o
        JOIN threads h ON h.task_id = o.task_id AND h.kind = 'task' WHERE o.automation_id = ${automationId}`,
        (all) => all[0]?.state === 'made',
      )
      assert.deepStrictEqual(yield* agentsOn(run!.threadId), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'opencode', model: third.id },
      ])
      const limits = yield* Limits
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('opencode')
      // Explicit and inferred account selection use the same provider payment rule.
      assert.strictEqual(
        (yield* limits.pick({ agentId: 'opencode', threadId: run!.threadId, model: third.id, accountId: account!.id })).id,
        account!.id,
      )
      assert.strictEqual((yield* limits.pick({ agentId: 'opencode', threadId: run!.threadId, model: third.id })).id, account!.id)
      // A per-use route is picked like any other: nothing refuses it for the run it belongs to.
      assert.strictEqual(
        (yield* limits.pick({ agentId: 'opencode', threadId: run!.threadId, model: 'opencode-zen/gpt-strong' })).id,
        account!.id,
      )
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
  const reasonOf = (automationId: string) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) =>
        sql<{ state: string; reason: string | null; taskId: string | null }>`
          SELECT state, reason, task_id FROM automation_occurrences WHERE automation_id = ${automationId} ORDER BY fired_at, rowid`,
    )
  const agentsOf = (taskId: string) =>
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.map(
        sql<{ agentId: string }>`
          SELECT s.agent_id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.task_id = ${taskId} AND t.kind = 'task'`,
        (rows) => rows.map((row) => row.agentId),
      ),
    )

  it.live('moves an automation whose Go sign-in was refused to another agent a plan pays for, saying so', () =>
    Effect.gen(function* () {
      const { projectId } = yield* startTask()
      const instance = yield* Instance
      const automations = yield* Automations
      const id = yield* automationFor(projectId, { agentId: 'opencode', model: third.id })
      yield* automations.runNow(id, instance.personId)
      const [run] = yield* until(reasonOf(id), (all) => all[0]?.state === 'made')
      assert.match(run?.reason ?? '', /^OpenCode Go refused its sign-in, so its lead ran on Fake (claude-code|codex)/)
      const used = yield* agentsOf(run!.taskId!)
      assert.isAbove(used.length, 0)
      assert.notInclude(used, 'opencode')
      yield* noCall
    }).pipe(Effect.provide(withAgents({}, ['opencode'], true, { goRefused: true }))),
  )

  it.live('skips an automation whose Go sign-in was refused when no other plan has room, and says what would make it run', () =>
    Effect.gen(function* () {
      const { projectId } = yield* startTask()
      const instance = yield* Instance
      const automations = yield* Automations
      const id = yield* automationFor(projectId, { agentId: 'opencode', model: third.id })
      const refused = yield* Effect.flip(automations.runNow(id, instance.personId))
      assert.strictEqual(
        (refused as { readonly message?: string }).message,
        'OpenCode Go refused its sign-in, and no other plan had room. Sign in to OpenCode Go in Settings.',
      )
    }).pipe(Effect.provide(withAgents({}, ['opencode'], true, { goRefused: true, signedOut: ['claude-code', 'codex'] }))),
  )

  for (const step of ['lead', 'review'] as const) {
    for (const route of ['subscription-backed', 'per-use'] as const) {
      it.live(`starts an automation with a ${route} ${step}`, () => {
        const model = route === 'per-use' ? 'opencode-zen/gpt-strong' : third.id
        return Effect.gen(function* () {
          const { projectId } = yield* startTask()
          const instance = yield* Instance
          const automations = yield* Automations
          const choice =
            step === 'lead'
              ? { lead: { agentId: 'opencode', model }, review: null }
              : { lead: { agentId: 'claude-code', model: claude.id }, review: { agentId: 'opencode', model } }
          const id = yield* automationFor(projectId, choice.lead, choice.review)
          yield* automations.runNow(id, instance.personId)
          const [run] = yield* until(automationRuns(id), (all) => all[0]?.state === 'made')
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* sql<{ agentId: string; model: string | null }>`
            SELECT s.agent_id, s.model FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
            WHERE t.task_id = ${run!.taskId} AND t.kind = ${step === 'lead' ? 'task' : 'step'}`
          assert.deepInclude(sessions, { agentId: 'opencode', model })
          yield* noCall
        }).pipe(
          Effect.provide(
            withAgents(
              { opencode: { models: [third, { id: 'opencode-zen/gpt-strong', name: 'OpenCode Zen/GPT Strong' }] } },
              ['opencode'],
              true,
            ),
          ),
        )
      })
    }
  }

  for (const fallback of ['move', 'wait'] as const) {
    it.live(
      `does not rotate back onto an exhausted subscription account: ${fallback}s when ${fallback === 'move' ? 'another model is free' : 'nothing is free'}`,
      () => {
        const back = Date.now() + 3_600_000
        let failures = 0
        return Effect.gen(function* () {
          const { projectId } = yield* startTask()
          const instance = yield* Instance
          const automations = yield* Automations
          yield* (yield* Policies).setAccounts(projectId as ProjectId, { rotate: true }, instance.personId)
          const id = yield* automationFor(projectId, { agentId: 'opencode', model: third.id })
          yield* automations.runNow(id, instance.personId)
          const [run] = yield* until(automationRuns(id), (all) => all.length > 0)
          if (fallback === 'move') {
            yield* until(automationRuns(id), (all) => all[0]?.state === 'made')
            assert.deepStrictEqual(yield* agentsOn(run!.threadId), [
              { agentId: 'opencode', model: third.id },
              { agentId: 'claude-code', model: claude.id },
            ])
          } else {
            yield* until(cards(projectId), (all) => all.some((card) => card.taskId === run!.taskId && card.waits?.why === 'nothing_free'))
            // Let the held-step scheduler run: the account must not be retried before reset.
            yield* Effect.sleep('250 millis')
            assert.deepStrictEqual(yield* agentsOn(run!.threadId), [{ agentId: 'opencode', model: third.id }])
          }
          assert.strictEqual(failures, 1)
          const out = yield* (yield* Limits).out('opencode', projectId)
          assert.isTrue(Option.isSome(out))
          const notices = (yield* items(run!.threadId)).filter((item) => item.kind === 'notice' && item.content.about === 'limit')
          assert.lengthOf(notices, 1)
          yield* noCall
        }).pipe(
          Effect.provide(
            withAgents(
              {
                opencode: {
                  models: [third],
                  outOfUsage: {
                    until: back,
                    beforeLimit: async () => {
                      failures++
                    },
                  },
                },
              },
              fallback === 'move' ? ['opencode'] : ['opencode', 'claude-code', 'codex'],
              true,
            ),
          ),
        )
      },
    )
  }
})
