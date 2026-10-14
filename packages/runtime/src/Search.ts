import { basename, isAbsolute } from 'node:path'

import type { FoundPart, FoundTask, TaskPhase } from '@althar/contracts'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * Finding a task by what it was about (ADR-035). Each task has one row of
 * text in the store (`task_search_rows`), which SQLite's full-text index
 * reads: its title; what the person asked of it, as they asked it and in
 * their later messages to its lead; what its lead reported finishing a step
 * and what it said it built; its pull requests' numbers and its issue's key;
 * its branches; and the files its lead changed, as its tool calls name them.
 *
 * A row is written from what the store holds of the task, whenever one of
 * those changes: as the task is made or renamed, as the person writes to it,
 * as a step reports, and as a pull request, an issue or a new branch is
 * linked (`indexTask`, called where those are written, in the same
 * transaction). The files its lead changed are read again with each of
 * those, so they stand as of its last report. Tasks made before the index
 * get their rows once, in the background, as the runtime starts
 * (`backfill`). Nothing reads git or a worktree.
 *
 * A search finds the tasks holding every word typed, each as the start of a
 * word ("retr" finds "retry"; nothing is stemmed, so "fix" also finds
 * "fixes"), best first by bm25 with the title counting most, recent first
 * among equals; in one project, or in every one still in the window.
 */

/** How much of each kind of text a row keeps: enough to be found by, never a whole log pasted in. */
const KEPT = 20_000

/** How many files a row names, most recently changed first. */
const FILES_KEPT = 400

/** The most words a search reads. */
const WORDS = 12

/** Marks around a matched word, in what the index hands back; characters nobody types. */
const OPEN = '\u0002'
const CLOSE = '\u0003'

/** Each column's weight in the ranking, in the index's order: title, asked, summaries, refs, files. */
const WEIGHTS = [10, 4, 3, 6, 2] as const

const keep = (parts: ReadonlyArray<string>) => parts.join('\n').slice(0, KEPT)

/** A file a tool call names, as the task knows it: inside one of its worktrees, from there; with several, under its folder's name. */
export const fileOf = (path: string, worktrees: ReadonlyArray<string>): string | null => {
  if (!isAbsolute(path)) return path
  const within = worktrees.find((worktree) => path.startsWith(`${worktree.replace(/\/+$/, '')}/`))
  if (within === undefined) return null
  const relative = path.slice(within.replace(/\/+$/, '').length + 1)
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
    WHERE t.task_id = ${taskId} AND u.state IN ('queued', 'delivered') ORDER BY u.sequence`
  const reports = yield* sql<{ summary: string | null; built: string | null; at: string }>`
    SELECT json_extract(i.content, '$.summary') AS summary, json_extract(i.content, '$.built') AS built, i.created_at AS at
    FROM thread_items i JOIN threads t ON t.id = i.thread_id
    WHERE t.task_id = ${taskId} AND i.kind = 'step_result' AND json_extract(i.content, '$.step') IN ('implement', 'settle')
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
    WHERE t.task_id = ${taskId} AND json_extract(i.content, '$.toolKind') IN ('edit', 'delete', 'move')
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

/**
 * What a person typed, as the index reads it: each word as the start of a
 * word, every one of them needed. Each is quoted, so nothing typed is read
 * as the index's own syntax; a word with no letter or digit in it finds
 * nothing and is left out. Null where nothing is left.
 */
export const matchOf = (text: string): string | null => {
  const words = text
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, WORDS)
  return words.length === 0 ? null : words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(' ')
}

/** Words as the index splits them: letters and digits, lower case, accents set aside. */
const tokensOf = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '')

/** Whether a title holds every word typed, each as the start of one of its words. */
export const inTitle = (text: string, title: string) => {
  const words = tokensOf(title)
  return tokensOf(text).every((typed) => words.some((word) => word.startsWith(typed)))
}

