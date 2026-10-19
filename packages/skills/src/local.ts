import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect } from 'effect'
import { parseCatalog, type CatalogEntry } from './catalog'
import { SkillStoreFailed } from './errors'
import { io, readTree } from './files'
import { type Files, sha256, treeHash } from './hash'
import { putObject, readInstalls, serialized, withInstall, writeInstalls } from './store'
import { validateSkill } from './validate'

/**
 * A catalog on disk: `catalog.json` and `skills/<id>/…`. It stands in for the default catalog until the person
 * decides where that comes from; nothing here reaches the network.
 */
export interface LocalCatalog {
  readonly revision: string
  readonly skills: ReadonlyArray<{ readonly entry: CatalogEntry; readonly files: Files }>
}

/**
 * Reads and checks a local catalog: every skill must validate with push text rejected, and must hash to the tree
 * hash its entry pins. Any failure refuses the whole catalog, so a default set is never half-trusted.
 */
export const loadLocalCatalog = (directory: string): Effect.Effect<LocalCatalog, SkillStoreFailed> =>
  Effect.flatMap(readCatalogText(directory), (text) => checkCatalog(directory, text))

const readCatalogText = (directory: string) => io('reading catalog.json', () => readFile(join(directory, 'catalog.json'), 'utf8'))

const parsed = (text: string) =>
  parseCatalog(text).pipe(Effect.mapError((error) => new SkillStoreFailed({ message: `catalog.json: ${error.message}` })))

const checkCatalog = (directory: string, text: string): Effect.Effect<LocalCatalog, SkillStoreFailed> =>
  Effect.gen(function* () {
    const catalog = yield* parsed(text)
    const skills = []
    for (const entry of catalog.entries) {
      const files = yield* readTree(join(directory, 'skills', entry.id), entry.id)
      const checked = validateSkill(entry.id, files, undefined, 'reject')
      if (!checked.ok)
        return yield* new SkillStoreFailed({
          message: `${entry.id}: ${checked.findings
            .filter((f) => f.level === 'reject')
            .map((f) => f.code)
            .join(', ')}`,
        })
      if (treeHash(files) !== entry.treeHash)
        return yield* new SkillStoreFailed({ message: `${entry.id}: its files do not match the pinned tree hash` })
      skills.push({ entry, files })
    }
    return { revision: catalog.revision, skills }
  })

/** What installing a catalog says: its revision, what its entries say of each default, and the defaults it dropped. */
export interface InstalledCatalog {
  readonly revision: string
  readonly entries: ReadonlyArray<CatalogEntry>
  readonly removed: ReadonlyArray<string>
}

/**
 * Puts a local catalog's skills in the store and records them as installed defaults, off: they change how every lead
 * works, so none is given to one until the person turns it on. An existing install keeps its `active` choice and only
 * its version moves. A catalog installed before, by the hash of its catalog.json, which pins every skill's files, is
 * only read: its skills are not hashed nor the store written again.
 */
export const installLocalCatalog = (root: string, directory: string): Effect.Effect<InstalledCatalog, SkillStoreFailed> =>
  serialized(
    root,
    Effect.gen(function* () {
      const text = yield* readCatalogText(directory)
      const key = sha256(new TextEncoder().encode(text))
      let installs = yield* readInstalls(root)
      if (installs.catalog === key) {
        const { revision, entries } = yield* parsed(text)
        return { revision, entries, removed: [] }
      }
      const catalog = yield* checkCatalog(directory, text)
      for (const { entry, files } of catalog.skills) {
        const hash = yield* putObject(root, files)
        const was = installs.installs.find(({ id }) => id === entry.id)
        // The person's own install of the same name took its place: the default is kept, not put back over it.
        if (was !== undefined && was.source !== 'althar-default') continue
        installs = withInstall(installs, {
          id: entry.id,
          source: 'althar-default',
          treeHash: hash,
          review: 'default',
          active: was?.active ?? false,
        })
      }
      // A default the catalog no longer lists is dropped, and said: it must not stay active in every run. Its stored version is kept.
      const listed = new Set(catalog.skills.map(({ entry }) => entry.id))
      const removed = installs.installs.filter(({ id, source }) => source === 'althar-default' && !listed.has(id)).map(({ id }) => id)
      installs = { version: 1, catalog: key, installs: installs.installs.filter(({ id }) => !removed.includes(id)) }
      yield* writeInstalls(root, installs)
      return { revision: catalog.revision, entries: catalog.skills.map(({ entry }) => entry), removed }
    }),
  )

/** The defaults an update of the catalog would drop, to show before it is applied. */
export const removedByCatalog = (root: string, directory: string): Effect.Effect<ReadonlyArray<string>, SkillStoreFailed> =>
  Effect.gen(function* () {
    const catalog = yield* loadLocalCatalog(directory)
    const installs = yield* readInstalls(root)
    const listed = new Set(catalog.skills.map(({ entry }) => entry.id))
    return installs.installs.filter(({ id, source }) => source === 'althar-default' && !listed.has(id)).map(({ id }) => id)
  })

/** A skill a run is given by default: its id, the stored version, and what it needs of the agent. */
export interface Chosen {
  readonly id: string
  readonly treeHash: string
  readonly needs: ReadonlyArray<string>
}

/** The skills a run uses by default: the active installs, with what each needs, from the catalog they came with. */
export const activeSelection = (
  root: string,
  needs: ReadonlyMap<string, ReadonlyArray<string>>,
): Effect.Effect<ReadonlyArray<Chosen>, SkillStoreFailed> =>
  Effect.map(readInstalls(root), ({ installs }) =>
    installs.filter(({ active }) => active).map(({ id, treeHash }) => ({ id, treeHash, needs: needs.get(id) ?? [] })),
  )
