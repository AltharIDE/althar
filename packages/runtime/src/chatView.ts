import type { ConversationView } from '@althar/contracts'
import type { CommandEnvelope, ProjectId } from '@althar/domain'
import { Commands } from '@althar/persistence-sqlite'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound, NothingToClear } from './errors'
import { change, fact } from './records'
import { addItem } from './threads'

/*
 * Clearing the coordinator's chat (docs/decisions/101). Two acts, of different
 * weight, on the project's coordinator thread:
 *
 * - Clearing the view marks the thread where the cleared view begins. The
 *   items stay, so the agent, read_thread and a handover still reach all of
 *   them; only what the thread shows starts at the mark, with what is still
 *   open carried in. Show earlier opens what came before it; Undo takes the
 *   mark away. The mark is the thread's, so every window and every reload
 *   agrees.
 * - Forgetting the conversation deletes its items (`forgetItems`), after
 *   `Sessions.forget` ended the session that held it.
 *
 * Both keep what is still open: a task that has not settled, a pending
 * issue draft or change, an open question, and the other cards that wait on
 * the person. The project's notes, tasks and errands are records of their own.
 */

/** What Althar says across the thread where a forgotten conversation was: the fresh session starts below it. */
export const FRESH_SESSION = 'Fresh session'

/**
 * SQL over a thread item `i`: it is still open, so it stays whatever is
 * cleared. A task that has not settled, a draft or a change waiting to be
 * filed or applied, a question waiting for an answer, and the cards that ask
 * the person to press something.
 */
const OPEN_ITEM = `(
  (i.kind = 'task' AND EXISTS (SELECT 1 FROM tasks k WHERE k.id = json_extract(i.content, '$.taskId') AND k.state IN ('draft', 'open')))
  OR (i.kind = 'issue_draft' AND EXISTS (SELECT 1 FROM issue_drafts d WHERE d.id = json_extract(i.content, '$.draftId') AND d.state = 'pending'))
  OR (i.kind = 'issue_changes' AND EXISTS (SELECT 1 FROM issue_changes c WHERE c.id = json_extract(i.content, '$.changesId') AND c.state = 'pending'))
  OR (i.kind = 'question' AND EXISTS (SELECT 1 FROM attention_requests a WHERE a.id = json_extract(i.content, '$.attentionId') AND a.state = 'open'))
  OR (i.kind = 'task_ask' AND json_extract(i.content, '$.state') = 'open')
  OR (i.kind = 'setting' AND EXISTS (SELECT 1 FROM setting_changes s WHERE s.item_id = i.id AND s.state = 'asked'))
  OR (i.kind = 'automation' AND (EXISTS (SELECT 1 FROM automations m WHERE m.id = json_extract(i.content, '$.automationId') AND m.state = 'proposed')
    OR json_extract(i.content, '$.ask.done') = 0))
)`

/** SQL over a thread item `i`: the line a forgotten conversation leaves, which is no conversation to clear or forget. */
const FRESH_LINE = `(i.kind = 'notice' AND json_extract(i.content, '$.source') = 'runtime' AND json_extract(i.content, '$.title') = '${FRESH_SESSION}')`

/** SQL over a thread item `i` and its input `u`: what a person reads in the thread as the conversation. */
const CONVERSATION = `(u.state IS NULL OR u.state <> 'withdrawn') AND NOT ${OPEN_ITEM} AND NOT ${FRESH_LINE}`

/** The SQL over a thread's item `i` that says it is still open, for the page that carries such items into a cleared view. */
export const openItem = OPEN_ITEM

/** Where a thread's view was cleared, and whether what came before it is open. */
export interface Mark {
  /** The sequence where the cleared view begins. */
  readonly from: number
  readonly earlierShown: boolean
}

interface CoordinatorRow {
  readonly projectId: ProjectId
  readonly viewFrom: number | null
  readonly earlierShown: number
  readonly revision: number
}

/** The coordinator thread's own row; anything else is not a thread whose chat is cleared. */
export const coordinatorRow = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<CoordinatorRow>`
      SELECT project_id, view_from, earlier_shown, revision FROM threads WHERE id = ${threadId} AND kind = 'coordinator'`
    return row === undefined ? yield* new NotFound({ kind: 'coordinator thread', id: threadId }) : row
  })

const markFrom = (row: CoordinatorRow): Mark | null =>
  row.viewFrom === null ? null : { from: row.viewFrom, earlierShown: row.earlierShown === 1 }

/** The mark on a coordinator thread, or null while its view is whole. */
export const markOf = (threadId: string) => Effect.map(coordinatorRow(threadId), markFrom)

/** How a coordinator thread is read: whether its view is cleared, and what there is to clear and to forget. */
export const viewOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = yield* coordinatorRow(threadId)
    const mark = markFrom(row)
    const [seen] = yield* sql<{ clearable: number; forgettable: number }>`
      SELECT
        EXISTS (SELECT 1 FROM thread_items i LEFT JOIN user_inputs u ON u.id = i.user_input_id
          WHERE i.thread_id = ${threadId} AND i.sequence >= ${mark?.from ?? 1} AND ${sql.unsafe(CONVERSATION)}) AS clearable,
        EXISTS (SELECT 1 FROM thread_items i LEFT JOIN user_inputs u ON u.id = i.user_input_id
          WHERE i.thread_id = ${threadId} AND ${sql.unsafe(CONVERSATION)}) AS forgettable`
    return {
      cleared: mark !== null,
      earlierOpen: mark?.earlierShown ?? false,
      clearable: seen?.clearable === 1,
      forgettable: seen?.forgettable === 1,
      version: row.revision,
    } satisfies ConversationView
  })

