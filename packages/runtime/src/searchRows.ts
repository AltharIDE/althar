import { basename, isAbsolute, sep } from 'node:path'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * Each task's row of text in the store's full-text index (ADR-035,
 * `task_search_rows`), which Search.ts finds tasks by: its title; what the
 * person asked of it, as they asked it and in their later messages to its
 * lead; what its lead reported finishing a step and what it said it built;
 * its pull requests' numbers and its issue's key; its branches; and the files
 * its lead changed, as its tool calls name them.
 *
 * A row is written from what the store holds of the task, whenever one of
 * those changes: as the task is made or renamed, as the person writes to it,
 * as a step reports, and as a pull request, an issue or a new branch is
 * linked (`indexTask`, called where those are written, in the same
 * transaction). The files its lead changed are read again with each of
 * those, so they stand as of its last report. Tasks made before the index
 * get their rows once, in the background, as the runtime starts
 * (`backfill`). Nothing reads git or a worktree.
 */

/** How much of each kind of text a row keeps: enough to be found by, never a whole log pasted in. */
const KEPT = 20_000

/** How many files a row names, most recently changed first. */
const FILES_KEPT = 400

const keep = (parts: ReadonlyArray<string>) => parts.join('\n').slice(0, KEPT)

/** A file a tool call names, as the task knows it: inside one of its worktrees, from there; with several, under its folder's name. */
export const fileOf = (path: string, worktrees: ReadonlyArray<string>): string | null => {
  if (!isAbsolute(path)) return path
  // A worktree's own folder ends at `/`, or at this system's separator (`\` on Windows); what follows is written with `/`.
  const rootOf = (worktree: string) => worktree.replace(/[\\/]+$/, '')
  const within = worktrees.find((worktree) => [`${rootOf(worktree)}/`, `${rootOf(worktree)}${sep}`].some((root) => path.startsWith(root)))
  if (within === undefined) return null
  const relative = path
    .slice(rootOf(within).length + 1)
    .split(sep)
    .join('/')
  return worktrees.length > 1 ? `${basename(within)}/${relative}` : relative
}

/**
 * Writes a task's row from what the store holds of it now: one upsert, or
 * nothing where it holds the same already. Nothing for a task that isn't
 * there.
 */
