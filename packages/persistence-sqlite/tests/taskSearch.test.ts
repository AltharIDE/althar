import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { seedRun } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Layer.mergeAll(InMemory, WebCrypto)

/** The tasks whose rows match, by their ids. */
const matching = (query: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ taskId: string }>`
      SELECT r.task_id FROM task_search s JOIN task_search_rows r ON r.id = s.rowid WHERE task_search MATCH ${query}`
    return rows.map((row) => row.taskId)
  })

describe('task search', () => {
  it.effect('indexes a row as it is written, changed and removed', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, createdAt } = yield* seedRun
      yield* sql`INSERT INTO task_search_rows ${sql.insert({
        taskId,
        projectId,
        title: 'Retry the checkout',
        asked: 'Payments fail when the café’s card times out',
        refs: '#143 althar/retry-checkout',
        files: 'src/checkout/retry.ts',
        changedAt: createdAt,
      })}`
      assert.deepStrictEqual(yield* matching('retr*'), [taskId])
      // Accents set aside, either way round.
      assert.deepStrictEqual(yield* matching('cafe'), [taskId])
      assert.deepStrictEqual(yield* matching('"143"'), [taskId])
      assert.deepStrictEqual(yield* matching('"retry.ts"'), [taskId])

      yield* sql`UPDATE task_search_rows SET title = 'Back off between attempts', summaries = 'Waits longer each time' WHERE task_id = ${taskId}`
      assert.deepStrictEqual(yield* matching('"checkout" "retry"'), [taskId], 'what is still in its refs and files')
      assert.deepStrictEqual(yield* matching('attempts'), [taskId])
      assert.deepStrictEqual(yield* matching('title:retry'), [], 'its old title is gone from the index')

      yield* sql`DELETE FROM task_search_rows WHERE task_id = ${taskId}`
      assert.deepStrictEqual(yield* matching('attempts'), [])
      const [left] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM task_search`
      assert.strictEqual(left?.n, 0)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('keeps one row a task, in its own project', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const mine = yield* seedRun
      const other = yield* seedRun
      const row = (projectId: string) =>
        Effect.exit(sql`INSERT INTO task_search_rows ${sql.insert({ taskId: mine.taskId, projectId, changedAt: mine.createdAt })}`)
      assert.isTrue((yield* row(mine.projectId))._tag === 'Success')
      assert.isTrue((yield* row(mine.projectId))._tag === 'Failure', 'a second row for the same task')
      yield* sql`DELETE FROM task_search_rows`
      assert.isTrue((yield* row(other.projectId))._tag === 'Failure', 'a row in another project than its task')
    }).pipe(Effect.provide(Env)),
  )
})
