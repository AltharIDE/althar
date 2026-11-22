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
import { isBack, type StandIn, standInOf } from '../src/standIn'
import { atReset, fakeAgents, items, later, onTestClock, repository, runtime, turns, until, withWork } from './support'

const claude = { id: 'claude-strong', name: 'Claude Strong' }
const weak = { id: 'gpt-weak', name: 'GPT Weak' }
const sol = { id: 'gpt-strong', name: 'GPT Strong' }
const third = { id: 'opencode-go/deepseek-strong', name: 'OpenCode Go/DeepSeek Strong' }
const unscored = { id: 'unknown', name: 'New Model' }
const sameMaker = { id: 'opencode-go/claude-strong', name: 'OpenCode Go/Claude Strong' }
const goSol = { id: 'opencode-go/gpt-strong', name: 'OpenCode Go/GPT Strong' }

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

const startTask = (
  title = 'Continue the work [lead:finish]',
  reviewer?: string,
  lead: { readonly agentId: string; readonly model: string } = { agentId: 'claude-code', model: claude.id },
) =>
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
      description: withWork(title, reviewer !== undefined),
      draft: true,
    })
    const id = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      actorId: instance.personId,
      steps: [
        { key: 'implement', agentId: lead.agentId, model: lead.model, skipped: false },
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
        prompt: 'Finish this run [lead:finish] [lead:edit] [review:pass]',
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
  it.live('continues a turn on the same model on another agent with room, with its brief, commits and unfinished work', () => {
    const back = Date.now() + 3_600_000
    return Effect.gen(function* () {
      const task = yield* startTask()
      yield* task.start
      yield* ready(task.projectId)
      // OpenCode Go offers the lead's own model: it goes there, rather than to GPT Strong, which scores nearly as well.
      assert.deepStrictEqual(yield* agentsOn(task.threadId), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'opencode', model: sameMaker.id },
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
      assert.include(notices[0]?.content.title, 'Claude Strong on Fake opencode takes the work over until then.')
      assert.notInclude(notices[0]?.content.title, 'a different model')
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
      // No other agent offers GPT Strong, so the review moves to another model, and the line says so.
      assert.include(
        notices[0]?.content.title,
        'No other agent has room on that model, so DeepSeek Strong on Fake opencode, a different model, takes the review over until then.',
      )
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
      // OpenCode doesn't offer the lead's model here, so the stand-in is Codex, on another.
      Effect.provide(
        withAgents({ 'claude-code': { outOfUsage: { until: back }, holds: held }, codex: { holds: held }, opencode: { models: [third] } }),
      ),
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
  it.live('keeps the work on its model through another agent before a different, stronger model, and marks the other model', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const models = yield* Models
      // On GPT Strong through OpenCode Go: Codex offers the same model, Claude Code a stronger one.
      const input = { besides: ['opencode'], projectId: task.projectId, planned: { agentId: 'opencode', model: goSol.id } }
      const same = yield* limits.free(input)
      assert.deepInclude(same, { agentId: 'codex', model: sol.id })
      assert.isUndefined(same?.otherModel)
      // Only where none of the model's ways has room does it go to another, which the takeover says.
      yield* models.setModelBlocked({ agentId: 'codex', model: sol.id, blocked: true })
      assert.deepInclude(yield* limits.free(input), { agentId: 'claude-code', model: claude.id, otherModel: true })
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )

  it.live('keeps the model through a route nearly out where the one before is out, before another model with more room', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const accounts = yield* Accounts
      const sql = yield* SqlClient.SqlClient
      // Codex has GPT Strong with 4% left; Claude Code has Claude Strong with plenty.
      const [account] = yield* accounts.of('codex')
      yield* sql`INSERT INTO plan_usage_readings ${sql.insert({
        accountId: account!.id,
        agentId: 'codex',
        source: 'agent',
        windows: JSON.stringify([{ kind: 'weekly', usedPercent: 96, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }]),
        observedAt: new Date().toISOString(),
      })}`
      const input = { besides: ['opencode'], projectId: task.projectId, planned: { agentId: 'opencode', model: goSol.id } }
      // Out of usage on OpenCode Go: GPT Strong on Codex has some left, so the work stays on its model there.
      const same = yield* limits.free(input)
      assert.deepInclude(same, { agentId: 'codex', model: sol.id })
      assert.isUndefined(same?.otherModel)
      // Nearly out moves only to one with room: there, it goes to another model, and says so.
      assert.deepInclude(yield* limits.free({ ...input, withRoom: true }), { agentId: 'claude-code', model: claude.id, otherModel: true })
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )

  it.live('knows the model by its id where agents name it differently and the model list doesn’t know it', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const input = { besides: ['opencode'], projectId: task.projectId, planned: { agentId: 'opencode', model: 'opencode-go/gpt-fresh' } }
      const same = yield* limits.free(input)
      assert.deepInclude(same, { agentId: 'codex', model: 'gpt-fresh' })
      assert.isUndefined(same?.otherModel)
    }).pipe(
      Effect.provide(
        withAgents({
          codex: { models: [weak, { id: 'gpt-fresh', name: 'GPT Fresh Preview' }] },
          opencode: { models: [{ id: 'opencode-go/gpt-fresh', name: 'OpenCode Go/Fresh' }, third] },
        }),
      ),
    ),
  )

  it.live('reads an agent’s own default as the model it names, for the same model and for the line that it is another', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      const limits = yield* Limits
      const models = yield* Models
      // OpenCode is on its own default, which stands for its GPT Strong.
      const input = { besides: ['opencode'], projectId: task.projectId, planned: { agentId: 'opencode', model: 'default' } }
      const same = yield* limits.free(input)
      assert.deepInclude(same, { agentId: 'codex', model: sol.id })
      assert.isUndefined(same?.otherModel)
      yield* models.setModelBlocked({ agentId: 'codex', model: sol.id, blocked: true })
      assert.deepInclude(yield* limits.free(input), { agentId: 'claude-code', model: claude.id, otherModel: true })
    }).pipe(
      Effect.provide(
        withAgents({ opencode: { models: [{ id: 'default', name: 'Default (recommended)', description: goSol.name }, goSol, third] } }),
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

describe('a lead whose model the person turned off for its agent', () => {
  const lines = (threadId: string) =>
    Effect.map(items(threadId), (all) =>
      all.flatMap((item) => (item.kind === 'notice' ? [(item.content as { title?: string }).title ?? ''] : [])),
    )

  it.live('starts on the same model through another agent, as the lead, and the thread says so', () =>
    Effect.gen(function* () {
      const task = yield* startTask(undefined, undefined, { agentId: 'opencode', model: goSol.id })
      yield* (yield* Models).setModelBlocked({ agentId: 'opencode', model: goSol.id, blocked: true })
      yield* task.start
      const [on] = yield* until(agentsOn(task.threadId), (rows) => rows.length > 0)
      assert.deepStrictEqual(on, { agentId: 'codex', model: sol.id })
      assert.include(yield* lines(task.threadId), 'GPT Strong is turned off for Fake opencode: it carries on through Fake codex.')
      // It is the task's lead there, not a stand-in for a way it can't take: nothing gives it back.
      assert.isNull((yield* (yield* Queries).thread(task.threadId)).session?.standsIn ?? null)
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )

  it.live('hands a live thread to the same model through another agent, where the one asked for is turned off', () =>
    Effect.gen(function* () {
      const task = yield* startTask()
      yield* task.start
      yield* until(agentsOn(task.threadId), (rows) => rows.length > 0)
      yield* (yield* Models).setModelBlocked({ agentId: 'opencode', model: goSol.id, blocked: true })
      // The thread's lead is live on Claude Code as it is handed to GPT Strong on OpenCode Go, turned off there.
      yield* (yield* Sessions).switchAgent({ threadId: task.threadId, agentId: 'opencode', model: goSol.id })
      const on = yield* until(agentsOn(task.threadId), (rows) => rows.length > 1)
      assert.deepStrictEqual(on.at(-1), { agentId: 'codex', model: sol.id })
      assert.include(yield* lines(task.threadId), 'GPT Strong is turned off for Fake opencode: it carries on through Fake codex.')
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )

  it.live('goes on another model only where no agent with room offers it, and says that plainly', () =>
    Effect.gen(function* () {
      const task = yield* startTask(undefined, undefined, { agentId: 'opencode', model: goSol.id })
      const models = yield* Models
      yield* models.setModelBlocked({ agentId: 'opencode', model: goSol.id, blocked: true })
      yield* models.setModelBlocked({ agentId: 'codex', model: sol.id, blocked: true })
      yield* task.start
      const [on] = yield* until(agentsOn(task.threadId), (rows) => rows.length > 0)
      assert.deepStrictEqual(on, { agentId: 'opencode', model: third.id })
      assert.include(
        yield* lines(task.threadId),
        'GPT Strong is turned off for Fake opencode, and no other agent with room offers it, so DeepSeek Strong on Fake opencode, a different model, takes the work over.',
      )
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )
})

/** A session started standing in for `given` (as `kept` says), read against the task's lead (`lead`). */
const standingIn = (
  on: ModelChoice & { readonly model: string },
  given: ModelChoice,
  kept: Partial<StandIn> = {},
  lead: { readonly agentId: string; readonly model: string } = { agentId: 'opencode', model: goSol.id },
) =>
  Effect.gen(function* () {
    // The agents' models read, as they are where a stand-in is read against the task's lead.
    yield* until((yield* Models).catalog, (catalog) => catalog.every((agent) => !agent.probing))
    const task = yield* startTask(undefined, undefined, lead)
    const sessionId = yield* (yield* Sessions).start({
      threadId: task.threadId,
      agentId: on.agentId,
      model: on.model,
      standsIn: { ...given, effort: null, accountId: null, until: new Date(Date.now() + 3_600_000).toISOString(), ...kept },
    })
    return Option.getOrUndefined(yield* standInOf(sessionId, (yield* Limits).sameModel))
  })

describe('a stand-in read against the task’s lead', () => {
  it.live('isn’t one on the task’s own model, whoever it was started standing in for', () =>
    Effect.gen(function* () {
      // GPT Strong on Codex, kept as standing in for another model, while the task's lead is GPT Strong on OpenCode Go.
      assert.isUndefined(yield* standingIn({ agentId: 'codex', model: sol.id }, { agentId: 'opencode', model: third.id }))
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )

  it.live('stands in for the task’s lead where it was kept standing in for another model, so that lead comes back', () =>
    Effect.gen(function* () {
      const standsIn = yield* standingIn({ agentId: 'claude-code', model: claude.id }, { agentId: 'codex', model: weak.id })
      assert.deepInclude(standsIn, { agentId: 'opencode', model: goSol.id, accountId: null })
      // One standing in for the task's lead stays as it was.
      assert.deepInclude(yield* standingIn({ agentId: 'claude-code', model: claude.id }, { agentId: 'opencode', model: goSol.id }), {
        agentId: 'opencode',
        model: goSol.id,
      })
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )
})

describe('a stand-in read against the task’s lead, its model under other ids', () => {
  // Codex offers GPT Strong under an id of its own; OpenCode Go's Default stands for its GPT Strong.
  const codexSol = { id: 'gpt-strong-2026', name: 'GPT Strong' }
  const goDefault = { id: 'default', name: 'Default (recommended)', description: 'OpenCode Go/GPT Strong' }

  it.live('isn’t one where its model has the task’s model’s name under another id', () =>
    Effect.gen(function* () {
      assert.isUndefined(yield* standingIn({ agentId: 'codex', model: codexSol.id }, { agentId: 'opencode', model: third.id }))
    }).pipe(Effect.provide(withAgents({ codex: { models: [codexSol] }, opencode: { models: [goSol, third] } }))),
  )

  it.live('isn’t one where the task’s lead is on its agent’s Default, which names its model', () =>
    Effect.gen(function* () {
      assert.isUndefined(
        yield* standingIn(
          { agentId: 'codex', model: sol.id },
          { agentId: 'opencode', model: third.id },
          {},
          {
            agentId: 'opencode',
            model: goDefault.id,
          },
        ),
      )
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goDefault, goSol, third] } }))),
  )
})

describe('a stand-in kept for another model than the task’s lead', () => {
  it.live('gives the thread back once the task’s lead has room, not at the other model’s reset', () =>
    Effect.gen(function* () {
      // Kept nearly out on DeepSeek Strong until its weekly reset; the task's lead is GPT Strong on OpenCode Go.
      const week = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString()
      const standsIn = yield* standingIn(
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'opencode', model: third.id },
        { why: 'low', until: week, attemptId: 'att_other' },
      )
      assert.deepInclude(standsIn, { agentId: 'opencode', model: goSol.id, until: null, why: 'limit' })
      assert.notProperty(standsIn, 'attemptId')
      const limits = yield* Limits
      assert.isTrue(
        yield* isBack(standsIn!, (one) => (one.accountId === null ? limits.out(one.agentId) : limits.outAccount(one.accountId))),
      )
    }).pipe(Effect.provide(withAgents({ opencode: { models: [goSol, third] } }))),
  )
})

describe('a stand-in on another model that ends twice without its report', () => {
  it.live('hands the step to the task’s own model, before another with more room', () =>
    Effect.gen(function* () {
      const task = yield* startTask(undefined, undefined, { agentId: 'opencode', model: goSol.id })
      const accounts = yield* Accounts
      const sql = yield* SqlClient.SqlClient
      // OpenCode Go nearly out as the step starts: Claude Strong stands in, the only model with room but GPT Weak.
      const [account] = yield* accounts.of('opencode')
      yield* sql`INSERT INTO plan_usage_readings ${sql.insert({
        accountId: account!.id,
        agentId: 'opencode',
        source: 'agent',
        windows: JSON.stringify([{ kind: 'weekly', usedPercent: 96, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }]),
        observedAt: new Date().toISOString(),
      })}`
      yield* task.start
      // Claude Strong ends twice without a report: the step goes back to GPT Strong, nearly out as it is, not to GPT Weak.
      const on = yield* until(agentsOn(task.threadId), (rows) => rows.length > 1)
      assert.deepStrictEqual(on.slice(0, 2), [
        { agentId: 'claude-code', model: claude.id },
        { agentId: 'opencode', model: goSol.id },
      ])
    }).pipe(
      Effect.provide(withAgents({ 'claude-code': { noReport: true }, codex: { models: [weak] }, opencode: { models: [goSol, third] } })),
    ),
  )
})
