import type { AwayAct, AwayKind, AwaySnapshot, AwayUndo } from '@althar/contracts'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from './Changes'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { IssueChanges } from './IssueChanges'
import { change, timestamp } from './records'
import { words } from './words'

/*
 * What agents did outside their worktrees, across a project (ADR-097): the
 * board's While you were away. Each act is kept once, by what it acted on
 * (`source`), with its task, when, how it is taken back and what that needs,
 * and why it can't be now. Where Althar acts for an agent (a merge on the
 * merge line, a reply, an issue changed at once, a review posted by the
 * person's setting, a task a lead started) it records the act as it goes;
 * what the person does themselves is never here. The list starts from when
 * the person last looked (`away_looks`), and × moves that on.
 */

/** What taking an act back needs, kept beside it. */
export type UndoWith =
  /** A merge: the pull request and the branch it went into, for the task that reverts it. */
  | { readonly way: 'revert'; readonly url: string; readonly name: string; readonly branch: string }
  /** An issue moved: its tracker's connection and the issue, and the status it had. */
  | { readonly way: 'issue'; readonly connectionId: string; readonly ref: string; readonly key: string; readonly status: string }
  /** A comment on a pull request: where it is, to delete it while nobody has replied. */
  | {
      readonly way: 'comment'
      readonly linkUrl: string
      readonly taskId: string
      readonly commentId: string
      readonly number: number
      readonly at: string
      /** A reply in a thread on the change's lines, which the host deletes elsewhere. */
      readonly inThread?: true
    }

export interface ActRecord {
  readonly projectId: string
  readonly taskId: string | null
  readonly threadId: string | null
  readonly kind: AwayKind
  readonly what: string
  /** What it acted on, so it is kept once: `merge:<url>`, `issue:<card>:<entry>`, `comment:<id>`. */
  readonly source: string
  readonly undo?: UndoWith
  /** Why it can't be taken back, where that is known as it is done. */
  readonly cant?: string
  readonly actorId: ActorId
}

const undoOf = (undo: UndoWith | undefined): AwayUndo | null => (undo === undefined ? null : undo.way === 'revert' ? 'revert' : 'undo')

/** Keeps an act, once for what it acted on, and tells watching boards. A second call for the same act changes nothing. */
export const recordAct = (act: ActRecord) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const at = yield* timestamp
    const id = yield* newId(Ids.outsideAct)
    yield* sql`INSERT OR IGNORE INTO outside_acts ${sql.insert({
      id,
      projectId: act.projectId,
      taskId: act.taskId,
      threadId: act.threadId,
      kind: act.kind,
      what: act.what,
      source: act.source,
      undo: undoOf(act.undo),
      undoWith: JSON.stringify(act.undo ?? {}),
      cant: act.cant ?? null,
      state: 'done',
      error: null,
      undoTaskId: null,
      doneAt: at,
      updatedAt: at,
    })}`
    const [made] = yield* sql<{ n: number }>`SELECT changes() AS n`
    if ((made?.n ?? 0) === 0) return
    yield* ledger.notify({ projectId: act.projectId as ProjectId, aggregateType: 'outside_act', aggregateId: id, aggregateRevision: 1 })
  }).pipe(
    // Keeping the act never undoes it: what can't be kept is logged.
    Effect.catchCause((cause) => Effect.logWarning('Could not keep an act outside a worktree', cause)),
  )

/** An act as kept. */
export interface ActRow {
  readonly id: string
  readonly projectId: string
  readonly taskId: string | null
  readonly threadId: string | null
  readonly kind: AwayKind
  readonly what: string
  readonly undo: AwayUndo | null
  readonly undoWith: string
  readonly cant: string | null
  readonly state: AwayAct['state']
  readonly error: string | null
  readonly undoTaskId: string | null
  readonly doneAt: string
}

export const decodeUndo = (row: Pick<ActRow, 'undoWith'>): UndoWith | undefined => {
  try {
    const kept = JSON.parse(row.undoWith) as { readonly way?: unknown }
    return typeof kept.way === 'string' ? (kept as UndoWith) : undefined
  } catch {
    return undefined
  }
}