/** What the index marked, as parts: what matched is `hit`. */
export const partsOf = (marked: string): ReadonlyArray<FoundPart> =>
  marked
    .split(OPEN)
    .flatMap((piece, at) => {
      if (at === 0) return [{ text: piece, hit: false }]
      const [hit = '', ...rest] = piece.split(CLOSE)
      return [
        { text: hit, hit: true },
        { text: rest.join(''), hit: false },
      ]
    })
    .filter((part) => part.text !== '')

interface Found {
  readonly rowId: number
  readonly taskId: string
  readonly threadId: string
  readonly projectId: string
  readonly title: string
  readonly slug: string
  readonly state: string
  readonly changedAt: string
  readonly planState: string | null
  readonly startsAt: string | null
  readonly waiting: number
  readonly runState: string | null
  readonly held: number
  readonly pullRequest: string | null
  readonly asked: string | null
  readonly summaries: string | null
  readonly refs: string | null
  readonly files: string | null
}

/*
 * Where a found task stands, as its card's phase is worked out (Queries'
 * `cardFor`), from the store and the agents at work: what git would add
 * (commits after a merged pull request, a conflict being resolved) isn't
 * read for a search.
 */
export const phaseOf = (
  task: Pick<Found, 'taskId' | 'state' | 'planState' | 'startsAt' | 'waiting' | 'runState' | 'held'>,
  working: ReadonlySet<string>,
): TaskPhase => {
  if (task.state === 'abandoned') return 'settled'
  if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
  if (task.waiting > 0) return 'waiting'
  if (working.has(task.taskId)) return 'running'
  if (task.state === 'done') return 'settled'
  if (task.runState === 'succeeded') return 'ready'
  if (task.runState !== null && task.runState !== 'running') return 'stopped'
  // Held for a reset, it carries on on its own.
  return task.held > 0 ? 'running' : 'stopped'
}

export interface SearchInput {
  /** One project's tasks; every project still in the window without it. */
  readonly projectId?: string
  readonly text: string
  readonly limit?: number
}

/**
 * The tasks that hold what was typed, best first; with nothing typed, the
 * most recently changed. `working` is the tasks an agent is on now, as the
 * sessions say.
 */
