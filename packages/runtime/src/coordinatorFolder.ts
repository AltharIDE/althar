import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { NotFound } from './errors'
import { commitOf, fetchBranch, git } from './git'
import { Instance } from './Instance'

/*
 * The coordinator's working folder (docs/architecture/04): a Charrette-owned
 * folder with a worktree of each of the project's repositories, detached at
 * its default branch. Each is brought up to date with the remote before the
 * coordinator's turn, and anything written there is thrown away when it is:
 * nothing the coordinator writes survives or reaches a task. A project with
 * no repositories gets an empty folder.
 */

export interface CoordinatorFolder {
  readonly folder: string
  readonly repositories: ReadonlyArray<{ readonly name: string; readonly path: string; readonly base: string }>
}

/** The project's coordinator folder, made if it isn't there, and each repository fresh from its default branch. */
export const coordinatorFolder = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const config = yield* RuntimeConfig
    const [project] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${projectId}`
    if (project === undefined) return yield* new NotFound({ kind: 'project', id: projectId })
    const bindings = yield* sql<{ slug: string; name: string; base: string | null; repository: string }>`
      SELECT b.slug, b.display_name AS name, b.default_base_ref AS base, l.path AS repository
      FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
      ORDER BY b.created_at`
    const folder = join(config.worktreeRoot, project.slug, '.coordinator')
    mkdirSync(folder, { recursive: true })
    const repositories = yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const base = binding.base ?? 'main'
        const path = join(folder, binding.slug)
        // The remote's default branch where there is one; offline, what this Mac has.
        const fetched = yield* fetchBranch(binding.repository, base)
        const remote = fetched ? yield* commitOf(binding.repository, `origin/${base}`).pipe(Effect.option) : Option.none()
        const commit = Option.isSome(remote) ? remote.value : yield* commitOf(binding.repository, base)
        if (!existsSync(path)) yield* git(binding.repository, 'worktree', 'add', '--detach', path, commit)
        else {
          yield* git(path, 'checkout', '--detach', '--force', commit)
          yield* git(path, 'clean', '-fdq')
        }
        return { name: binding.name, path, base }
      }),
    )
    return { folder, repositories } satisfies CoordinatorFolder
  })
