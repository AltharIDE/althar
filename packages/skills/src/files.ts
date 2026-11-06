import { chmod, lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { messageOf, SkillStoreFailed } from './errors'
import { type Files } from './hash'

/* The file system as the store uses it: each call an effect, its failure Althar's own (`SkillStoreFailed`). */

/** A promise-based file call, its failure said with what was being done. */
export const io = <A>(what: string, work: () => Promise<A>): Effect.Effect<A, SkillStoreFailed> =>
  Effect.tryPromise({ try: work, catch: (cause) => new SkillStoreFailed({ message: `${what}: ${messageOf(cause)}`, cause }) })

/** Whether anything is at a path, a link to nothing included. */
export const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    lstat(path).then(
      () => true,
      () => false,
    ),
  )

/** The plain files under a folder, by their path in it. Anything else, such as a link, is refused: it could point anywhere. */
export const readTree = (base: string, named = base): Effect.Effect<Files, SkillStoreFailed> =>
  Effect.gen(function* () {
    const files = new Map<string, Uint8Array>()
    const walk = (relative: string): Effect.Effect<void, SkillStoreFailed> =>
      Effect.gen(function* () {
        const entries = yield* io(`reading ${named}`, () => readdir(join(base, relative), { withFileTypes: true }))
        for (const entry of entries) {
          const path = relative === '' ? entry.name : `${relative}/${entry.name}`
          if (entry.isDirectory()) yield* walk(path)
          else if (entry.isFile()) files.set(path, new Uint8Array(yield* io(`reading ${named}`, () => readFile(join(base, path)))))
          else return yield* new SkillStoreFailed({ message: `${path} in ${named} is not a plain file` })
        }
      })
    yield* walk('')
    return files
  })

/** The folders under `directory`, deepest first, `directory` last. */
const foldersOf = async (directory: string): Promise<ReadonlyArray<string>> => {
  const inner = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  const deeper = await Promise.all(inner.map((entry) => foldersOf(join(directory, entry.name))))
  return [...deeper.flat(), directory]
}

/** Makes every folder in a tree read-only, as its files are, so nothing can be added to a copy or taken out of it. */
export const lockTree = (directory: string): Effect.Effect<void, SkillStoreFailed> =>
  io(`making ${directory} read-only`, async () => {
    for (const folder of await foldersOf(directory)) await chmod(folder, 0o555)
  })

/** Makes the folders of a tree writable again, from the top, so it can be removed; nothing where there is no tree. */
export const unlockTree = (directory: string): Effect.Effect<void, SkillStoreFailed> =>
  io(`unlocking ${directory}`, async () => {
    const walk = async (folder: string): Promise<void> => {
      let entries
      try {
        await chmod(folder, 0o755)
        entries = await readdir(folder, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) if (entry.isDirectory()) await walk(join(folder, entry.name))
    }
    await walk(directory)
  })