/** Records a change to the thread's mark, and tells the windows. */
const marked = (input: {
  readonly envelope: CommandEnvelope
  readonly threadId: string
  readonly projectId: ProjectId
  readonly set: { readonly viewFrom: number | null; readonly earlierShown: 0 | 1 }
  readonly type: string
}) =>
  Effect.gen(function* () {
    const revision = yield* change('threads', input.threadId, input.set)
    yield* fact({
      projectId: input.projectId,
      aggregateType: 'thread',
      aggregateId: input.threadId,
      revision,
      type: input.type,
      actorId: input.envelope.actorId,
      commandId: input.envelope.commandId,
    })
  })

/**
 * Clears the view: the thread begins after its last item. Nothing but the view
 * changes. Refused where nothing in the view is left to clear.
 */
export const clearView = (input: { readonly envelope: CommandEnvelope; readonly threadId: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const thread = yield* coordinatorRow(input.threadId)
    yield* commands.execute({
      envelope: input.envelope,
      projectId: thread.projectId,
      result: Schema.Void,
      handle: Effect.gen(function* () {
        if (!(yield* viewOf(input.threadId)).clearable) return yield* new NothingToClear({ threadId: input.threadId })
        const [end] = yield* sql<{ next: number }>`
          SELECT coalesce(max(sequence), 0) + 1 AS next FROM thread_items WHERE thread_id = ${input.threadId}`
        yield* marked({
          envelope: input.envelope,
          threadId: input.threadId,
          projectId: thread.projectId,
          set: { viewFrom: end?.next ?? 1, earlierShown: 0 },
          type: 'thread.view_cleared',
        })
      }),
    })
  })

/** Opens the conversation before the mark in the thread's place, or puts it away; nothing where the view is whole. */
export const showEarlier = (input: { readonly envelope: CommandEnvelope; readonly threadId: string; readonly open: boolean }) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    const thread = yield* coordinatorRow(input.threadId)
    yield* commands.execute({
      envelope: input.envelope,
      projectId: thread.projectId,
      result: Schema.Void,
      handle: Effect.gen(function* () {
        const mark = yield* markOf(input.threadId)
        if (mark === null || mark.earlierShown === input.open) return
        yield* marked({
          envelope: input.envelope,
          threadId: input.threadId,
          projectId: thread.projectId,
          set: { viewFrom: mark.from, earlierShown: input.open ? 1 : 0 },
          type: input.open ? 'thread.earlier_shown' : 'thread.earlier_hidden',
        })
      }),
    })
  })

/** Takes the mark away: the whole thread shows again. Nothing where the view is whole. */
export const undoClearView = (input: { readonly envelope: CommandEnvelope; readonly threadId: string }) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    const thread = yield* coordinatorRow(input.threadId)
    yield* commands.execute({
      envelope: input.envelope,
      projectId: thread.projectId,
      result: Schema.Void,
      handle: Effect.gen(function* () {
        if ((yield* markOf(input.threadId)) === null) return
        yield* marked({
          envelope: input.envelope,
          threadId: input.threadId,
          projectId: thread.projectId,
          set: { viewFrom: null, earlierShown: 0 },
          type: 'thread.view_restored',
        })
      }),
    })
  })

/**
 * Forgets the conversation: its items go, but for what is still open, and so
 * does the mark; what waits in the queue is withdrawn. The thread then says
 * where the fresh session begins. Run once no session is on the thread, as
 * `Sessions.forget` does, or the session's own writes would follow it.
 */
export const forgetItems = (input: {
  readonly envelope: CommandEnvelope
  readonly threadId: string
  /** A session on the thread ended for it: a fresh one is told of though no item went. */
  readonly ended: boolean
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const thread = yield* coordinatorRow(input.threadId)
    yield* commands.execute({
      envelope: input.envelope,
      projectId: thread.projectId,
      result: Schema.Void,
      handle: Effect.gen(function* () {
        // Read before the queue is withdrawn, which takes its messages out of what the thread shows.
        const conversation = (yield* viewOf(input.threadId)).forgettable
        // What waits in the queue is never read: not by this session, and not by the one that starts next.
        const waiting = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${input.threadId} AND state = 'queued'`
        for (const one of waiting) {
          const revision = yield* change('user_inputs', one.id, { state: 'withdrawn' })
          yield* fact({
            projectId: thread.projectId,
            aggregateType: 'user_input',
            aggregateId: one.id,
            revision,
            type: 'user_input.withdrawn',
            actorId: input.envelope.actorId,
            commandId: input.envelope.commandId,
          })
        }
        // With nothing said and no session, there is nothing to forget, and no fresh session to tell of.
        if (conversation || input.ended) {
          yield* sql`
            DELETE FROM thread_items WHERE thread_id = ${input.threadId} AND id NOT IN (
              SELECT i.id FROM thread_items i WHERE i.thread_id = ${input.threadId} AND ${sql.unsafe(OPEN_ITEM)})`
          yield* addItem({ projectId: thread.projectId, threadId: input.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: FRESH_SESSION,
            description: null,
          })
        }
        yield* marked({
          envelope: input.envelope,
          threadId: input.threadId,
          projectId: thread.projectId,
          set: { viewFrom: null, earlierShown: 0 },
          type: 'thread.conversation_forgotten',
        })
      }),
    })
  })
