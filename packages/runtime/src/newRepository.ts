import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Effect } from 'effect'

import { type GitFailed, RepositoryRefused } from './errors'
import { free, landWhole } from './folderSetup'
import { startRepository } from './git'
import { slugify } from './Projects'

/*
 * A repository that isn't there yet, for a project that starts from nothing:
 * a folder named after the project, in a folder the person chose, made a git
 * repository with a first commit. It is placed first, read without changing
 * anything, so the page can say where it will be; it is made only as the
 * project is. An empty folder of its name is used; one with anything in
 * it is refused, as it may be someone's work, as is a link, which would put
 * it wherever that points.
 */

/** Where a new repository would go: its folder's name and its path, inside `parent`. */
export interface Placed {
  readonly name: string
  readonly path: string
}

/** The folder a project's name makes: northwind-ops, for Northwind Ops. */
const folderName = (name: string) => slugify(name, '')

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
 * Makes it: the repository and its first commit, in a folder of its own
 * beside where it goes, moved in once it's whole and only where that is still
 * free, as a clone is. Where git fails, or a clone of the name landed there
 * first, only its own folder goes, so trying again finds the place as it was.
 */
export const makeRepository = (parent: string, name: string): Effect.Effect<Placed, RepositoryRefused | GitFailed> =>
  Effect.gen(function* () {
    const placed = yield* placeRepository(parent, name)
    // The place itself is made where it isn't there yet, as a home's first place for projects is.
    yield* Effect.sync(() => mkdirSync(dirname(placed.path), { recursive: true }))
    yield* landWhole(
      placed.path,
      'making',
      (staging) =>
        Effect.andThen(
          Effect.sync(() => mkdirSync(staging)),
          startRepository(staging),
        ),
      () => new RepositoryRefused({ reason: 'taken', name: placed.name, parent }),
    )
    return { name: placed.name, path: real(placed.path) }
  })
