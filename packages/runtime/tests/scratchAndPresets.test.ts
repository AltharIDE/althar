import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { partsOfTask, presetsIn, savePreset } from '../src/presets'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * Chats on Scratch, the parts tools and presets (a task is a conversation
 * plus parts): a chat the coordinator starts sits on Scratch until it takes a
 * worktree, and moves to the board saying so; a preset is saved from a task,
 * and the coordinator offers one once the person sets up the same parts twice.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
    return { projectId: project.projectId, threadId, coordinator }
  })

describe('a chat on Scratch', () => {
  it.live('sits off the board until it takes a worktree, then moves there, saying so', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* opened(working)
      yield* callTool(coordinator, 'start_task', {
        title: 'How does retry work?',
        description: 'Look. [lead:finish]',
        lead: { agent: 'claude-code' },
      })
      const [chat] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      assert.isTrue(chat?.scratch === true)
      assert.strictEqual(chat?.plan?.preset, 'Chat')
      // Scratch lists it by its latest exchange: its lead's last word.
      const [said] = yield* until(cards(projectId), (all) => all[0]?.latest !== undefined)
      assert.strictEqual(said?.latest?.by, 'lead')
      yield* until(
        Effect.flatMap(Sessions, (sessions) => sessions.busy(chat?.threadId ?? '')),
        (busy) => !busy,
      )
      // Its lead has to write: it takes a worktree, and the chat goes to the board.
      const sql = yield* SqlClient.SqlClient
      const [lead] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${chat?.threadId ?? ''} LIMIT 1`
      const access: ToolAccess = {
        role: 'lead',
        projectId,
        threadId: chat?.threadId ?? '',
        sessionId: lead?.id ?? '',
        taskId: chat?.taskId ?? '',
      }
      assert.match(
        yield* callTool(access, 'add_part', { part: 'workspace', why: 'To write the fix.' }),
        /^Took a worktree: .* is on althar\//,
      )
      const [moved] = yield* until(cards(projectId), (all) => all[0]?.scratch !== true)
      assert.isUndefined(moved?.scratch)
      assert.isTrue(
        (yield* items(chat?.threadId ?? '')).some(
          (item) => item.kind === 'notice' && item.content.title === 'On the board now: it took a worktree.',
        ),
      )
      // The person, or a lead, can put it back on Scratch; running someone's code is never a lead's to say.
      assert.include(
        yield* callTool(access, 'change_part', { part: 'shelf', shelf: 'scratch', why: 'Just talking now.' }),
        'on Scratch now',
      )
      assert.isTrue((yield* cards(projectId))[0]?.scratch === true)
      assert.include(yield* callTool(access, 'change_part', { part: 'access', why: 'Run it.' }), 'the person’s word alone')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('a chat’s copy', () => {
  it.live('is made without setup, which replays the first time its lead runs something', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* opened(working)
      const sql = yield* SqlClient.SqlClient
      yield* callTool(coordinator, 'start_task', {
        title: 'Talk it over',
        description: 'Talk. [lead:finish]',
        lead: { agent: 'claude-code' },
      })
      const [chat] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const setupOf = sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${chat?.taskId ?? ''}`
      // Only talking, nothing was set up.
      assert.isNull((yield* setupOf)[0]?.setup ?? null)
      // Its lead runs something: its setup replays then.
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: chat?.threadId ?? '' }),
        threadId: chat?.threadId ?? '',
        body: 'Run it. [lead:serve] [lead:finish]',
      })
      yield* until(setupOf, (rows) => rows[0]?.setup != null)
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

