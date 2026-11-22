import type { FinderQuery, SearchDocument, SearchDocuments } from '@althar/contracts'
import { Database } from '@althar/persistence-sqlite'
import { Cause, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { matchOf, phaseRead, phasesNow } from './Search'

const sources = {
  task: 'tasks',
  link: 'external_links',
  note: 'project_notes',
  conversation: 'threads',
  said: 'thread_items',
} as const
type Source = keyof typeof sources
const isSource = (value: string): value is Source => Object.hasOwn(sources, value)

const BATCH = 32
const RESULTS = 48

export const updateFinder = Effect.fn('Finder.index')(function* () {
  const sql = yield* SqlClient.SqlClient
  const reader = yield* Database.ReadLane
  const dirty = yield* reader.read(sql<{ source: string; sourceId: string }>`
    SELECT source, source_id FROM finder_dirty ORDER BY rowid LIMIT ${BATCH}`)

  const replace = (source: Source, ids: readonly string[]) =>
    Effect.gen(function* () {
      // Read the source in the same transaction that acknowledges the dirty keys.
      // A concurrent edit either belongs to this batch or leaves a key behind.
      yield* sql`DELETE FROM finder_rows WHERE source = ${source} AND ${sql.in('source_id', ids)}`
      yield* sql`
      INSERT INTO finder_rows (source, source_id, kind, project_id, thread_id, task_id, item_id, title, body, ref, url, changed_at, state)
      SELECT ${source}, source_id, ${source === 'link' ? sql`kind` : sql`${source}`}, project_id, thread_id, task_id, item_id,
        substr(title, 1, 16000), substr(body, 1, 16000), ref, url, changed_at, state
      FROM ${sql(`finder_${source}_source`)} WHERE ${sql.in('source_id', ids)} AND title != ''`
    })

  if (dirty.length > 0) {
    const groups = new Map<Source, string[]>()
    for (const row of dirty) {
      if (!isSource(row.source)) continue
      const ids = groups.get(row.source) ?? []
      ids.push(row.sourceId)
      groups.set(row.source, ids)
    }
    yield* sql.withTransaction(
      Effect.forEach(
        groups,
        ([source, ids]) =>
          Effect.gen(function* () {
            yield* replace(source, ids)
            yield* sql`DELETE FROM finder_dirty WHERE source = ${source} AND ${sql.in('source_id', ids)}`
          }),
        { discard: true },
      ),
    )
  }

  // Allow old profiles to fill even when live agents keep submitting changes.
  const progress = yield* reader.read(
    sql<{ source: string; afterId: string; done: number }>`SELECT source, after_id, done FROM finder_progress`,
  )
  const source = (Object.keys(sources) as Source[]).find((key) => !progress.some((row) => row.source === key && row.done === 1))
  if (source === undefined) return dirty.length > 0
  const after = progress.find((row) => row.source === source)?.afterId ?? ''
  const publicItems = source === 'said' ? sql`AND kind IN ('user_message', 'agent_message', 'step_result', 'arrival')` : sql``
  const rows = yield* reader.read(
    sql<{ id: string }>`SELECT id FROM ${sql(sources[source])} WHERE id > ${after} ${publicItems} ORDER BY id LIMIT ${BATCH}`,
  )
  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (rows.length > 0)
        yield* replace(
          source,
          rows.map((row) => row.id),
        )
      yield* sql`INSERT INTO finder_progress (source, after_id, done)
      VALUES (${source}, ${rows.at(-1)?.id ?? after}, ${rows.length < BATCH ? 1 : 0})
      ON CONFLICT (source) DO UPDATE SET after_id = excluded.after_id, done = excluded.done`
    }),
  )
  return true
})

export const finderIndex = Layer.effectDiscard(
  Effect.gen(function* () {
    const services = yield* Effect.context<SqlClient.SqlClient | Database.ReadLane>()
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const more = yield* updateFinder().pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.as(Effect.logWarning('Could not update search', cause), false),
            ),
          )
          yield* Effect.sleep(more ? '20 millis' : '300 millis')
        }),
      ).pipe(Effect.provideContext(services), Effect.delay('300 millis')),
    )
  }),
)

