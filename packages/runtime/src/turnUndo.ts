import { UndoTurnResult, UserMessageItem } from '@althar/contracts'
import type { CommandEnvelope, ProjectId } from '@althar/domain'
import { resolve, sep } from 'node:path'
import { Commands } from '@althar/persistence-sqlite'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { UndoRefused } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { indexThread } from './Search'
import {
  applyRestore,
  changedPaths,
  planRestore,
  rollBackRestore,
  takeSnapshot,
  TurnCheckpoints,
  TurnSnapshot,
  type RestorePlan,
} from './turnSnapshots'

const fail = (message: string) => new UndoRefused({ message, files: [] })
const content = UserMessageItem.fields.content.fields
const SavedPrompts = Schema.Array(
  Schema.Struct({
    text: content.text,
    links: Schema.optional(content.links),
    pictures: Schema.optional(content.pictures),
    files: Schema.optional(content.files),
  }),
)
const RestorePlans = Schema.Array(
  Schema.Struct({
    cwd: Schema.String,
    before: TurnSnapshot,
    recovery: TurnSnapshot,
    paths: Schema.Array(Schema.String),
  }),
)

/** Snapshot before delivery, rather than when a queued prompt was typed. */
export const checkpointBeforeTurn = (threadId: string, deliveryId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const workspaces = yield* sql<{ id: string; path: string }>`
      SELECT w.id, w.path FROM workspaces w JOIN threads t ON t.task_id = w.task_id
      WHERE t.id = ${threadId} AND t.kind = 'task' AND w.device_id = ${instance.deviceId}
        AND w.access = 'write' AND w.state = 'ready' AND coalesce(w.kind, 'worktree') = 'worktree' AND w.moving_to IS NULL`
    if (workspaces.length === 0) return
    const points: Array<(typeof TurnCheckpoints.Type)[number]> = []
    for (const workspace of workspaces) {
      const before = yield* takeSnapshot(workspace.path, `refs/althar/chat/${deliveryId}/${workspace.id}/before`)
      points.push({ ...workspace, before })
    }
    yield* sql`UPDATE turn_deliveries SET checkpoints = ${JSON.stringify(points)} WHERE id = ${deliveryId}`
  })

/** The end boundary includes shell writes and commits, whatever tools the agent used. */
export const checkpointAfterTurn = (deliveryId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // Removing a project stops its agents without writing anything else into the person's repositories.
    const [row] = yield* sql<{ checkpoints: string | null }>`
      SELECT d.checkpoints FROM turn_deliveries d JOIN projects p ON p.id = d.project_id
      WHERE d.id = ${deliveryId} AND p.archived_at IS NULL`
    if (row?.checkpoints == null) return
    const points = yield* Schema.decodeUnknownEffect(TurnCheckpoints)(JSON.parse(row.checkpoints))
    const completed: Array<(typeof TurnCheckpoints.Type)[number]> = []
    for (const point of points) {
      const after = yield* takeSnapshot(point.path, `refs/althar/chat/${deliveryId}/${point.id}/after`)
      completed.push({ ...point, after })
    }
    yield* sql`UPDATE turn_deliveries SET checkpoints = ${JSON.stringify(completed)} WHERE id = ${deliveryId}`
  })

/** A prepared recovery is durable before any files move. A completed command and its receipt agree in one transaction. */
export const recoverTurnUndo = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ commandId: string; plans: string }>`
      SELECT command_id, plans FROM turn_undo_recoveries WHERE thread_id = ${threadId} AND state = 'prepared'`
    for (const row of rows) {
      const plans = yield* Schema.decodeUnknownEffect(RestorePlans)(JSON.parse(row.plans))
      for (const plan of plans.toReversed()) yield* rollBackRestore(plan)
      yield* sql`UPDATE turn_undo_recoveries SET state = 'recovered' WHERE command_id = ${row.commandId}`
    }
  })

export const undoTarget = (itemId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [target] = yield* sql<{ threadId: string; taskId: string; projectId: ProjectId; sequence: number; inputId: string }>`
      SELECT t.id AS thread_id, t.task_id, t.project_id, i.sequence, i.user_input_id AS input_id
      FROM thread_items i JOIN threads t ON t.id = i.thread_id JOIN tasks k ON k.id = t.task_id
      WHERE i.id = ${itemId} AND i.kind = 'user_message' AND i.undone_at IS NULL AND t.kind = 'task' AND k.state = 'open'`
    if (target === undefined) return yield* fail('This message cannot be undone. Open a task’s delivered message with a saved checkpoint.')
    return target
  })

