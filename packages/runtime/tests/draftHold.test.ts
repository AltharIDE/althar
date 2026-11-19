import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Draft } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Live } from '../src/Live'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import type { ToolAccess } from '../src/ToolServer'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import { callTool, repository, runtime, until } from './support'

/** The coordinator's thread of a project opened on `path`, its tools' access, and the drafts the window is told of. */
const opened = (path: string) =>
  Effect.gen(function* () {
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const threadId = yield* (yield* Coordinator).thread(project.projectId)
    const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
    const told: { drafts: ReadonlyArray<Draft> } = { drafts: [] }
    const live = yield* Live
    yield* Effect.forkScoped(
      Stream.runForEach(yield* live.subscribe, (event) =>
        Effect.sync(() => {
          if (event._tag === 'Drafting' && event.threadId === threadId) told.drafts = event.drafts
        }),
      ),
    )
    return { threadId, coordinator, told, live }
  })

const planOf = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [plan] = yield* sql<{ state: string; startsAt: string | null }>`
      SELECT p.state, p.starts_at FROM task_plans p JOIN tasks t ON t.id = p.task_id WHERE t.slug = ${slug} ORDER BY p.rowid DESC`
    return plan
  })

/**
 * Hold pressed on a task's card while the coordinator drafts it is the runtime's: its plan comes held, whatever the window
 * does after (hidden behind another project, closed), a small change that would start at once included.
 */
describe('a task held while it was drafted', () => {
  it.live('comes as a held plan, held before its task existed, though planned as a small change', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, told, live } = yield* opened(repository())
      // Its draft_task call begins, as the coordinator's stream says, with nothing written yet.
      yield* live.publish({
        _tag: 'Agent',
        threadId,
        event: { _tag: 'ToolCall', toolCallId: 'd1', title: 'Draft task', kind: 'other', status: 'pending', althar: 'draft_task' },
      })
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((draft) => draft.key === 'd1'),
      )
      // The person holds it, and the window goes: nothing more comes from it.
      yield* (yield* Coordinator).holdDraft(threadId, 'd1', (yield* Instance).personId)
      assert.isTrue(told.drafts.find((draft) => draft.key === 'd1')?.held)

      yield* callTool(coordinator, 'draft_task', { title: 'Fix the Run menu', description: 'It says Strat. [lead:finish]' })
      yield* callTool(coordinator, 'propose_plan', {
        task: 'fix-the-run-menu',
        lead: { agent: 'claude-code', reason: 'A one-word typo.' },
        review: null,
        small_change: true,
      })
      // Proposed with no countdown: it waits for the person, rather than starting at once as a small change does.
      yield* Effect.sleep('300 millis')
      assert.deepStrictEqual(yield* planOf('fix-the-run-menu'), { state: 'proposed', startsAt: null })
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('holds the plan that came already, where Hold comes after it', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, told } = yield* opened(repository())
      yield* callTool(coordinator, 'draft_task', { title: 'Add a retry', description: 'Retry the upload once. [lead:finish]' })
      yield* callTool(coordinator, 'propose_plan', { task: 'add-a-retry', lead: { agent: 'claude-code', reason: 'Small.' }, review: null })
      const counting = yield* planOf('add-a-retry')
      assert.isNotNull(counting?.startsAt ?? null, 'its countdown runs')
      const key = told.drafts.find((draft) => draft.slug === 'add-a-retry')?.key ?? ''
      yield* (yield* Coordinator).holdDraft(threadId, key, (yield* Instance).personId)
      assert.deepStrictEqual(yield* planOf('add-a-retry'), { state: 'proposed', startsAt: null })
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})

/** The coordinator thread's cards, as the window reads them. */
const cardsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ projectId: string }>`SELECT project_id FROM threads WHERE id = ${threadId}`
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(thread?.projectId ?? ''))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

/**
 * A draft that doesn't go on to be planned says so, rather than sizing for ever: discarded, wherever it was, and with no
 * plan once its plan's call failed; once the turn is over, its card in the thread says it.
 */
