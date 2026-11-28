import type { FoundPart, FoundTask, TaskPhase } from '@althar/contracts'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { asideIn, issueCardsWaiting, keepWaitsIn } from './kinds'
import { DRAFTING_MS, stillDrafting } from './needsYou'

/*
 * Finding a task by what it was about (ADR-035), by its row in the store's
 * full-text index (`searchRows.ts` writes it). A search finds the tasks
 * holding every word typed, each as the start of a word ("retr" finds
 * "retry"; nothing is stemmed, so "fix" also finds "fixes"), best first by
 * bm25 with the title counting most, recent first among equals; in one
 * project, or in every one still in the window.
 */

/** The most words a search reads. */
const WORDS = 12

/** Marks around a matched word, in what the index hands back; characters nobody types. */
const OPEN = '\u0002'
const CLOSE = '\u0003'

/** Each column's weight in the ranking, in the index's order: title, asked, summaries, refs, files. */
const WEIGHTS = [10, 4, 3, 6, 2] as const

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
  /** When it was made: a task only drafted is given a moment for its plan to come. */
  readonly createdAt?: string
  /** Whether a turn covers its making, and whether that turn is still open: as its card reads them. */
  readonly madeInTurn?: number
  readonly madeInOpenTurn?: number
  /** When the person kept it for later, while it is. */
  readonly keptAt?: string | null
  readonly changedAt: string
  readonly planState: string | null
  readonly startsAt: string | null
  readonly waiting: number
  /** Drafts of its review that wait for the person. */
  readonly drafted: number
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
  task: Pick<Found, 'taskId' | 'state' | 'planState' | 'startsAt' | 'waiting' | 'runState' | 'held'> &
    Partial<Pick<Found, 'drafted' | 'keptAt' | 'createdAt' | 'madeInTurn' | 'madeInOpenTurn'>>,
  working: ReadonlySet<string>,
  now?: number,
  within: number = DRAFTING_MS,
): TaskPhase => {
  const phase = readyOrNot(task, working, now, within)
  // Finished and kept for later by the person, as its card says.
  return phase === 'ready' && task.keptAt != null ? 'kept' : phase
}

