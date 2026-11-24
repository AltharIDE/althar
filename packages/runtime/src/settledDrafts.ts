import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { type DraftLeft, IssueDraftCard } from '@althar/contracts'

import { DRAFT_LEFT } from './kinds'

/*
 * The issue drafts a project's settled tasks left. A task done, merged or
 * abandoned never waits in Needs you on an issue its lead drafted and the
 * person hasn't filed or discarded (`issueDraftsWaiting`): the draft is no
 * decision that holds the task. The project lists them instead, each its card
 * as its task's thread shows it, which Althar writes whole with each change
 * to the draft, so filing or discarding one from either place is seen in
 * both. Filed or discarded, it leaves the list.
 */

const decodeDraft = Schema.decodeUnknownOption(IssueDraftCard)

/** How many the list holds at most: the most recently settled tasks' first. */
const SHOWN = 50

/** The issue drafts a project's settled tasks left unfiled, the most recently settled task's first, its own oldest first. */
export const settledDrafts = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ taskId: string; taskTitle: string; threadId: string; itemId: string; content: string }>`
      SELECT k.id AS task_id, k.title AS task_title, t.id AS thread_id, i.id AS item_id, i.content
      FROM issue_drafts d
      JOIN threads t ON t.id = d.thread_id AND t.kind = 'task'
      JOIN tasks k ON k.id = t.task_id
      JOIN thread_items i ON i.thread_id = d.thread_id AND i.kind = 'issue_draft' AND json_extract(i.content, '$.draftId') = d.id
      WHERE k.project_id = ${projectId} AND k.state IN ('done', 'abandoned') AND d.state IN ${sql.in(DRAFT_LEFT)}
      ORDER BY k.settled_at DESC, k.id, d.created_at, d.rowid
      LIMIT ${SHOWN}`
    return rows.flatMap((row): ReadonlyArray<DraftLeft> =>
      Option.match(decodeDraft(JSON.parse(row.content)), {
        onNone: () => [],
        onSome: (draft) => [{ taskId: row.taskId, taskTitle: row.taskTitle, threadId: row.threadId, itemId: row.itemId, draft }],
      }),
    )
  })