describe('presets', () => {
  it.live('are saved from a task, and offered once the person sets up the same parts twice', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working)
      const coordinator = yield* Coordinator
      const say = (body: string) =>
        Effect.gen(function* () {
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
        })
      yield* say('Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]')
      const [first] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
      // Saved from the task: its parts, team and the start of its brief.
      const instance = yield* Instance
      const { parts } = yield* partsOfTask(first?.taskId ?? '')
      assert.deepInclude(parts, { workspace: 'worktree', checked: 'none', end: 'draft', shelf: 'board' })
      yield* savePreset({ name: 'Quick change', parts, projectId: null, fromTaskId: first?.taskId ?? null, actorId: instance.personId })
      assert.include(
        (yield* presetsIn(projectId)).map((one) => one.name),
        'Quick change',
      )
      // Its card names it now, as the next with those parts.
      assert.strictEqual((yield* cards(projectId))[0]?.plan?.preset, 'Quick change')

      // The same parts again, with the same lead and no preset of them: the coordinator offers one, once.
      const sql = yield* SqlClient.SqlClient
      yield* sql`DELETE FROM presets`
      yield* say('Add a timeout. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]')
      yield* until(cards(projectId), (all) => all.length === 2 && all.every((one) => one.phase === 'ready'))
      const offers = yield* until(
        Effect.map(items(threadId), (all) =>
          all.filter((item) => item.kind === 'notice' && (item.content as { offer?: unknown }).offer !== undefined),
        ),
        (found) => found.length === 1,
      )
      assert.strictEqual(String(offers[0]?.content.title), 'You set up these parts twice. Keep them as a preset?')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('are what the coordinator plans from, and picking another on the plan card changes its parts to match', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* opened(working)
      const sql = yield* SqlClient.SqlClient
      // The coordinator lists them, and plans from the one that fits.
      assert.include(yield* callTool(coordinator, 'list_presets', {}), '- Small change: a worktree, reviewed after it merges')
      yield* callTool(coordinator, 'draft_task', { title: 'Fix a typo' })
      const said = yield* callTool(coordinator, 'propose_plan', {
        task: 'fix-a-typo',
        lead: { agent: 'codex', model: 'large' },
        review: { agent: 'claude-code' },
        preset: 'Small change',
      })
      assert.include(said, 'As Small change.')
      const plan = () =>
        Effect.map(
          sql<{
            id: string
            taskId: string
            parameters: string
          }>`SELECT id, task_id, parameters FROM task_plans ORDER BY rowid DESC LIMIT 1`,
          ([row]) => ({ id: row?.id ?? '', taskId: row?.taskId ?? '', parameters: JSON.parse(row?.parameters ?? '{}') }),
        )
      const first = yield* plan()
      yield* (yield* Plans).hold(first.id, (yield* Instance).personId)
      // Small change has no ending of its own: it ends as the project says (a draft where the project says nothing).
      assert.deepInclude(first.parameters, { end: 'draft', reviewAfterMerge: true })
      assert.deepStrictEqual(
        first.parameters.steps.map((step: { key: string; skipped: boolean }) => [step.key, step.skipped]),
        [
          ['implement', false],
          ['review', true],
        ],
      )
      const [card] = yield* until(cards(projectId), (all) => all[0]?.plan?.preset === 'Small change')
      assert.strictEqual(card?.plan?.preset, 'Small change')

      // Prototype, picked on its card: its lead, ending and brief.
      const instance = yield* Instance
      assert.strictEqual(yield* (yield* Plans).applyPreset(first.id, 'Prototype', instance.personId), 'Prototype')
      const now = yield* plan()
      assert.deepInclude(now.parameters.steps[0], { agentId: 'claude-code', model: 'claude-opus-5-5' })
      assert.strictEqual(now.parameters.end, 'none')
      // The review Small change had is gone, not left as a skipped row to add back.
      assert.deepStrictEqual(
        now.parameters.steps.map((step: { key: string }) => step.key),
        ['implement'],
      )
      const [task] = yield* sql<{ description: string }>`SELECT description FROM tasks WHERE id = ${now.taskId}`
      assert.include(task?.description, 'A prototype: show the idea working, quickly.')
      yield* until(cards(projectId), (all) => all[0]?.plan?.preset === 'Prototype')
      // Chat: a copy on Scratch, nothing checked.
      yield* (yield* Plans).applyPreset(first.id, 'Chat', instance.personId)
      const chat = yield* plan()
      assert.deepInclude(chat.parameters, { here: true, end: 'none' })
      const [shelved] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${now.taskId}`
      assert.strictEqual(shelved?.shelf, 'scratch')
      // A plan of work never becomes a review.
      const refused = yield* Effect.flip((yield* Plans).applyPreset(first.id, 'Review a PR', instance.personId))
      assert.include(String((refused as { message?: string }).message), 'Review a PR starts from a pull request')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('end as the project says, unless the person set an ending on one of their own', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, coordinator } = yield* opened(working)
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const policies = yield* Policies
      const plans = yield* Plans
      const latest = () =>
        Effect.map(sql<{ id: string; parameters: string }>`SELECT id, parameters FROM task_plans ORDER BY rowid DESC LIMIT 1`, ([row]) => ({
          id: row?.id ?? '',
          parameters: JSON.parse(row?.parameters ?? '{}'),
        }))
      const planned = (title: string, slug: string, preset: string, small?: boolean) =>
        Effect.gen(function* () {
          yield* callTool(coordinator, 'draft_task', { title })
          yield* callTool(coordinator, 'propose_plan', {
            task: slug,
            lead: { agent: 'codex', model: 'large' },
            review: { agent: 'claude-code' },
            preset,
            ...(small === true ? { small_change: true } : {}),
          })
          const plan = yield* latest()
          yield* plans.hold(plan.id, instance.personId)
          return plan
        })
      // "How a task ends" is a pull request ready for review: the built-in presets follow it.
      yield* policies.set(projectId, { end: 'ready' }, instance.personId)
      assert.strictEqual((yield* planned('Change one', 'change-one', 'Change')).parameters.end, 'ready')
      assert.strictEqual((yield* planned('Small one', 'small-one', 'Small change', true)).parameters.end, 'ready')
      // Another project setting, another ending.
      yield* policies.set(projectId, { end: 'draft' }, instance.personId)
      assert.strictEqual((yield* planned('Change two', 'change-two', 'Change')).parameters.end, 'draft')
      // Picking the preset on a plan card from one that ended otherwise (Prototype ends with its branch) follows it again.
      yield* policies.set(projectId, { end: 'ready' }, instance.personId)
      const picked = yield* planned('Change three', 'change-three', 'Prototype')
      assert.strictEqual(picked.parameters.end, 'none')
      yield* plans.applyPreset(picked.id, 'Change', instance.personId, 'ready')
      assert.strictEqual((yield* latest()).parameters.end, 'ready')
      // An ending the person set on a preset of their own overrides the project's.
      const parts = (yield* presetsIn(projectId)).find((one) => one.id === 'builtin:change')?.parts
      assert.isUndefined(parts?.end)
      yield* savePreset({
        name: 'Always draft',
        parts: { ...(parts as NonNullable<typeof parts>), end: 'draft' },
        projectId: null,
        fromTaskId: null,
        actorId: instance.personId,
      })
      assert.strictEqual((yield* planned('Change four', 'change-four', 'Always draft')).parameters.end, 'draft')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})

/** The descriptions of the tools a session with this access is given, by name. */
const toolDescriptions = (access: ToolAccess) =>
  Effect.gen(function* () {
    const granted = yield* (yield* ToolServer).grant(access)
    const server = granted.server
    if (server.type !== 'http') return new Map<string, string>()
    return yield* Effect.promise(async () => {
      const client = new Client({ name: 'test', version: '1.0.0' })
      const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport as Parameters<typeof client.connect>[0])
      try {
        return new Map((await client.listTools()).tools.map((one) => [one.name, one.description ?? ''] as const))
      } finally {
        await client.close()
      }
    })
  })

describe('what the coordinator and a lead are told of presets', () => {
  const PICKS = [
    'list_presets',
    'Prototype for a prototype or design directions',
    'Small change for a few lines',
    'Chat for a question or a look',
    'Review a PR for a review',
    'Change for the rest',
  ]

  it.live('is to call list_presets and plan from the one that fits, in the coordinator’s brief and in its tools’ descriptions', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { threadId, coordinator } = yield* opened(working)
      const turns = sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at`
      yield* (yield* Coordinator).say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'hello' }),
        threadId,
        body: 'hello',
        disposition: 'after_current',
      })
      const [first] = yield* until(turns, (rows) => rows.length === 1)
      const brief = first?.prompt ?? ''
      for (const words of PICKS) assert.include(brief, words)
      assert.include(brief, 'The person’s own presets count too')
      // A prototype ends with its branch; it may graduate to a change in the same task, or not, and the person decides.
      assert.include(brief, 'A prototype ends with its branch')
      assert.include(brief, 'the same task can go on as a change, with its pull request ending and its review added then')
      assert.include(brief, 'never assume either way')

      const tools = yield* toolDescriptions(coordinator)
      for (const words of PICKS) assert.include(tools.get('propose_plan'), words)
      assert.include(tools.get('draft_task'), 'list_presets')
      assert.include(tools.get('draft_task'), 'Prototype for a prototype or design directions')
      assert.include(tools.get('list_presets'), 'Prototype is for a prototype or design directions')
      assert.include(tools.get('list_presets'), 'Change for the rest')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('is the same for a lead that drafts tasks, with its own tools saying so too', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, coordinator } = yield* opened(working)
      yield* callTool(coordinator, 'start_task', {
        title: 'Look at retries',
        description: 'Look. [lead:finish]',
        lead: { agent: 'claude-code' },
      })
      const [lead] = yield* until(
        sql<{ prompt: string; threadId: string }>`
          SELECT d.prompt, d.thread_id FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
          WHERE t.project_id = ${projectId} AND t.kind = 'task' ORDER BY d.requested_at`,
        (rows) => rows.length > 0,
      )
      const brief = lead?.prompt ?? ''
      for (const words of PICKS) assert.include(brief, words)
      assert.include(brief, 'A prototype ends with its branch')
      assert.include(brief, 'never assume either way')
      const tools = yield* toolDescriptions({
        role: 'lead',
        projectId: projectId as never,
        threadId: lead?.threadId ?? '',
        sessionId: 'none',
        taskId: null,
      } as ToolAccess)
      assert.include(tools.get('draft_task'), 'list_presets')
      assert.include(tools.get('propose_plan'), 'Prototype for a prototype or design directions')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