export const indexTask = Effect.fn('Search.indexTask')(function* (taskId: string) {
  const sql = yield* SqlClient.SqlClient
  const [task] = yield* sql<{
    projectId: string
    title: string
    description: string
    request: string | null
    createdAt: string
  }>`SELECT project_id, title, description, request, created_at FROM tasks WHERE id = ${taskId}`
  if (task === undefined) return
  // What the person said to its lead: never what Althar or the coordinator passed on, nor what they took back.
  const asked = yield* sql<{ body: string; at: string }>`
    SELECT u.body, u.accepted_at AS at FROM user_inputs u
    JOIN threads t ON t.id = u.thread_id AND t.kind = 'task'
    JOIN actors a ON a.id = u.author_actor_id AND a.kind = 'person'
    WHERE t.task_id = ${taskId} AND u.state IN ('queued', 'delivered')
      AND NOT EXISTS (SELECT 1 FROM thread_items i WHERE i.user_input_id = u.id AND i.undone_at IS NOT NULL)
    ORDER BY u.sequence`
  const reports = yield* sql<{ summary: string | null; built: string | null; at: string }>`
    SELECT json_extract(i.content, '$.summary') AS summary, json_extract(i.content, '$.built') AS built, i.created_at AS at
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE t.task_id = ${taskId} AND i.undone_at IS NULL AND i.kind = 'step_result' AND json_extract(i.content, '$.step') IN ('implement', 'settle')
    ORDER BY i.created_at, i.sequence`
  const links = yield* sql<{ key: string; ref: string; at: string }>`
    SELECT key, ref, created_at AS at FROM external_links WHERE task_id = ${taskId} ORDER BY created_at`
  // Its branches once made: a plain task's has none until its lead changes the repository.
  const branches = yield* sql<{ branch: string }>`
    SELECT branch FROM workspaces WHERE task_id = ${taskId} AND branched_at IS NOT NULL
    UNION SELECT c.branch FROM repository_changes c JOIN change_sets s ON s.id = c.change_set_id WHERE s.task_id = ${taskId}`
  const worktrees = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
  // What its agents changed, as their tool calls name the files: read in the store, in SQLite's own JSON.
  const touched = yield* sql<{ path: string }>`
    SELECT json_extract(l.value, '$.path') AS path FROM threads t
    JOIN thread_items i ON i.thread_id = t.id AND i.kind = 'tool_call', json_each(i.content, '$.locations') l
    WHERE t.task_id = ${taskId} AND i.undone_at IS NULL AND json_extract(i.content, '$.toolKind') IN ('edit', 'delete', 'move')
      AND json_extract(i.content, '$.declined') IS NOT 1 AND json_type(l.value, '$.path') = 'text'
    GROUP BY 1 ORDER BY max(i.created_at) DESC`
  const files = new Set<string>()
  for (const { path } of touched) {
    const file = fileOf(
      path,
      worktrees.map((worktree) => worktree.path),
    )
    if (file !== null && files.size < FILES_KEPT) files.add(file)
  }
  const row = {
    title: task.title,
    // What they asked for, its description where that says more, then what they wrote after.
    asked: keep(
      [
        task.request ?? '',
        (task.request ?? '').includes(task.description) ? '' : task.description,
        ...asked.map((input) => input.body),
      ].filter((text) => text.trim() !== ''),
    ),
    summaries: keep(reports.flatMap((report) => [report.summary ?? '', report.built ?? '']).filter((text) => text.trim() !== '')),
    refs: keep([...new Set([...links.flatMap((link) => [link.key, link.ref]), ...branches.map((one) => one.branch)])]),
    files: keep([...files]),
    // The latest of what it is found by: kept, so the same row written again later is no newer.
    changedAt: [task.createdAt, ...asked.map((one) => one.at), ...reports.map((one) => one.at), ...links.map((one) => one.at)].reduce(
      (latest, at) => (at > latest ? at : latest),
    ),
  }
  const [was] = yield* sql<typeof row>`
    SELECT title, asked, summaries, refs, files, changed_at FROM task_search_rows WHERE task_id = ${taskId}`
  if (was !== undefined && (Object.keys(row) as ReadonlyArray<keyof typeof row>).every((key) => was[key] === row[key])) return
  yield* sql`
    INSERT INTO task_search_rows ${sql.insert({ taskId, projectId: task.projectId, ...row })}
    ON CONFLICT (task_id) DO UPDATE SET title = excluded.title, asked = excluded.asked, summaries = excluded.summaries,
      refs = excluded.refs, files = excluded.files, changed_at = excluded.changed_at`
})

/** Writes the row of the task a thread is of, its own or a step's; nothing for the coordinator's. */
export const indexThread = Effect.fn('Search.indexThread')(function* (threadId: string) {
  const sql = yield* SqlClient.SqlClient
  const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
  if (thread?.taskId != null) yield* indexTask(thread.taskId)
})

/** How many tasks are written in one transaction as the index is filled. */
const BATCH = 50

/** Writes a row for every task that has none: those made before the index, once. */
export const backfill = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (;;) {
    const missing = yield* sql<{ id: string }>`
      SELECT k.id FROM tasks k WHERE NOT EXISTS (SELECT 1 FROM task_search_rows r WHERE r.task_id = k.id) LIMIT ${BATCH}`
    if (missing.length === 0) return
    yield* sql.withTransaction(Effect.forEach(missing, (task) => indexTask(task.id), { discard: true }))
    // Whatever else waits on the store goes between batches.
    yield* Effect.yieldNow
  }
})

/** Fills the index in the background as the runtime starts. */
export const fillIndex = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Effect.forkScoped(
      backfill.pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchCause((cause) => Effect.logWarning('Could not index the tasks made before search', cause)),
      ),
    )
  }),
)