export const actRow = (actId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<ActRow>`
      SELECT id, project_id, task_id, thread_id, kind, what, undo, undo_with, cant, state, error, undo_task_id, done_at
      FROM outside_acts WHERE id = ${actId}`
    return row
  })

/** Moves an act on: taking it back under way, done, or failed with why; or what keeps it from being taken back now. */
export const settleAct = (
  row: Pick<ActRow, 'id' | 'projectId'>,
  set: {
    readonly state?: AwayAct['state']
    readonly error?: string | null
    readonly cant?: string | null
    readonly undo?: null
    readonly undoTaskId?: string | null
  },
) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger
    const sql = yield* SqlClient.SqlClient
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const revision = yield* change('outside_acts', row.id, { ...set, updatedAt: yield* timestamp })
        yield* ledger.notify({
          projectId: row.projectId as ProjectId,
          aggregateType: 'outside_act',
          aggregateId: row.id,
          aggregateRevision: revision,
        })
      }),
    )
  })

/**
 * A release went out from a repository: each merge into it the board shows,
 * whose revert is still offered, now says what holds it. A revert takes it
 * out of what comes next, never out of what went out.
 */
export const releasedIn = (projectId: string, repository: string, tag: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Effect.serviceOption(Ledger)
    const merges = yield* sql<{ id: string }>`
      SELECT id FROM outside_acts
      WHERE project_id = ${projectId} AND kind = 'merge' AND state = 'done' AND cant IS NULL
        AND json_extract(undo_with, '$.url') LIKE ${`%/${repository}/%`}`
    for (const merge of merges) {
      const revision = yield* change('outside_acts', merge.id, { cant: `Released in ${tag}`, updatedAt: yield* timestamp })
      if (ledger._tag === 'Some')
        yield* ledger.value.notify({
          projectId: projectId as ProjectId,
          aggregateType: 'outside_act',
          aggregateId: merge.id,
          aggregateRevision: revision,
        })
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not say which merges a release holds', cause)))

/** How many acts the board shows at most: the newest. */
export const AWAY_SHOWN = 30

/** A run of tasks a lead started together: one row, "Started 2 tasks", where they came in the same minute from the same task. */
const together = (a: ActRow, b: ActRow) =>
  a.kind === 'start' && b.kind === 'start' && a.taskId === b.taskId && a.doneAt.slice(0, 16) === b.doneAt.slice(0, 16)

const Titled = Schema.Struct({ id: Schema.String, threadId: Schema.String, title: Schema.String })

/** What agents did outside their worktrees in a project since the person last looked there, newest first. */
export const away = (projectId: string, personId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [look] = yield* sql<{ lookedAt: string; seen: number }>`
      SELECT looked_at, seen FROM away_looks WHERE project_id = ${projectId} AND actor_id = ${personId}`
    const looked = look?.lookedAt ?? null
    const rows = yield* sql<ActRow>`
      SELECT id, project_id, task_id, thread_id, kind, what, undo, undo_with, cant, state, error, undo_task_id, done_at
      FROM outside_acts WHERE project_id = ${projectId} AND rowid > ${look?.seen ?? 0}
      ORDER BY rowid DESC LIMIT ${AWAY_SHOWN}`
    const ids = [...new Set(rows.flatMap((row) => [row.taskId, row.undoTaskId].filter((one): one is string => one !== null)))]
    const tasks =
      ids.length === 0
        ? []
        : yield* sql<typeof Titled.Type>`
            SELECT k.id, t.id AS thread_id, k.title FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE ${sql.in('k.id', ids)}`
    const taskOf = (id: string | null) => {
      const found = id === null ? undefined : tasks.find((task) => task.id === id)
      return found === undefined ? null : { taskId: found.id, threadId: found.threadId, title: found.title }
    }
    const acts: Array<AwayAct> = []
    for (const [index, row] of rows.entries()) {
      const before = rows[index - 1]
      if (before !== undefined && together(before, row)) continue
      let n = 1
      while (rows[index + n] !== undefined && together(row, rows[index + n]!)) n += 1
      acts.push({
        id: row.id,
        kind: row.kind,
        what: n > 1 ? `Started ${n} tasks` : row.what,
        at: row.doneAt,
        task: taskOf(row.taskId),
        undo: row.undo,
        cant: row.cant,
        state: row.state,
        error: row.error,
        undoTask: taskOf(row.undoTaskId),
      })
    }
    return { looked, acts } satisfies AwaySnapshot
  })

/** The person has looked: the list starts again from now. */
export const clearAway = (projectId: string, personId: ActorId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const at = yield* timestamp
    // Up to the last act there is: one kept as they clear it, after it, still shows.
    yield* sql`
      INSERT INTO away_looks (project_id, actor_id, looked_at, seen)
      VALUES (${projectId}, ${personId}, ${at}, (SELECT coalesce(max(rowid), 0) FROM outside_acts WHERE project_id = ${projectId}))
      ON CONFLICT (project_id, actor_id) DO UPDATE SET looked_at = excluded.looked_at, seen = excluded.seen`
    yield* ledger.notify({ projectId: projectId as ProjectId, aggregateType: 'outside_act', aggregateId: projectId, aggregateRevision: 1 })
  })

