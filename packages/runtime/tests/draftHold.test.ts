import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Draft } from '@althar/contracts'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Live } from '../src/Live'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import type { ToolAccess } from '../src/ToolServer'
import * as Runtime from '../src/Runtime'
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