export const findTasks = Effect.fn('Search.findTasks')(function* (input: SearchInput, working: ReadonlySet<string>) {
  const sql = yield* SqlClient.SqlClient
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50))
  const match = matchOf(input.text)
  if (match === null && input.text.trim() !== '') return []
  const scoped = input.projectId === undefined ? sql`1 = 1` : sql`r.project_id = ${input.projectId}`
  // The tasks still in the window it finds, best first, then what is shown of them: so the rest is read only for those shown.
  const live = sql`JOIN tasks k ON k.id = r.task_id JOIN projects o ON o.id = k.project_id AND o.archived_at IS NULL`
  const recency = sql`max(r.changed_at, coalesce(k.settled_at, ''))`
  const ranked =
    match === null
      ? yield* sql<{ id: number }>`
          SELECT r.id FROM task_search_rows r ${live} WHERE ${scoped} ORDER BY ${recency} DESC, r.id DESC LIMIT ${limit}`
      : yield* sql<{ id: number }>`
          WITH hits AS (
            SELECT r.id, ${recency} AS changed_at,
              bm25(task_search, ${WEIGHTS[0]}, ${WEIGHTS[1]}, ${WEIGHTS[2]}, ${WEIGHTS[3]}, ${WEIGHTS[4]}) AS score
            FROM task_search s JOIN task_search_rows r ON r.id = s.rowid ${live}
            WHERE task_search MATCH ${match} AND ${scoped})
          -- How good each is beside the best, in tenths: equals, the most recently changed first.
          SELECT id FROM hits ORDER BY coalesce(round(score / nullif(min(score) OVER (), 0), 1), 1) DESC, changed_at DESC, id DESC
          LIMIT ${limit}`
  if (ranked.length === 0) return []
  const ids = ranked.map((row) => row.id)
  // Where each stands, read as its card does; its latest pull request; and what matched, marked.
  const standing = sql`
    r.id AS row_id, t.id AS thread_id, k.id AS task_id, k.project_id, k.title, k.slug, k.state, ${recency} AS changed_at,
    p.state AS plan_state, p.starts_at,
    (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') AS waiting,
    n.state AS run_state,
    (SELECT count(*) FROM node_attempts a JOIN nodes d ON d.id = a.node_id JOIN workflow_executions e ON e.id = d.execution_id
      WHERE e.run_id = n.id AND a.state = 'held') AS held,
    (SELECT l.key FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change' ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1)
      AS pull_request`
  const joins = sql`
    ${live}
    JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
    LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
    LEFT JOIN runs n ON n.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)`
  const read =
    match === null
      ? yield* sql<Found>`
          SELECT ${standing}, NULL AS asked, NULL AS summaries, NULL AS refs, NULL AS files
          FROM task_search_rows r ${joins} WHERE r.id IN ${sql.in(ids)}`
      : yield* sql<Found>`
          SELECT ${standing},
            snippet(task_search, 1, ${OPEN}, ${CLOSE}, '…', 12) AS asked,
            snippet(task_search, 2, ${OPEN}, ${CLOSE}, '…', 12) AS summaries,
            snippet(task_search, 3, ${OPEN}, ${CLOSE}, '…', 12) AS refs,
            snippet(task_search, 4, ${OPEN}, ${CLOSE}, '…', 12) AS files
          FROM task_search s JOIN task_search_rows r ON r.id = s.rowid ${joins}
          WHERE task_search MATCH ${match} AND s.rowid IN ${sql.in(ids)}`
  const rows = ids.flatMap((id) => read.filter((row) => row.rowId === id))
  return rows.map((row): FoundTask => ({
    taskId: row.taskId,
    threadId: row.threadId,
    projectId: row.projectId,
    title: row.title,
    slug: row.slug,
    phase: phaseOf(row, working),
    state: row.state,
    pullRequest: row.pullRequest,
    changedAt: row.changedAt,
    // What matched besides its title, in the order a person reads it by: what was asked, what was reported, its links, its files.
    // Not where its title holds every word typed already: its branch, named after it, would only say it again.
    matched: (() => {
      if (inTitle(input.text, row.title)) return null
      const marked = [row.asked, row.summaries, row.refs, row.files].find((one): one is string => one?.includes(OPEN) === true)
      if (marked === undefined) return null
      const parts = partsOf(marked)
      // Nor where all that matched is the number of the pull request it shows.
      const number = row.pullRequest?.replace(/\D/g, '')
      const hits = parts.flatMap((part) => (part.hit ? [part.text.replace(/\D/g, '')] : []))
      return marked === row.refs && number !== undefined && hits.every((hit) => hit === number) ? null : [...parts]
    })(),
  }))
})

/** Where a found task stands, in the coordinator's words. */
const standingWords = (task: FoundTask) => {
  switch (task.phase) {
    case 'planned':
      return 'planned, starting soon'
    case 'held':
      return 'planned, held'
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting on the person'
    case 'ready':
      return 'ready'
    case 'stopped':
      return 'stopped'
    case 'settled':
      return task.state === 'abandoned' ? 'abandoned' : 'finished'
  }
}

/** Found tasks as the coordinator's `find_tasks` says them: a line each, and what matched under it. */
export const foundWords = (text: string, tasks: ReadonlyArray<FoundTask>) =>
  tasks.length === 0
    ? `No task in this project matches “${text.trim()}”.`
    : tasks
        .map((task) => {
          const head = `- ${task.slug}: ${task.title} (${standingWords(task)}${task.pullRequest === null ? '' : `, PR ${task.pullRequest}`}; id ${task.taskId})`
          const matched = task.matched?.map((part) => part.text).join('')
          return matched === undefined ? head : `${head}\n  “${matched.replace(/\s+/g, ' ').trim()}”`
        })
        .join('\n')
