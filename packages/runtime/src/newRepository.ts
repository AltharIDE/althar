import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { type GitFailed, RepositoryRefused } from './errors'
import { startRepository } from './git'
import { slugify } from './Projects'

/*
 * A repository that isn't there yet, for a project that starts from nothing:
 * a folder named after the project, in a folder the person chose, made a git
 * repository with a first commit. It is placed first, read without changing
 * anything, so the page can say where it will be; it is made only as the
 * project is. An empty folder of its name is used as it is; one with
 * anything in it is refused, as it may be someone's work.
 */

/** Where a new repository would go: its folder's name and its path, inside `parent`. */
export interface Placed {
  readonly name: string
  readonly path: string
}

/** The folder a project's name makes: northwind-ops, for Northwind Ops. */
const folderName = (name: string) => slugify(name, '')

/** Whether `path` holds nothing: no folder, or one with nothing in it. */
const free = (path: string) => {
  if (!existsSync(path)) return true
  try {
    return readdirSync(path).length === 0
  } catch {
    // A file of that name, or a folder that can't be read.
    return false
  }
}

/** The path as the file system has it, the way the projects name a repository's root. */
const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Where a repository named after `name` would go in `parent`, read without making anything; refused where it can't. */
export const placeRepository = (parent: string, name: string): Effect.Effect<Placed, RepositoryRefused> =>
  Effect.suspend(() => {
    const folder = folderName(name)
    if (folder === '') return Effect.fail(new RepositoryRefused({ reason: 'no_name', name, parent }))
    const path = join(real(parent), folder)
    return free(path)
      ? Effect.succeed({ name: folder, path })
      : Effect.fail(new RepositoryRefused({ reason: 'taken', name: folder, parent }))
  })

/**
 * Makes it: the folder, then the repository and its first commit. A folder
 * this made is taken away again if git fails in it, so trying again finds the
 * place free.
 */
export const makeRepository = (parent: string, name: string): Effect.Effect<Placed, RepositoryRefused | GitFailed> =>
  Effect.gen(function* () {
    const placed = yield* placeRepository(parent, name)
    const made = !existsSync(placed.path)
    if (made) mkdirSync(placed.path, { recursive: true })
    yield* startRepository(placed.path).pipe(
      Effect.tapError(() =>
        made
          ? cleanUp(placed.path, 'where a new repository couldn’t be made')
          : cleanUp(join(placed.path, '.git'), 'where a new repository couldn’t be made'),
      ),
    )
    return { name: placed.name, path: real(placed.path) }
  })