/** No running plan, helper, checkout move or shared Local checkout may race a restore. */
export const canUndoTask = (taskId: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [busy] = yield* sql<{ n: number }>`SELECT (
      EXISTS (SELECT 1 FROM runs WHERE task_id = ${taskId} AND ended_at IS NULL)
      OR EXISTS (SELECT 1 FROM helpers WHERE task_id = ${taskId} AND state = 'working')
      OR EXISTS (SELECT 1 FROM workspaces WHERE task_id = ${taskId} AND access = 'write'
        AND (coalesce(kind, 'worktree') <> 'worktree' OR state <> 'ready' OR moving_to IS NOT NULL))
      OR EXISTS (SELECT 1 FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
        WHERE t.task_id = ${taskId} AND t.id <> ${threadId} AND s.state IN ('starting', 'active', 'waiting_approval', 'cancelling'))
    ) AS n`
    if (busy?.n === 1) return yield* fail('Stop the task’s work and helpers before undoing. File restore needs the task’s own worktrees.')
    const instance = yield* Instance
    const folders = yield* sql<{ taskId: string; path: string }>`
      SELECT task_id, path FROM workspaces WHERE device_id = ${instance.deviceId} AND access = 'write' AND state = 'ready'`
    const pathOf = (path: string) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))
    for (const own of folders.filter((folder) => folder.taskId === taskId)) {
      const path = pathOf(own.path)
      if (
        folders.some((other) => {
          const shared = pathOf(other.path)
          return other.taskId !== taskId && (shared === path || shared.startsWith(path + sep) || path.startsWith(shared + sep))
        })
      )
        return yield* fail('Another task shares this folder. Undo needs a worktree used only by this task.')
    }
  })

