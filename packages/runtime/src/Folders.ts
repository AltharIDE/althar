import { randomBytes } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { sep } from 'node:path'

import { Context, Effect, Layer } from 'effect'

import { NotFound } from './errors'

/*
 * Folders the person chose, by grant (docs/architecture/07: the window gets
 * no API that takes an arbitrary path). The app's main process, which showed
 * the folder picker or received the drop, allows the folder here and hands
 * the window the grant; the window opens the project by it. Grants last for
 * the launch.
 *
 * A home grants folders too, to a window on another computer that can't show
 * its picker there: the repositories it finds and makes, and where new code
 * goes. Those grants open no more than that, whoever holds them.
 */

/**
 * What a grant opens:
 * - `chosen`: a folder the person chose, and anything in it.
 * - `repository`: a repository the home found, cloned or made: its root and nothing in it by another path, and only while
 *   it is still that repository where it was, links followed.
 * - `place`: where new code goes: a clone or a new repository is made in it, and nothing in it is read or opened.
 */
export type GrantKind = 'chosen' | 'repository' | 'place'

/** The folder at `path` as the disk has it, links followed; itself where it isn't there. */
export const realpathOf = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Whether the repository granted at `root` is still there: the same folder, links followed, with git's own folder in it. */
const stillRepository = (root: string) => {
  try {
    return realpathSync(root) === root && lstatSync(`${root}${sep}.git`).isDirectory()
  } catch {
    return false
  }
}

/** Whether the place granted at `path` is still where it was, links followed; one not made yet is made where it was named. */
const stillPlace = (path: string) => {
  try {
    return realpathSync(path) === path && lstatSync(path).isDirectory()
  } catch (failure) {
    return (failure as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

export class Folders extends Context.Service<
  Folders,
  {
    /** Allows a folder; the grant that names it. A folder the person chose unless `kind` says otherwise. */
    allow(path: string, kind?: GrantKind): Effect.Effect<string>
    /** The folder a grant names, to read or open: never a place's. */
    path(grant: string): Effect.Effect<string, NotFound>
    /**
     * The folder at `path` in a grant's, as the disk has it, or the grant's
     * own without one: anywhere in a folder the person chose; only its root
     * for a repository's; never in a place.
     */
    inside(grant: string, path?: string): Effect.Effect<string, NotFound>
    /** Where a clone or a new repository goes, by a grant: a place's, or a folder the person chose; never a repository's. */
    place(grant: string): Effect.Effect<string, NotFound>
  }
>()('@althar/runtime/Folders') {
  static readonly layer: Layer.Layer<Folders> = Layer.sync(Folders, () => {
    const grants = new Map<string, { readonly path: string; readonly kind: GrantKind }>()
    /** The grant's folder, where it may be used as `uses` says and is still what was granted. */
    const granted = (grant: string, uses: ReadonlyArray<GrantKind>) =>
      Effect.suspend(() => {
        const one = grants.get(grant)
        if (one === undefined || !uses.includes(one.kind)) return Effect.fail(new NotFound({ kind: 'folder', id: grant }))
        if (one.kind === 'repository' && !stillRepository(one.path)) return Effect.fail(new NotFound({ kind: 'folder', id: grant }))
        if (one.kind === 'place' && !stillPlace(one.path)) return Effect.fail(new NotFound({ kind: 'folder', id: grant }))
        return Effect.succeed(one)
      })
    return Folders.of({
      allow: (path, kind = 'chosen') =>
        Effect.sync(() => {
          const grant = `grant_${randomBytes(16).toString('hex')}`
          // A home's own grants are kept as the disk has them, so a link put in their place later doesn't move them.
          grants.set(grant, { path: kind === 'chosen' ? path : realpathOf(path), kind })
          return grant
        }),
      path: (grant) => Effect.map(granted(grant, ['chosen', 'repository']), (one) => one.path),
      inside: (grant, path) =>
        Effect.flatMap(granted(grant, ['chosen', 'repository']), (one) => {
          const chosen = realpathOf(one.path)
          if (path === undefined) return Effect.succeed(chosen)
          const at = realpathOf(path)
          const within = one.kind === 'chosen' ? at === chosen || at.startsWith(`${chosen}${sep}`) : at === chosen
          return within ? Effect.succeed(at) : Effect.fail(new NotFound({ kind: 'folder', id: path }))
        }),
      place: (grant) => Effect.map(granted(grant, ['chosen', 'place']), (one) => one.path),
    })
  })
}