/** A task to start, as a revert is one: Auto's, toward the branch the merge went into. */
export interface RevertTask {
  readonly projectId: string
  readonly title: string
  readonly description: string
  readonly toward: string
}

/**
 * Takes back an act the way its row says (ADR-097): a merge by a task that
 * reverts it, which `start` starts; an issue moved back through its tracker,
 * to the status it had; a lead's comment deleted, unless someone wrote after
 * it, which the row then says in its place. How it went, the row says too.
 */
export const undoAct = <R>(
  actId: string,
  start: (task: RevertTask) => Effect.Effect<{ readonly id: string }, unknown, R>,
  agentName: (agentId: string) => string = (agentId) => agentId,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const row = yield* actRow(actId)
    if (row === undefined) return yield* new NotFound({ kind: 'act', id: actId })
    if (row.state === 'undoing' || row.state === 'undone') return
    const how = decodeUndo(row)
    if (how === undefined || row.undo === null) return yield* new NotFound({ kind: 'way to take it back', id: actId })
    const failed = (error: unknown) => settleAct(row, { state: 'failed', error: words(error, agentName).message })
    switch (how.way) {
      case 'revert': {
        const started = yield* Effect.result(
          start({
            projectId: row.projectId,
            title: `Revert ${how.name}`,
            description: `Revert the merge of ${how.name} (${how.url}) into ${how.branch}: a revert of its merge commit, on a branch of its own, in a pull request into ${how.branch}. Nothing else.`,
            toward: how.branch,
          }),
        )
        if (started._tag === 'Failure') return yield* failed(started.failure)
        return yield* settleAct(row, { state: 'undoing', error: null, undoTaskId: started.success.id })
      }
      case 'issue': {
        const [home] = yield* sql<{ id: string }>`
          SELECT id FROM threads WHERE project_id = ${row.projectId} AND kind = 'coordinator' AND owner_actor_id = ${instance.personId}`
        const threadId = row.threadId ?? home?.id
        if (threadId === undefined) return yield* new NotFound({ kind: 'thread', id: row.projectId })
        const moved = yield* Effect.result(
          (yield* IssueChanges).propose({
            projectId: row.projectId as ProjectId,
            threadId,
            issues: [{ target: { connectionId: how.connectionId, ref: how.ref }, change: { status: how.status } }],
            direct: true,
            by: 'althar',
            actorId: instance.personId,
          }),
        )
        if (moved._tag === 'Failure') return yield* failed(moved.failure)
        const card = moved.success.card
        if (card !== null && card.state === 'failed') return yield* settleAct(row, { state: 'failed', error: card.error ?? '' })
        if (card === null && moved.success.left.length > 0)
          return yield* settleAct(row, { state: 'failed', error: moved.success.left.join(' ') })
        return yield* settleAct(row, { state: 'undone', error: null })
      }
      case 'comment': {
        const gone = yield* Effect.result(
          (yield* Changes).unpost(how.taskId, { url: how.linkUrl, commentId: how.commentId, at: how.at, inThread: how.inThread === true }),
        )
        if (gone._tag === 'Failure') return yield* failed(gone.failure)
        if ('replied' in gone.success) return yield* settleAct(row, { cant: `${gone.success.replied} replied`, undo: null })
        return yield* settleAct(row, { state: 'undone', error: null })
      }
    }
  })