export const undoConversation = (input: { readonly envelope: CommandEnvelope; readonly itemId: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const [receipt] =
      yield* sql`SELECT 1 FROM command_receipts WHERE actor_id = ${input.envelope.actorId} AND command_id = ${input.envelope.commandId}`
    if (receipt !== undefined)
      return yield* commands.execute({
        envelope: input.envelope,
        result: UndoTurnResult,
        handle: Effect.die('An existing undo receipt must be read, not run again.'),
      })
    const target = yield* undoTarget(input.itemId)
    yield* canUndoTask(target.taskId, target.threadId)
    // Messages claimed together form one turn and must be taken back together.
    const [first] = yield* sql<{ deliveryId: string; sequence: number }>`
      SELECT d.id AS delivery_id, min(i.sequence) AS sequence FROM turn_deliveries d
      JOIN turn_delivery_inputs selected ON selected.delivery_id = d.id AND selected.user_input_id = ${target.inputId}
      JOIN turn_delivery_inputs di ON di.delivery_id = d.id JOIN thread_items i ON i.user_input_id = di.user_input_id
      WHERE d.thread_id = ${target.threadId} AND d.undone_at IS NULL AND i.undone_at IS NULL
      GROUP BY d.id ORDER BY d.requested_at, d.rowid LIMIT 1`
    if (first === undefined) return yield* fail('The agent has not read this message. Take it back from the queue instead.')
    const deliveries = yield* sql<{ id: string; checkpoints: string | null }>`
      SELECT d.id, d.checkpoints FROM turn_deliveries d
      WHERE d.thread_id = ${target.threadId} AND d.rowid >= (SELECT rowid FROM turn_deliveries WHERE id = ${first.deliveryId})
        AND d.undone_at IS NULL
      ORDER BY d.rowid`
    const byWorkspace = new Map<
      string,
      {
        path: string
        after: typeof TurnSnapshot.Type
        files: Map<string, { before: typeof TurnSnapshot.Type; after: typeof TurnSnapshot.Type }>
      }
    >()
    for (const delivery of deliveries) {
      if (delivery.checkpoints === null)
        return yield* fail('This part of the conversation has no saved file checkpoint. Nothing was undone.')
      const points = yield* Schema.decodeUnknownEffect(TurnCheckpoints)(JSON.parse(delivery.checkpoints))
      if (points.length === 0 || points.some((point) => point.after === undefined))
        return yield* fail('This turn has no complete file checkpoint. Nothing was undone.')
      for (const point of points) {
        if (point.after === undefined) continue
        const previous = byWorkspace.get(point.id)
        if (previous !== undefined && previous.path !== point.path)
          return yield* fail('The task’s folders moved after this turn. Nothing was undone.')
        const files = previous?.files ?? new Map<string, { before: typeof TurnSnapshot.Type; after: typeof TurnSnapshot.Type }>()
        for (const path of yield* changedPaths(point.path, point.before.ref, point.after.ref)) {
          const prior = files.get(path)
          if (prior !== undefined && (yield* changedPaths(point.path, prior.after.ref, point.before.ref, [path])).length > 0)
            return yield* new UndoRefused({
              message: 'This file was edited between the turns being undone. Keep or move those edits first.',
              files: [path],
              why: 'edited',
            })
          files.set(path, { before: prior?.before ?? point.before, after: point.after })
        }
        byWorkspace.set(point.id, { path: point.path, after: point.after, files })
      }
    }
    const instance = yield* Instance
    const current = yield* sql<{ id: string; path: string }>`
      SELECT id, path FROM workspaces WHERE task_id = ${target.taskId} AND device_id = ${instance.deviceId} AND access = 'write' AND state = 'ready'`
    if (current.length !== byWorkspace.size || current.some((workspace) => byWorkspace.get(workspace.id)?.path !== workspace.path))
      return yield* fail('The task’s changes or folders have changed since this turn. Nothing was undone.')
    const plans: RestorePlan[] = []
    for (const [id, point] of byWorkspace) {
      const groups = new Map<string, { before: typeof TurnSnapshot.Type; after: typeof TurnSnapshot.Type; paths: string[] }>()
      for (const [path, file] of point.files) {
        const key = `${file.before.ref}:${file.after.ref}`
        const group = groups.get(key) ?? { ...file, paths: [] }
        group.paths.push(path)
        groups.set(key, group)
      }
      if (groups.size === 0) groups.set('', { before: point.after, after: point.after, paths: [] })
      let n = 0
      for (const group of groups.values()) {
        // Compare contents with the last turn to touch each path, but HEAD with the latest turn of this workspace.
        const after = { ...group.after, head: point.after.head, branch: point.after.branch }
        plans.push(
          yield* planRestore(
            point.path,
            group.before,
            after,
            `refs/althar/chat-recovery/${input.envelope.commandId}/${id}/${n++}`,
            group.paths,
          ),
        )
      }
    }
    const messages = yield* sql<{ content: string }>`
      SELECT content FROM thread_items WHERE thread_id = ${target.threadId} AND kind = 'user_message'
        AND sequence >= ${first.sequence} AND undone_at IS NULL ORDER BY sequence`
    const saved = yield* Schema.decodeUnknownEffect(SavedPrompts)(messages.map((row) => JSON.parse(row.content)))
    const decoded = saved.map((message) => ({
      ...message,
      links: message.links ?? [],
      pictures: message.pictures ?? [],
      files: message.files ?? [],
    }))
    // No mutation before every workspace and every returned attachment has been checked.
    yield* sql`INSERT OR REPLACE INTO turn_undo_recoveries ${sql.insert({ commandId: input.envelope.commandId, threadId: target.threadId, plans: JSON.stringify(plans), state: 'prepared' })}`
    return yield* Effect.gen(function* () {
      for (const plan of plans) yield* applyRestore(plan)
      return yield* commands.execute({
        envelope: input.envelope,
        projectId: target.projectId,
        result: UndoTurnResult,
        handle: Effect.gen(function* () {
          const at = yield* timestamp
          yield* sql`UPDATE thread_items SET undone_at = ${at} WHERE thread_id = ${target.threadId} AND sequence >= ${first.sequence} AND undone_at IS NULL`
          yield* sql`UPDATE turn_deliveries SET undone_at = ${at} WHERE id IN ${sql.in(deliveries.map((delivery) => delivery.id))}`
          yield* sql`UPDATE user_inputs SET state = 'withdrawn' WHERE thread_id = ${target.threadId} AND (
            state IN ('queued', 'noted') OR (state = 'delivered' AND id IN (SELECT user_input_id FROM thread_items
              WHERE thread_id = ${target.threadId} AND undone_at = ${at} AND user_input_id IS NOT NULL)))`
          // Outstanding permission/question cards from the discarded suffix must not reach a new session.
          yield* sql`UPDATE attention_requests SET state = 'withdrawn' WHERE task_id = ${target.taskId} AND state = 'open'
            AND (json_extract(payload, '$.threadId') = ${target.threadId} OR id IN (
              SELECT json_extract(content, '$.attentionId') FROM thread_items
              WHERE thread_id = ${target.threadId} AND undone_at = ${at} AND kind = 'question'))`
          const [version] = yield* sql<{
            version: number
          }>`SELECT conversation_version AS version FROM threads WHERE id = ${target.threadId}`
          const revision = yield* change('threads', target.threadId, { conversationVersion: (version?.version ?? 1) + 1 })
          yield* fact({
            projectId: target.projectId,
            aggregateType: 'thread',
            aggregateId: target.threadId,
            revision,
            type: 'thread.turn_undone',
            actorId: input.envelope.actorId,
            commandId: input.envelope.commandId,
            payload: { itemId: input.itemId, from: first.sequence, recovery: input.envelope.commandId },
          })
          yield* indexThread(target.threadId)
          yield* sql`UPDATE turn_undo_recoveries SET state = 'completed' WHERE command_id = ${input.envelope.commandId}`
          return {
            prompt: decoded.map((message) => message.text).join('\n\n'),
            messages: decoded,
            restored: plans.reduce((n, plan) => n + plan.paths.length, 0),
          }
        }),
      })
    }).pipe(
      Effect.onError(() =>
        recoverTurnUndo(target.threadId).pipe(Effect.catchCause((cause) => Effect.logError('Chat undo recovery is pending', cause))),
      ),
    )
  })
