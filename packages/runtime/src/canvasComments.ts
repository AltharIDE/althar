import { CANVAS_LIMITS, type SentCanvasComment } from '@althar/contracts'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from './errors'
import { timestamp } from './records'

/*
 * The person's comments on a project's canvases (ADR-104), kept with the
 * message that sends them, in its command (`Sessions`' send): what the
 * canvas's agents read with canvas_read, and the window beside the canvas.
 */

/**
 * Keeps the person's comments on canvases with the message that sends them,
 * inside its command's transaction: each on a canvas of the message's own
 * project, at a version it has. One that isn't refuses the message whole.
 */
export const keepComments = (input: {
  readonly projectId: string
  readonly threadId: string
  readonly inputId: string
  readonly actorId: string
  readonly comments: ReadonlyArray<SentCanvasComment>
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = yield* timestamp
    const touched = new Set<string>()
    for (const [index, comment] of input.comments.entries()) {
      const [found] = yield* sql<{ one: number }>`
        SELECT 1 AS one FROM canvases c JOIN canvas_versions v ON v.canvas_id = c.id
        WHERE c.id = ${comment.canvasId} AND c.project_id = ${input.projectId} AND v.number = ${comment.version}`
      if (found === undefined) return yield* new NotFound({ kind: 'canvas_version', id: `${comment.canvasId}:${comment.version}` })
      const id = yield* newId(Ids.canvasComment)
      yield* sql`INSERT INTO canvas_comments (id, canvas_id, version, anchor, body, author_actor_id, user_input_id, thread_id, position, created_at)
        VALUES (${id}, ${comment.canvasId}, ${comment.version}, ${JSON.stringify(comment.anchor)}, ${comment.body.slice(0, CANVAS_LIMITS.note)},
          ${input.actorId}, ${input.inputId}, ${input.threadId}, ${index + 1}, ${at})`
      touched.add(comment.canvasId)
    }
    const ledger = yield* Ledger
    for (const canvasId of touched)
      yield* ledger.notify({
        projectId: input.projectId as ProjectId,
        aggregateType: 'canvas',
        aggregateId: canvasId,
        aggregateRevision: 1,
      })
  })