export const findDocuments = Effect.fn('Finder.search')(function* (input: FinderQuery, working: ReadonlySet<string>) {
  const sql = yield* SqlClient.SqlClient
  const reader = yield* Database.ReadLane
  const words = input.text.trim()
  const wordsOf = words.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? []
  const matchAny = input.matchAny === true
  const match =
    wordsOf
      .map((word) => {
        const stem = word.replace(/(es|s|ed|ing)$/u, '')
        return stem !== word && stem.length >= 3 ? `(${matchOf(word)} OR ${matchOf(stem)})` : matchOf(word)
      })
      .join(matchAny ? ' OR ' : ' AND ') || null
  if (words !== '' && match === null) return { documents: [], next: null, indexed: true } satisfies SearchDocuments
  const kinds = input.kinds ?? (words === '' ? ['task'] : ['task', 'pull', 'issue', 'said', 'note', 'conversation'])
  if (kinds.length === 0) return { documents: [], next: null, indexed: true } satisfies SearchDocuments
  const projects =
    input.projectId === undefined ? sql`p.archived_at IS NULL` : sql`p.archived_at IS NULL AND d.project_id = ${input.projectId}`
  const selected = match === null ? sql`finder_rows d` : sql`finder_match JOIN finder_rows d ON d.id = finder_match.rowid`
  const matches = match === null ? sql`1` : sql`finder_match MATCH ${match}`
  const score = match === null ? sql`0.0` : sql`bm25(finder_match, 10, 3, 7)`
  const columns = sql`d.source || ':' || d.source_id AS id, d.kind, d.project_id, d.thread_id, d.task_id, d.item_id,
    d.title, d.body, d.ref, d.url, d.changed_at, d.state AS document_state`
  const visible = sql`${projects} AND ${sql.in('d.kind', kinds)}
    AND NOT EXISTS (SELECT 1 FROM finder_dirty dirty WHERE dirty.source = d.source AND dirty.source_id = d.source_id)`
  const phase = phaseRead(sql)
  const phaseNow = yield* phasesNow()
  type Hit = Omit<SearchDocument, 'id' | 'state'> &
    Omit<Parameters<typeof phaseNow>[0], 'taskId'> & {
      id: string | null
      documentState: string
      indexing: number
    }
  const lookup = (where: typeof visible, from: typeof selected, rank: typeof score) =>
    reader.read(
      sql<Hit>`
    WITH hits AS MATERIALIZED (
      SELECT ${columns}, ${rank} AS score
      FROM ${from} JOIN projects p ON p.id = d.project_id
      WHERE ${where} AND ${visible} ORDER BY score, d.changed_at DESC, d.id DESC LIMIT ${RESULTS}
    )
    SELECT hits.*, ${phase.columns}, progress.indexing
    FROM (SELECT COUNT(*) < ${Object.keys(sources).length} AS indexing FROM finder_progress WHERE done = 1) progress
    LEFT JOIN hits ON 1
    LEFT JOIN tasks k ON hits.kind = 'task' AND k.id = hits.task_id
    ${phase.joins}
    ORDER BY hits.score, hits.changed_at DESC, hits.id DESC`,
      'background',
    )
  const exact = yield* lookup(matches, selected, score)
  // When the index finds no exact matches, look for initials and letters
  // in order in headings. The window applies its usual ranking to these.
  const loose = !matchAny && exact[0]?.id === null && wordsOf.length > 0 && wordsOf.every((word) => word.length >= 2 && word.length <= 12)
  const patterns = loose ? wordsOf.map((word) => `%${[...word].join('%')}%`) : []
  const rows =
    patterns.length === 0
      ? exact
      : yield* lookup(
          sql`d.kind IN ('task', 'pull', 'issue', 'conversation') AND ${sql.and(patterns.map((pattern) => sql`(d.title LIKE ${pattern} OR d.ref LIKE ${pattern})`))}`,
          sql`finder_rows d`,
          sql`0.0`,
        )
  const documents = rows.flatMap(
    ({ id, kind, projectId, threadId, taskId, itemId, title, body, ref, url, changedAt, documentState, ...task }) => {
      if (id === null) return []
      const state = kind === 'task' && taskId !== null ? phaseNow({ ...task, taskId }, working) : 'settled'
      return [
        {
          id,
          kind,
          projectId,
          threadId,
          taskId,
          itemId,
          title,
          body,
          ref,
          url,
          changedAt,
          state: state === 'settled' ? documentState : state,
        },
      ]
    },
  )
  return { documents, next: null, indexed: true, indexing: rows[0]?.indexing === 1 } satisfies SearchDocuments
})
