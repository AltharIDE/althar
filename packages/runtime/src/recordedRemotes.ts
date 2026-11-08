import { existsSync } from 'node:fs'

import { Clock, Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { remoteUrls } from './git'

/*
 * A repository's remotes, as Althar keeps them (`remote_fingerprints`), are
 * what its clone here has: read again from git where it matters, not only as
 * they were when the repository was added. A remote added after (git init,
 * add it to Althar, then make it on GitHub), or one changed, is then where
 * its host is looked up, everywhere that column is read. They are kept as
 * written, an SSH alias too: where its host is looked up, sshHosts.ts reads
 * it. Each read is one `git remote -v` a repository: at launch, before a
 * task's ending is worked out or its pull request opens, and where its host
 * is asked for, at most once in `RECENT` for each repository.
 */

const Remotes = Schema.fromJsonString(Schema.Array(Schema.String))

/** How long a repository's remotes, once read, are taken as they are where its host is asked for. */
export const RECENT = 15_000

/** When each repository's remotes were last read here. */
const readAt = new Map<string, number>()

/** Which repositories: a project's, a task's, or every one with a clone on this device. */
export type RemotesOf = { readonly projectId: string } | { readonly taskId: string } | 'all'

/**
 * Records each repository's remotes as its clone on this device has them, where they differ; what git can't read stays. With
 * `within`, a repository read that recently is left as it is.
 */
export const refreshRemotes = (deviceId: string, of: RemotesOf, within?: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      of === 'all'
        ? yield* sql<{ id: string; path: string; remotes: string }>`
            SELECT b.id, l.path, b.remote_fingerprints AS remotes FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${deviceId}
            JOIN projects p ON p.id = b.project_id
            WHERE b.detached_at IS NULL AND p.archived_at IS NULL`
        : 'projectId' in of
          ? yield* sql<{ id: string; path: string; remotes: string }>`
              SELECT b.id, l.path, b.remote_fingerprints AS remotes FROM repository_bindings b
              JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${deviceId}
              WHERE b.project_id = ${of.projectId} AND b.detached_at IS NULL`
          : yield* sql<{ id: string; path: string; remotes: string }>`
              SELECT DISTINCT b.id, l.path, b.remote_fingerprints AS remotes FROM workspaces w
              JOIN repository_bindings b ON b.id = w.binding_id
              JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${deviceId}
              WHERE w.task_id = ${of.taskId} AND w.device_id = ${deviceId}`
    yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          // A clone that has gone, or that git can't read, says nothing of its remotes: what was recorded stays.
          if (row.path === null || !existsSync(row.path)) return
          const now = yield* Clock.currentTimeMillis
          if (within !== undefined && now - (readAt.get(row.id) ?? Number.NEGATIVE_INFINITY) < within) return
          readAt.set(row.id, now)
          const read = yield* remoteUrls(row.path).pipe(Effect.option)
          if (Option.isNone(read)) return
          const remotes = read.value
          const was = Option.getOrElse(Schema.decodeUnknownOption(Remotes)(row.remotes), () => [] as ReadonlyArray<string>)
          if (remotes.length === was.length && remotes.every((url, index) => url === was[index])) return
          const json = JSON.stringify(remotes)
          yield* sql`UPDATE repository_bindings SET remote_fingerprints = ${json} WHERE id = ${row.id}`
          yield* sql`UPDATE repository_locations SET observed_remotes = ${json} WHERE binding_id = ${row.id} AND device_id = ${deviceId}`
        }),
      { concurrency: 4 },
    )
  }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read repositories’ remotes again', cause)))
