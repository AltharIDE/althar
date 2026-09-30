import { randomBytes } from 'node:crypto'

import { Context, Effect, Layer } from 'effect'

import { NotFound } from './errors'

/*
 * Folders the person chose, by grant (docs/architecture/07: the window gets
 * no API that takes an arbitrary path). The app's main process, which showed
 * the folder picker or received the drop, allows the folder here and hands
 * the window the grant; the window opens the project by it. Grants last for
 * the launch.
 */

export class Folders extends Context.Service<
  Folders,
  {
    /** Allows a folder the person chose; the grant that names it. */
    allow(path: string): Effect.Effect<string>
    /** The folder a grant names. */
    path(grant: string): Effect.Effect<string, NotFound>
  }
>()('@charrette/runtime/Folders') {
  static readonly layer: Layer.Layer<Folders> = Layer.sync(Folders, () => {
    const grants = new Map<string, string>()
    return Folders.of({
      allow: (path) =>
        Effect.sync(() => {
          const grant = `grant_${randomBytes(16).toString('hex')}`
          grants.set(grant, path)
          return grant
        }),
      path: (grant) => {
        const path = grants.get(grant)
        return path === undefined ? Effect.fail(new NotFound({ kind: 'folder', id: grant })) : Effect.succeed(path)
      },
    })
  })
}
