import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { partsOfTask, presetsIn, savePreset } from '../src/presets'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
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
      assert.deepInclude(first.parameters, { end: 'ready', reviewAfterMerge: true })
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
})