const readyOrNot = (
  task: Pick<Found, 'taskId' | 'state' | 'planState' | 'startsAt' | 'waiting' | 'runState' | 'held'> &
    Partial<Pick<Found, 'drafted' | 'createdAt' | 'madeInTurn' | 'madeInOpenTurn'>>,
  working: ReadonlySet<string>,
  now: number | undefined,
  within: number,
): TaskPhase => {
  if (task.state === 'abandoned') return 'settled'
  if (task.planState === 'proposed') return task.startsAt === null ? 'held' : 'planned'
  if (task.waiting > 0) return 'waiting'
  if (working.has(task.taskId)) return 'running'
  // Drafted with no plan yet, within its moment and not after the turn that made it ended: off the board, as its card is.
  if (
    task.state === 'draft' &&
    task.runState === null &&
    now !== undefined &&
    stillDrafting(task.createdAt ?? null, now, within) &&
    ((task.madeInOpenTurn ?? 0) === 1 || (task.madeInTurn ?? 0) === 0)
  )
    return 'drafting'
  // A review has no run: drafted, it is the person's to post, as its card says.
  if ((task.drafted ?? 0) > 0 && task.state === 'open') return 'ready'
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
 * What `phaseOf` reads of the task `k`, as SQL: its columns, over the joins
 * that go with them, of its coordinator's thread (`ch`), its plan (`p`) and
 * its latest run (`n`).
 */
export const phaseRead = (sql: SqlClient.SqlClient) => ({
  columns: sql`
    k.state, k.created_at,
    -- Kept, unless a pull request of its own is open or commits wait for Ship, as its card says.
    CASE WHEN ${sql.unsafe(keepWaitsIn('k'))} THEN NULL ELSE k.kept_at END AS kept_at,
    -- Only the coordinator's own turn, which is the one that drafts a task: a lead's turn on another says nothing of its plan.
    EXISTS (SELECT 1 FROM turn_deliveries d
      WHERE d.thread_id = ch.id AND d.requested_at <= k.created_at
        AND coalesce(d.ended_at, '9999') >= k.created_at) AS made_in_turn,
    EXISTS (SELECT 1 FROM turn_deliveries d
      WHERE d.thread_id = ch.id AND d.requested_at <= k.created_at AND d.ended_at IS NULL) AS made_in_open_turn,
    p.state AS plan_state, p.starts_at,
    (SELECT count(*) FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open') + ${sql.unsafe(issueCardsWaiting('k'))} AS waiting,
    (SELECT count(*) FROM review_drafts v WHERE v.task_id = k.id AND v.state IN ('pending', 'failed', 'uncertain')) AS drafted,
    n.state AS run_state,
    (SELECT count(*) FROM node_attempts a JOIN nodes d ON d.id = a.node_id JOIN workflow_executions e ON e.id = d.execution_id
      WHERE e.run_id = n.id AND a.state = 'held') AS held`,
  joins: sql`
    LEFT JOIN threads ch ON ch.id = (SELECT h.id FROM threads h WHERE h.project_id = k.project_id AND h.kind = 'coordinator' LIMIT 1)
    LEFT JOIN task_plans p ON p.id = (SELECT id FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1)
    LEFT JOIN runs n ON n.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)`,
})

/** `phaseOf` as of now, with how long a draft stays off the board: `working` is the tasks an agent is on. */
export const phasesNow = Effect.fn('Search.phasesNow')(function* () {
  const config = yield* RuntimeConfig
  const now = yield* Clock.currentTimeMillis
  // How long a draft stays off the board, as its card reads it (DRAFTING_MS unless a test says otherwise).
  const draftingMs = Duration.toMillis(config.drafting ?? Duration.millis(DRAFTING_MS))
  return (task: Parameters<typeof phaseOf>[0], working: ReadonlySet<string>) => phaseOf(task, working, now, draftingMs)
})

/**
 * The tasks that hold what was typed, best first; with nothing typed, the
 * most recently changed. `working` is the tasks an agent is on now, as the
 * sessions say.
 */
export const findTasks = Effect.fn('Search.findTasks')(function* (input: SearchInput, working: ReadonlySet<string>) {
  const sql = yield* SqlClient.SqlClient
  const phaseNow = yield* phasesNow()
  const phase = phaseRead(sql)
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
    r.id AS row_id, t.id AS thread_id, k.id AS task_id, k.project_id, k.title, k.slug, ${recency} AS changed_at, ${phase.columns},
    (SELECT l.key FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change' ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1)
      AS pull_request`
  const joins = sql`
    ${live}
    JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
    ${phase.joins}`
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
    phase: phaseNow(row, working),
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
    case 'drafting':
      return 'drafted, its plan not proposed yet'
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
    case 'kept':
      return 'kept for later'
    case 'stopped':
      return 'stopped'
    case 'settled':
      return task.state === 'abandoned' ? 'abandoned' : 'finished'
  }
}

/** Which of these tasks are asides: chats on Scratch (`tasks.shelf`), not tasks, which `find_tasks` says they are. */
export const asidesAmong = (taskIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (taskIds.length === 0) return new Set<string>()
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string }>`
      SELECT k.id FROM tasks k WHERE k.id IN ${sql.in(taskIds)} AND ${sql.unsafe(asideIn('k'))}`
    return new Set(rows.map((row) => row.id))
  })

/** What more is said of an aside by where it stands: never ready or planned, as it waits on no one to be finished. */
const ASIDE_STANDS: Partial<Record<TaskPhase, string>> = {
  running: ', its agent at it',
  waiting: ', waiting on the person',
  kept: ', kept for later',
  stopped: ', stopped',
}

/** Where a found aside stands. */
const asideWords = (task: FoundTask) =>
  task.phase === 'settled' ? 'an aside, cleared' : `an aside on Scratch, a chat rather than a task${ASIDE_STANDS[task.phase] ?? ''}`

/** Found tasks as the coordinator's `find_tasks` says them: a line each, and what matched under it; an aside said to be one. */
export const foundWords = (
  text: string,
  tasks: ReadonlyArray<FoundTask>,
  more: (task: FoundTask) => string | undefined = () => undefined,
  asides: ReadonlySet<string> = new Set(),
) =>
  tasks.length === 0
    ? `No task in this project matches “${text.trim()}”.`
    : tasks
        .map((task) => {
          const standing = asides.has(task.taskId) ? asideWords(task) : standingWords(task)
          const head = `- ${task.slug}: ${task.title} (${standing}${task.pullRequest === null ? '' : `, PR ${task.pullRequest}`}; id ${task.taskId})`
          const matched = task.matched?.map((part) => part.text).join('')
          const lines = [head, ...(matched === undefined ? [] : [`  “${matched.replace(/\s+/g, ' ').trim()}”`]), more(task)]
          return lines.filter((line) => line !== undefined).join('\n')
        })
        .join('\n')
