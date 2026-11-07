import type { ConversationView } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { clearView, FRESH_SESSION, showEarlier, undoClearView } from '../src/chatView'
import { Coordinator } from '../src/Coordinator'
import { NotFound, NothingToClear } from '../src/errors'
import { handoverRecord } from '../src/handover'
import { keepNote, notesOf } from '../src/notes'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { addItem, transcript } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, until } from './support'

/*
 * The person can clear the coordinator's chat (docs/decisions/101). Clearing
 * the view marks the thread: it starts at the mark, with what is still open
 * carried in, and the coordinator keeps the conversation. Forgetting ends the
 * session and deletes the conversation, so nothing of it can be read again.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* coordinator.thread(project.projectId)
  const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
  return { projectId: project.projectId as ProjectId, threadId, access }
})

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
  })

/** What the thread's turns were prompted with, oldest first. */
const prompts = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string; providerSessionId: string; state: string }>`
      SELECT prompt, provider_session_id, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** Waits until the thread has had this many turns, each over, and its session waits for the next. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      prompts(threadId),
      (rows) => rows.length === count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) && !running.value.turnRunning ? [running.value] : [])),
      (rows) => rows.length === 1,
    )
  })

/** Says something and waits for the answer to it. */
const talk = (threadId: string, body: string, turn: number) =>
  Effect.gen(function* () {
    yield* say(threadId, body)
    yield* answered(threadId, turn)
  })

/** What a view says of itself but its version, which moves with each change to it. */
const flags = ({ version: _version, ...rest }: ConversationView) => rest

const snapshot = (projectId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return yield* Effect.orDie(queries.coordinator(projectId))
  })

/** What the person reads of the thread: their words, and the coordinator's first. */
const read = (projectId: string) =>
  Effect.map(snapshot(projectId), (shown) =>
    shown.items.flatMap((item) =>
      item.kind === 'user_message' ? [item.content.text] : item.kind === 'agent_message' ? [item.content.text.slice(0, 12)] : [],
    ),
  )

const clear = (threadId: string) =>
  Effect.gen(function* () {
    yield* clearView({ envelope: yield* Runtime.envelope('thread.clear_view', { threadId }), threadId })
  })

const earlier = (threadId: string, open: boolean) =>
  Effect.gen(function* () {
    yield* showEarlier({ envelope: yield* Runtime.envelope('thread.show_earlier', { threadId, open }), threadId, open })
  })

const undo = (threadId: string) =>
  Effect.gen(function* () {
    yield* undoClearView({ envelope: yield* Runtime.envelope('thread.undo_clear_view', { threadId }), threadId })
  })

const forget = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.forget({ envelope: yield* Runtime.envelope('thread.forget_conversation', { threadId }), threadId })
  })

/** A card asking the person to press something, as the coordinator's thread keeps it. */
const ask = (projectId: ProjectId, threadId: string) =>
  addItem({ projectId, threadId }, 'task_ask', {
    taskId: 'task',
    threadId: 'th',
    slug: 'a-task',
    title: 'A task',
    move: 'stop',
    why: null,
    state: 'open',
    said: null,
  })

describe('clearing the coordinator’s view', () => {
  it.live('starts the thread at the mark, and keeps what the agent, read_thread and a handover read', () =>
    Effect.gen(function* () {
      const { projectId, threadId, access } = yield* opened
      yield* talk(threadId, 'First question', 1)
      yield* talk(threadId, 'Second question', 2)
      assert.deepStrictEqual(flags((yield* snapshot(projectId)).view), {
        cleared: false,
        earlierOpen: false,
        from: null,
        clearable: true,
        forgettable: true,
      })

      yield* clear(threadId)

      // Nothing shows, and there is nothing more to clear.
      const cleared = yield* snapshot(projectId)
      assert.deepStrictEqual(cleared.items, [])
      assert.isFalse(cleared.earlier)
      const { from, ...rest } = flags(cleared.view)
      assert.deepStrictEqual(rest, { cleared: true, earlierOpen: false, clearable: false, forgettable: true })
      // The mark is where the view begins: the sequence after the last item, which an item before it is not at.
      assert.isNumber(from)
      const refused = yield* Effect.flip(clear(threadId))
      assert.instanceOf(refused, NothingToClear)

      // The session is untouched: the next turn is the same session's, and shows from the mark.
      const sessions = yield* Sessions
      const before = yield* sessions.running(threadId)
      yield* talk(threadId, 'Third question', 3)
      assert.deepStrictEqual((yield* read(projectId)).slice(0, 1), ['Third question'])
      const sql = yield* SqlClient.SqlClient
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`)[0]?.n, 1)
      assert.strictEqual(Option.getOrUndefined(before)?.sessionId, Option.getOrUndefined(yield* sessions.running(threadId))?.sessionId)

      // Everything before the mark is still there to read: the record, the tool and the brief of a handover.
      const record = yield* transcript(threadId, 30_000)
      assert.include(record.text, '[person] First question')
      assert.include(yield* callTool(access, 'read_thread', {}), '[person] First question')
      const handover = yield* handoverRecord({ projectId, threadId, modelOf: () => 'a model', working: () => false })
      assert.include(handover.sections.join('\n'), '[person] Second question')
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is every window’s: a read after it, from the store alone, pages from the mark', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* talk(threadId, 'One', 1)
      yield* clear(threadId)
      yield* talk(threadId, 'Two', 2)
      yield* talk(threadId, 'Three', 3)
      // Paged: the newest of what came after the mark, and then no further back than it.
      const queries = yield* Queries
      const page = yield* Effect.orDie(queries.coordinator(projectId, { limit: 2 }))
      assert.isTrue(page.earlier)
      const rest = yield* Effect.orDie(queries.coordinator(projectId, { before: page.items[0]?.sequence ?? 0, limit: 100 }))
      assert.isFalse(rest.earlier)
      assert.deepStrictEqual(
        [...rest.items, ...page.items].flatMap((item) => (item.kind === 'user_message' ? [item.content.text] : [])),
        ['Two', 'Three'],
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('opens the earlier conversation in the thread’s place, and Undo takes the mark away', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* talk(threadId, 'Before', 1)
      yield* clear(threadId)
      yield* talk(threadId, 'After', 2)

      const versions = [(yield* snapshot(projectId)).view.version]
      yield* earlier(threadId, true)
      versions.push((yield* snapshot(projectId)).view.version)
      const shown = yield* snapshot(projectId)
      assert.deepStrictEqual(
        shown.items.flatMap((item) => (item.kind === 'user_message' ? [item.content.text] : [])),
        ['Before'],
      )
      assert.deepStrictEqual([shown.view.cleared, shown.view.earlierOpen], [true, true])

      yield* earlier(threadId, false)
      assert.deepStrictEqual((yield* read(projectId))[0], 'After')

      yield* undo(threadId)
      versions.push((yield* snapshot(projectId)).view.version)
      // Each change moves the version on, so a window holding pages from before it starts over; saying it twice moves nothing.
      assert.strictEqual(new Set(versions).size, 3)
      const whole = yield* snapshot(projectId)
      assert.deepStrictEqual(
        whole.items.flatMap((item) => (item.kind === 'user_message' ? [item.content.text] : [])),
        ['Before', 'After'],
      )
      assert.deepStrictEqual([whole.view.cleared, whole.view.earlierOpen], [false, false])
      // Said again, by another window, it is no harm, and moves nothing.
      yield* undo(threadId)
      yield* earlier(threadId, true)
      const again = yield* snapshot(projectId)
      assert.isFalse(again.view.cleared)
      assert.strictEqual(again.view.version, whole.view.version)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('carries what is still open into the view, and lets what settled go', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* talk(threadId, 'Add a retry. [coordinator:plan]', 1)
      yield* ask(projectId, threadId)
      const sql = yield* SqlClient.SqlClient
      yield* clear(threadId)
      const shown = yield* snapshot(projectId)
      // Its card and the question waiting for a press are carried; the messages are not.
      assert.deepStrictEqual(shown.items.map((item) => item.kind).toSorted(), ['task', 'task_ask'])
      // A task that settled is part of the conversation: cleared with it.
      yield* sql`UPDATE tasks SET state = 'abandoned'`
      assert.deepStrictEqual(
        (yield* snapshot(projectId)).items.map((item) => item.kind),
        ['task_ask'],
      )
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.minutes(30) }))),
  )

  it.live('is refused for a thread that is not a project’s coordinator', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const projects = yield* Projects
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'A task' }),
        projectId,
        title: 'A task',
      })
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${created.taskId}`
      assert.instanceOf(yield* Effect.flip(clear(task?.id ?? '')), NotFound)
      assert.instanceOf(yield* Effect.flip(forget(task?.id ?? '')), NotFound)
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('forgetting the coordinator’s conversation', () => {
  it.live('ends the session, drops its queue and deletes the conversation, keeping what is open and the records', () =>
    Effect.gen(function* () {
      const { projectId, threadId, access } = yield* opened
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      yield* talk(threadId, 'Remember the codeword Zebra', 1)
      yield* talk(threadId, 'Add a retry. [coordinator:plan]', 2)
      yield* ask(projectId, threadId)
      yield* keepNote({ envelope: yield* Runtime.envelope('project.note.keep', {}), projectId, body: 'Ship on Fridays.' })
      yield* clear(threadId)
      // Said after the session ended, a message waits in the queue: forgotten, it never reaches an agent.
      const sessionId = Option.getOrUndefined(yield* sessions.running(threadId))?.sessionId

      yield* forget(threadId)

      // The session ended, and the mark went with the conversation.
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      assert.strictEqual(
        (yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId ?? ''}`)[0]?.state,
        'completed',
      )
      // Nothing of what was said can be reached: not the thread, the tool, nor the record a brief reads.
      const kinds = (yield* items(threadId)).map((item) => item.kind)
      assert.deepStrictEqual(kinds.toSorted(), ['notice', 'task', 'task_ask'])
      const record = yield* transcript(threadId, 30_000)
      assert.notInclude(record.text, 'Zebra')
      assert.notInclude(yield* callTool(access, 'read_thread', {}), 'Zebra')
      assert.notInclude(
        (yield* handoverRecord({ projectId, threadId, modelOf: () => 'a model', working: () => false })).sections.join('\n'),
        'Zebra',
      )
      // The thread says where the fresh session begins; no one is left to forget.
      const shown = yield* snapshot(projectId)
      assert.deepStrictEqual(flags(shown.view), { cleared: false, earlierOpen: false, from: null, clearable: false, forgettable: false })
      const last = shown.items.at(-1)
      assert.strictEqual(last?.kind === 'notice' ? last.content.title : null, FRESH_SESSION)
      // The records stay: the notes, the task and its plan.
      assert.deepStrictEqual(
        (yield* notesOf(projectId)).map((note) => note.body),
        ['Ship on Fridays.'],
      )
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM tasks WHERE state IN ('draft', 'open')`)[0]?.n, 1)
      assert.strictEqual((yield* sql<{ n: number }>`SELECT count(*) AS n FROM task_plans`)[0]?.n, 1)
    }).pipe(Effect.provide(withQueries(undefined, undefined, { countdown: Duration.minutes(30) }))),
  )

  it.live('starts the next message on a session of its own, briefed from the records and not from the conversation', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      const sql = yield* SqlClient.SqlClient
      yield* keepNote({ envelope: yield* Runtime.envelope('project.note.keep', {}), projectId, body: 'Ship on Fridays.' })
      yield* talk(threadId, 'Remember the codeword Zebra', 1)
      yield* forget(threadId)
      // What waits when the person forgets is not read by the session that starts next.
      const sessions = yield* Sessions
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { body: 'Stale words' }),
        threadId,
        body: 'Stale words',
        disposition: 'after_current',
      })
      yield* forget(threadId)
      assert.strictEqual((yield* sql<{ state: string }>`SELECT state FROM user_inputs WHERE body = 'Stale words'`)[0]?.state, 'withdrawn')

      yield* talk(threadId, 'Where were we?', 2)
      const turns = yield* prompts(threadId)
      const brief = turns.at(-1)?.prompt ?? ''
      assert.include(brief, 'Ship on Fridays.')
      assert.include(brief, 'Where were we?')
      assert.notInclude(brief, 'Zebra')
      assert.notInclude(brief, 'Stale words')
      assert.strictEqual(new Set(turns.map((turn) => turn.providerSessionId)).size, 2)
      // The coordinator said nothing before it was spoken to: only the person's message and its answer follow the line.
      const after = (yield* items(threadId)).map((item) => item.kind)
      assert.deepStrictEqual(after.slice(0, 2), ['notice', 'user_message'])
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('is no harm said twice or with nothing said', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      yield* forget(threadId)
      assert.deepStrictEqual((yield* items(threadId)).length, 0)
      yield* talk(threadId, 'Hello', 1)
      yield* forget(threadId)
      yield* forget(threadId)
      const shown = yield* snapshot(projectId)
      assert.deepStrictEqual(
        shown.items.map((item) => item.kind),
        ['notice'],
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
