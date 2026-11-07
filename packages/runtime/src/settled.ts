import { Ledger } from '@althar/persistence-sqlite'
import { Effect, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

/*
 * Tasks that are over and projects that were removed, for what the app
 * keeps beside them that goes with them: the pages beside a task's
 * conversation keep their cookies until its task is done, where the person
 * keeps them so (ADR-100). Read from the store: a task done or abandoned, a
 * project removed, or either no longer there at all.
 */

const TASK = /^task_[0-9a-f]{32}$/
const PROJECT = /^proj_[0-9a-f]{32}$/

/** Of these tasks and projects, the ones that are over; ids that are neither are left out. */
export const settledAmong = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const tasks = [...new Set(ids.filter((id) => TASK.test(id)))]
    const projects = [...new Set(ids.filter((id) => PROJECT.test(id)))]
    const going = new Set<string>()
    if (tasks.length > 0)
      for (const row of yield* sql<{ id: string }>`
        SELECT id FROM tasks WHERE id IN ${sql.in(tasks)} AND state NOT IN ('done', 'abandoned')`)
        going.add(row.id)
    if (projects.length > 0)
      for (const row of yield* sql<{ id: string }>`
        SELECT id FROM projects WHERE id IN ${sql.in(projects)} AND archived_at IS NULL`)
        going.add(row.id)
    return [...tasks, ...projects].filter((id) => !going.has(id))
  })

/**
 * Each task as it comes to be over, and each project as it is removed, from
 * now on: read again whenever the record grows with a change to either.
 * Something over already when this starts isn't said.
 */
export const settling: Stream.Stream<ReadonlyArray<string>, never, SqlClient.SqlClient | Ledger> = Stream.unwrap(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const grown = yield* ledger.listen
    const latest = Effect.map(
      sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`,
      (rows) => rows[0]?.cursor ?? 0,
    )
    // Where the record stands as this starts: what was over before it isn't said; a record that can't be read starts at its beginning.
    let cursor = yield* Effect.orElseSucceed(latest, () => 0)
    const round = Effect.gen(function* () {
      yield* grown
      const changed = yield* sql<{ id: string; cursor: number }>`
        SELECT aggregate_id AS id, cursor FROM change_log
        WHERE cursor > ${cursor} AND aggregate_type IN ('task', 'project') ORDER BY cursor`
      cursor = Math.max(cursor, ...changed.map((row) => row.cursor))
      return yield* settledAmong(changed.map((row) => row.id))
    }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
    return Stream.fromEffectRepeat(round).pipe(Stream.filter((settled) => settled.length > 0))
  }),
)
