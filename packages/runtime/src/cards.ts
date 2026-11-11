import type { ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { change } from './records'
import { addItem } from './threads'

/*
 * Each task has one card in its project's coordinator thread
 * (docs/architecture/04, task events): its plan before it starts, then where
 * it stands. Althar posts it, never an agent. The card's item holds only
 * the task's id; what it shows is read from the task, its plan and its run,
 * so touching the item tells watching clients to read it again.
 */

/** The coordinator thread's card for a task, if it has one. */
const cardOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [card] = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
      SELECT i.id, i.project_id, i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id
      WHERE t.kind = 'coordinator' AND i.kind = 'task' AND json_extract(i.content, '$.taskId') = ${taskId}`
    return card
  })

/** Posts the task's card in its project's coordinator thread, unless it is there already. */
export const postCard = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if ((yield* cardOf(taskId)) !== undefined) return yield* touchCard(taskId)
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' LIMIT 1`
    if (thread !== undefined) yield* addItem({ projectId, threadId: thread.id }, 'task', { taskId })
  })

/**
 * A chat on Scratch moves to the board as soon as it takes a worktree or an
 * output (a task is a conversation plus parts, "Chats and Scratch"), looked at
 * where one can take them (its first write, a pull request, a review drafted): a branch
 * of its own, a pull request, or a review it drafted, since it was put there;
 * said in its thread. Nothing moves back to Scratch by itself, and one the
 * person put back stays until it takes something new.
 */
export const offScratch = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // Most tasks are on the board: one look at the task's own row, before anything that reads more.
    const [shelf] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${taskId}`
    if (shelf?.shelf !== 'scratch') return
    const [chat] = yield* sql<{ projectId: ProjectId; threadId: string | null; branched: number; linked: number; drafted: number }>`
      WITH shelved AS (
        SELECT coalesce(max(e.occurred_at), '') AS at FROM record_events e
        WHERE e.aggregate_type = 'task' AND e.aggregate_id = ${taskId} AND e.type = 'task.shelved')
      SELECT k.project_id, (SELECT t.id FROM threads t WHERE t.task_id = k.id AND t.kind = 'task') AS thread_id,
        EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = k.id AND w.access = 'write' AND w.branched_at > shelved.at) AS branched,
        EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind IN ('change', 'review') AND l.created_at > shelved.at) AS linked,
        EXISTS (SELECT 1 FROM review_drafts d WHERE d.task_id = k.id AND d.created_at > shelved.at) AS drafted
      FROM tasks k, shelved WHERE k.id = ${taskId} AND k.shelf = 'scratch'`
    if (chat === undefined || (chat.branched === 0 && chat.linked === 0 && chat.drafted === 0)) return
    yield* sql`UPDATE tasks SET shelf = NULL, revision = revision + 1 WHERE id = ${taskId}`
    yield* leftAsides(chat.projectId, taskId)
    if (chat.threadId !== null)
      yield* addItem({ projectId: chat.projectId, threadId: chat.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title:
          chat.branched === 1
            ? 'On the board now: it took a worktree.'
            : chat.drafted === 1
              ? 'On the board now: it drafted a review.'
              : 'On the board now: it has a pull request.',
        role: 'aside',
      })
  })

/**
 * A chat that left Scratch for the board, said in one line in the
 * coordinator's conversation, where its asides sit: so the conversation keeps
 * a record of it, as of a task it started.
 */
export const leftAsides = (projectId: ProjectId, taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator' LIMIT 1`
    const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${taskId}`
    if (thread === undefined || task === undefined) return
    yield* addItem({ projectId, threadId: thread.id }, 'notice', {
      source: 'runtime',
      severity: 'info',
      title: `An aside became a task: ${task.title}`,
    })
  })

/** Tells watching clients the task's card changed, so they read it again. */
export const touchCard = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const card = yield* cardOf(taskId)
    if (card === undefined) return
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // The item itself doesn't change; its revision moves on, so the feed says it did.
        const revision = yield* change('thread_items', card.id, { content: card.content })
        yield* ledger.notify({ projectId: card.projectId, aggregateType: 'thread_item', aggregateId: card.id, aggregateRevision: revision })
      }),
    )
  })

/**
 * Tells watching clients the task's card and its own thread changed: a task
 * that waits for a place shows who holds them in its thread (ADR-032), which
 * the coordinator's card alone doesn't tell an open thread to read again.
 */
export const touchTask = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    yield* touchCard(taskId)
    const [task] = yield* sql<{ projectId: ProjectId; revision: number }>`SELECT project_id, revision FROM tasks WHERE id = ${taskId}`
    if (task !== undefined)
      yield* ledger.notify({ projectId: task.projectId, aggregateType: 'task', aggregateId: taskId, aggregateRevision: task.revision })
  })
