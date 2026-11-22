import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { BoardTask } from '@althar/contracts'
import { Database } from '@althar/persistence-sqlite'
import { Clock, Effect, Option, Queue, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

export interface BoardRow {
  readonly id: string
  readonly state: string
  readonly createdAt: string
  readonly settledAt: string | null
  readonly view?: string | null
}

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(BoardTask)))
const KEEP = 1_000

export const boardProjections = Effect.gen(function* () {
  const requested = new Set<string>()
  const checked = new Map<string, number>()
  const decoded = new Map<string, { readonly json: string; readonly cards: ReadonlyArray<BoardTask> }>()
  const wake = yield* Queue.sliding<void>(1)

  return {
    read: <E, R>(row: BoardRow, fromFacts: Effect.Effect<ReadonlyArray<BoardTask>, E, R>) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (!requested.has(row.id) && now - (checked.get(row.id) ?? -Infinity) >= 10_000) {
          requested.add(row.id)
          yield* Queue.offer(wake, undefined)
        }
        if (row.view != null) {
          const old = decoded.get(row.id)
          const cards = old?.json === row.view ? old.cards : Option.getOrUndefined(decode(row.view))
          if (cards !== undefined) {
            decoded.delete(row.id)
            decoded.set(row.id, { json: row.view, cards })
            const oldest = decoded.keys().next().value
            if (decoded.size > KEEP && oldest !== undefined) decoded.delete(oldest)
            if (cards.every((card) => card.state === row.state && card.settledAt === row.settledAt)) return cards
          }
        }
        // A new profile or task can show durable facts while the first Git read runs.
        return yield* fromFacts
      }),
    pending: (maximum: number) => [...requested].slice(0, maximum),
    wait: (feed: Effect.Effect<void>) => (requested.size === 0 ? Effect.raceFirst(feed, Queue.take(wake)) : Effect.void),
    forget: (id: string) => decoded.delete(id),
    checked: (id: string) =>
      Effect.gen(function* () {
        requested.delete(id)
        checked.delete(id)
        checked.set(id, yield* Clock.currentTimeMillis)
        const oldest = checked.keys().next().value
        if (checked.size > KEEP && oldest !== undefined) checked.delete(oldest)
      }),
  }
})

export const putProjection = (taskId: string, json: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO board_card_views (task_id, view)
    SELECT id, ${json} FROM tasks WHERE id = ${taskId}
    ON CONFLICT (task_id) DO UPDATE SET view = excluded.view WHERE board_card_views.view != excluded.view`
  })

export const boardRows = (projectId: string, deviceId: string, settled: number, cached: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const columns = cached ? sql`v.view` : sql`w.path AS worktree, w.base_ref, w.base_commit`
    const joins = cached
      ? sql`LEFT JOIN board_card_views v ON v.task_id = k.id`
      : sql`LEFT JOIN workspaces w ON w.id = (SELECT f.id FROM workspaces f JOIN repository_bindings fb ON fb.id = f.binding_id
          WHERE f.task_id = k.id AND f.device_id = ${deviceId} ORDER BY fb.created_at, fb.rowid LIMIT 1)`
    const read = sql<BoardRow>`
      SELECT k.id, k.state, k.created_at, k.settled_at, ${columns} FROM tasks k ${joins}
      WHERE k.project_id = ${projectId} AND k.artifact_chat = 0 AND (k.state NOT IN ('done', 'abandoned') OR k.id IN (
        SELECT id FROM tasks WHERE project_id = ${projectId} AND state IN ('done', 'abandoned') AND artifact_chat = 0
        ORDER BY settled_at DESC, id DESC LIMIT ${settled}))
      ORDER BY k.created_at, k.id`
    return yield* cached ? (yield* Database.ReadLane).read(read) : read
  })

/** The worktree where a person commits outside Althar can move without a feed event. */
export const committedAt = (path: string): Effect.Effect<string> =>
  path === ''
    ? Effect.succeed('')
    : Effect.promise(async () => {
        try {
          const dotGit = join(path, '.git')
          const pointer = (await stat(dotGit)).isFile() ? /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1] : undefined
          const gitDir = pointer === undefined ? dotGit : resolve(path, pointer.trim())
          return String((await stat(join(gitDir, 'logs', 'HEAD'))).mtimeMs)
        } catch {
          return ''
        }
      })