describe('a task drafted whose plan never came', () => {
  it.live('says it was discarded at once, and its card says so once the turn is over', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, told, live } = yield* opened(repository())
      yield* callTool(coordinator, 'draft_task', { title: 'Explore roles', description: 'Who may do what. [lead:finish]' })
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((draft) => draft.slug === 'explore-roles'),
      )
      yield* callTool(coordinator, 'settle_task', { task: 'explore-roles', how: 'discard', why: 'one task, not five' })
      const [draft] = yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-roles' && one.discarded === true),
      )
      assert.isFalse(draft?.planning)
      // The turn ends: the live card goes, and the thread's says it was discarded.
      yield* live.publish({ _tag: 'TurnEnded', threadId, turnId: 'turn', state: 'completed' })
      const [card] = yield* until(cardsOn(threadId), (cards) => cards.some((one) => one.slug === 'explore-roles'))
      assert.deepInclude(card, { phase: 'settled', discarded: true })
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.length === 0,
      )
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('says it has no plan once its plan failed, and its card offers to plan it once the turn is over', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, told, live } = yield* opened(repository())
      yield* callTool(coordinator, 'draft_task', { title: 'Explore the team', description: 'Before multiplayer. [lead:finish]' })
      // Its plan's call begins and fails, as the coordinator's stream says.
      const call = (status: 'pending' | 'failed') =>
        live.publish({
          _tag: 'Agent',
          threadId,
          event:
            status === 'pending'
              ? {
                  _tag: 'ToolCall',
                  toolCallId: 'p1',
                  title: 'Propose plan',
                  kind: 'other',
                  status,
                  althar: 'propose_plan',
                  rawInput: { task: 'explore-the-team' },
                }
              : { _tag: 'ToolCallUpdate', toolCallId: 'p1', status },
        })
      yield* call('pending')
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-the-team' && one.planning),
      )
      yield* call('failed')
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-the-team' && one.unplanned === true && !one.planning),
      )
      yield* live.publish({ _tag: 'TurnEnded', threadId, turnId: 'turn', state: 'completed' })
      const [card] = yield* until(cardsOn(threadId), (cards) => cards.some((one) => one.slug === 'explore-the-team'))
      assert.deepInclude(card, { unplanned: true, plan: null })
      assert.isUndefined(card?.discarded)
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('has its card where it was drafted, before what the person said while its plan was on its way', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, live } = yield* opened(repository())
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ projectId: string }>`SELECT project_id FROM threads WHERE id = ${threadId}`
      yield* callTool(coordinator, 'draft_task', { title: 'Explore the roles', description: 'Who may do what. [lead:finish]' })
      yield* callTool(coordinator, 'draft_task', { title: 'Explore the team', description: 'Before multiplayer. [lead:finish]' })
      // Each card is in the thread as soon as its task is drafted, its plan still to come.
      const drafted = yield* until(cardsOn(threadId), (cards) => cards.length === 2)
      assert.deepStrictEqual(
        drafted.map((card) => [card.slug, card.plan]),
        [
          ['explore-the-roles', null],
          ['explore-the-team', null],
        ],
      )
      // Something said in the thread while the turn goes on, as the person's message was; then it ends with no plan for either.
      yield* addItem({ projectId: thread?.projectId as ProjectId, threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: 'Said since',
      })
      yield* live.publish({ _tag: 'TurnEnded', threadId, turnId: 'turn', state: 'completed' })
      yield* until(cardsOn(threadId), (cards) => cards.every((card) => card.unplanned === true))
      // Neither card came after what was said since, nor twice.
      const snapshot = yield* Effect.orDie((yield* Queries).coordinator(thread?.projectId ?? ''))
      assert.deepStrictEqual(
        snapshot.items.flatMap((item) =>
          item.kind === 'task' ? [item.content.slug] : item.kind === 'notice' && item.content.title === 'Said since' ? ['said'] : [],
        ),
        ['explore-the-roles', 'explore-the-team', 'said'],
      )
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('keeps its Discarded card where it was discarded before its plan call failed', () =>
    Effect.gen(function* () {
      const { threadId, coordinator, told, live } = yield* opened(repository())
      yield* callTool(coordinator, 'draft_task', { title: 'Explore approvals', description: 'From evidence alone. [lead:finish]' })
      const call = (status: 'pending' | 'failed') =>
        live.publish({
          _tag: 'Agent',
          threadId,
          event:
            status === 'pending'
              ? {
                  _tag: 'ToolCall',
                  toolCallId: 'p2',
                  title: 'Propose plan',
                  kind: 'other',
                  status,
                  althar: 'propose_plan',
                  rawInput: { task: 'explore-approvals' },
                }
              : { _tag: 'ToolCallUpdate', toolCallId: 'p2', status },
        })
      yield* call('pending')
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-approvals' && one.planning),
      )
      // Discarded while its plan is on its way, and then its plan's call fails: no plan came.
      yield* callTool(coordinator, 'settle_task', { task: 'explore-approvals', how: 'discard', why: 'one task, not five' })
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-approvals' && one.discarded === true),
      )
      yield* call('failed')
      yield* until(
        Effect.sync(() => told.drafts),
        (drafts) => drafts.some((one) => one.slug === 'explore-approvals' && !one.planned && one.unplanned === true),
      )
      yield* live.publish({ _tag: 'TurnEnded', threadId, turnId: 'turn', state: 'completed' })
      const [card] = yield* until(cardsOn(threadId), (cards) => cards.some((one) => one.slug === 'explore-approvals'))
      assert.deepInclude(card, { discarded: true, plan: null })
    }).pipe(Effect.scoped, Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
