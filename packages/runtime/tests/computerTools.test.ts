import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { RuntimeOptions } from '../src/Config'
import type { ComputerAnswer, ComputerCall, ComputerOwner } from '../src/computerBridge'
import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, until } from './support'

/*
 * A lead using this computer's native apps in its turn (computer use): each
 * call carried to the computer as its task's, in a turn that is live; the
 * screenshot it keeps, kept in its conversation for its evidence; and the
 * computer let go once its turn ends without its lead releasing it.
 */

const WRITER = 'a1111111-1111-4111-8111-111111111111'
const READER = 'b2222222-2222-4222-8222-222222222222'
const OBSERVATION = 'c3333333-3333-4333-8333-333333333333'
const PICTURE = { data: SCREENSHOT_PNG, mimeType: 'image/png' as const }

/** The computer as the desktop app carries a call to it: Writer and Reader, the note passed between them, and what each call is. */
const fakeComputer = (more: { readonly refuse?: string; readonly evidence?: ComputerAnswer['picture'] } = {}) => {
  const calls: Array<{ readonly owner: ComputerOwner; readonly call: ComputerCall }> = []
  const ended: Array<ComputerOwner> = []
  const computer: NonNullable<RuntimeOptions['computer']> = (owner, call) => {
    calls.push({ owner, call })
    if (more.refuse !== undefined) return Effect.fail(more.refuse)
    switch (call.op) {
      case 'request':
        return Effect.succeed({
          text: JSON.stringify({
            windows: [
              { id: WRITER, app: 'Writer', title: 'Computer Writer fixture' },
              { id: READER, app: 'Reader', title: 'Computer Reader fixture' },
            ],
          }),
        })
      case 'observe':
        return Effect.succeed({
          text: `Observation ${OBSERVATION}\ne1 textbox "Note" Reviewed report\ne2 button "Export note"\ne3 button "Import note"`,
          // A look at Reader comes with its picture, as one asked with a screenshot does.
          ...(call.target === READER ? { picture: PICTURE } : {}),
        })
      case 'evidence':
        return Effect.succeed({ text: 'Captured Reader.', picture: more.evidence ?? PICTURE })
      default:
        return Effect.succeed({ text: 'Done.' })
    }
  }
  return { calls, ended, computer, computerEnded: (owner: ComputerOwner) => void ended.push(owner) }
}

const withComputer = (computer: Pick<RuntimeOptions, 'computer' | 'computerEnded'>) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, computer)))

/** A project whose coordinator starts a task whose lead passes the note from Writer to Reader. */
const used = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const coordinator: ToolAccess = {
    role: 'coordinator',
    projectId: project.projectId,
    threadId: yield* (yield* Coordinator).thread(project.projectId),
    sessionId: 'coordinator-session',
    taskId: null,
  }
  assert.match(
    yield* callTool(coordinator, 'start_task', { title: 'Verify the report', description: '[lead:computer]', lead: { agent: 'codex' } }),
    /^Started /,
  )
  const [task] = yield* sql<{ taskId: string; threadId: string }>`
    SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
    WHERE k.title = 'Verify the report'`
  return { projectId: project.projectId, taskId: task?.taskId ?? '', threadId: task?.threadId ?? '' }
})

/** The lead as it was in the turn it used the computer in, once that turn is over. */
const after = (projectId: string, owner: ComputerOwner) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* until(
      sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE id = ${owner.turnId}`,
      ([turn]) => turn?.state !== 'delivered',
    )
    const lead: ToolAccess = {
      role: 'lead',
      projectId,
      threadId: owner.threadId,
      sessionId: owner.sessionId,
      taskId: owner.taskId,
      turnId: owner.turnId,
    }
    return lead
  })

/** What the lead said and kept in its conversation, as words to look in. */
const said = (threadId: string) => Effect.map(items(threadId), (all) => all.map((item) => JSON.stringify(item.content)).join('\n'))

describe('computer use in a task’s turn', () => {
  it.live('carries each call to the computer as its task’s, keeps its screenshot for its evidence, and lets go once released', () => {
    const fake = fakeComputer()
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* used
      yield* until(
        Effect.sync(() => fake.calls.map((one) => one.call.op)),
        (ops) => ops.includes('release'),
      )
      assert.deepStrictEqual(
        fake.calls.map((one) => one.call.op),
        ['request', 'observe', 'type', 'observe', 'observe', 'click', 'observe', 'click', 'observe', 'evidence', 'release'],
      )
      for (const { owner } of fake.calls) {
        assert.strictEqual(owner.taskId, taskId)
        assert.strictEqual(owner.threadId, threadId)
        assert.strictEqual(owner.title, 'Verify the report')
      }
      const [kept] = (yield* items(threadId)).filter((item) => item.kind === 'pictures')
      assert.strictEqual(kept?.content.source, 'computer')
      assert.include(JSON.stringify(kept?.content.pictures), 'Reader shows the transferred note.')

      // Its turn over, the computer is no longer its task's: no call reaches it, and what it released isn't let go again.
      const lead = yield* after(projectId, fake.calls[0]?.owner as ComputerOwner)
      const calls = fake.calls.length
      assert.strictEqual(yield* callTool(lead, 'computer', { op: 'status' }), 'Computer use needs an active task turn.')
      assert.strictEqual(
        yield* callTool({ ...lead, turnId: null }, 'computer', { op: 'status' }),
        'Computer use needs an active task turn.',
      )
      assert.strictEqual(
        yield* callTool({ ...lead, taskId: null }, 'computer', { op: 'status' }),
        'Computer use needs an active task turn.',
      )
      assert.strictEqual(
        yield* callTool(lead, 'computer', { op: 'click', target: 'Writer' }),
        'click: target: Expected an id Althar gave (a UUID) or "desktop", got "Writer"; observation is missing; at is missing. For example {"op":"click","target":"<window id>","observation":"<observation id>","at":{"element":"e4"}} or "at":{"x":120,"y":40}.',
      )
      assert.strictEqual(fake.calls.length, calls)
      yield* Effect.sleep('1500 millis')
      assert.deepStrictEqual(fake.ended, [])
    }).pipe(Effect.provide(withComputer(fake)))
  })

  it.live('lets go of the computer once a turn ends without its lead releasing it, and says why the computer refused', () => {
    const fake = fakeComputer({ refuse: 'The person chose not now.' })
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* used
      yield* until(said(threadId), (words) => words.includes('The person chose not now.'))
      assert.deepStrictEqual(
        fake.calls.map((one) => one.call.op),
        ['request'],
      )
      const [ended] = yield* until(
        Effect.sync(() => fake.ended),
        (owners) => owners.length > 0,
      )
      assert.strictEqual(ended?.taskId, taskId)
    }).pipe(Effect.provide(withComputer(fake)))
  })

  it.live('says where the screenshot it would keep isn’t a picture Althar can keep', () => {
    const fake = fakeComputer({ evidence: { data: Buffer.from('not a picture').toString('base64'), mimeType: 'image/png' } })
    return Effect.gen(function* () {
      const { threadId } = yield* used
      yield* until(said(threadId), (words) => words.includes('Althar could not keep that picture.'))
      assert.isEmpty((yield* items(threadId)).filter((item) => item.kind === 'pictures'))
    }).pipe(Effect.provide(withComputer({ computer: fake.computer })))
  })
})
