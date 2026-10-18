import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCatalog, type CatalogEntry } from './catalog'
import { type Files, treeHash } from './hash'
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

const readTree = async (base: string): Promise<Files> => {
  const files = new Map<string, Uint8Array>()
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(base, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.set(path, new Uint8Array(await readFile(join(base, path))))
      else throw new Error(`${path} is not a plain file`)
    }
  }
  await walk('')
  return files
}

/**
 * Reads and checks a local catalog: every skill must validate with push text rejected, and must hash to the tree
 * hash its entry pins. Any failure refuses the whole catalog, so a default set is never half-trusted.
 */
export const loadLocalCatalog = async (directory: string): Promise<LocalCatalog> => {
  const parsed = parseCatalog(await readFile(join(directory, 'catalog.json'), 'utf8'))
  if (!parsed.ok) throw new Error(`catalog.json: ${parsed.error}`)
  const skills = []
  for (const entry of parsed.value.entries) {
    const files = await readTree(join(directory, 'skills', entry.id))
    const checked = validateSkill(entry.id, files, undefined, 'reject')
    if (!checked.ok)
      throw new Error(
        `${entry.id}: ${checked.findings
          .filter((f) => f.level === 'reject')
          .map((f) => f.code)
          .join(', ')}`,
      )
    if (treeHash(files) !== entry.treeHash) throw new Error(`${entry.id}: its files do not match the pinned tree hash`)
    skills.push({ entry, files })
  }
  return { revision: parsed.value.revision, skills }
}

/**
 * Puts a local catalog's skills in the store and records them as installed defaults, active. Defaults the person
 * deactivated stay deactivated: an existing install keeps its `active` choice and only its version moves.
 */
export const installLocalCatalog = (root: string, directory: string): Promise<LocalCatalog & { readonly removed: ReadonlyArray<string> }> =>
  serialized(root, () => install(root, directory))

const install = async (root: string, directory: string): Promise<LocalCatalog & { readonly removed: ReadonlyArray<string> }> => {
  const catalog = await loadLocalCatalog(directory)
  const read = await readInstalls(root)
  if (!read.ok) throw new Error(read.error)
  let installs = read.value
  for (const { entry, files } of catalog.skills) {
    const hash = await putObject(root, files)
    const was = installs.installs.find(({ id }) => id === entry.id)
    // The person's own install of the same name took its place: the default is kept, not put back over it.
    if (was !== undefined && was.source !== 'althar-default') continue
    installs = withInstall(installs, {
      id: entry.id,
      source: 'althar-default',
      treeHash: hash,
      review: 'default',
      active: was?.active ?? true,
    })
  }
  // A default the catalog no longer lists is dropped, and said: it must not stay active in every run. Its stored version is kept.
  const listed = new Set(catalog.skills.map(({ entry }) => entry.id))
  const removed = installs.installs.filter(({ id, source }) => source === 'althar-default' && !listed.has(id)).map(({ id }) => id)
  installs = { version: 1, installs: installs.installs.filter(({ id }) => !removed.includes(id)) }
  await writeInstalls(root, installs)
  return { ...catalog, removed }
}

/** The defaults an update of the catalog would drop, to show before it is applied. */
export const removedByCatalog = async (root: string, directory: string): Promise<ReadonlyArray<string>> => {
  const catalog = await loadLocalCatalog(directory)
  const read = await readInstalls(root)
  if (!read.ok) throw new Error(read.error)
  const listed = new Set(catalog.skills.map(({ entry }) => entry.id))
  return read.value.installs.filter(({ id, source }) => source === 'althar-default' && !listed.has(id)).map(({ id }) => id)
}

/** The skills a run uses by default: the active installs, with what each needs, from the catalog they came with. */
export const activeSelection = async (
  root: string,
  needs: ReadonlyMap<string, ReadonlyArray<string>>,
): Promise<ReadonlyArray<{ readonly id: string; readonly treeHash: string; readonly needs: ReadonlyArray<string> }>> => {
  const read = await readInstalls(root)
  if (!read.ok) throw new Error(read.error)
  return read.value.installs.filter(({ active }) => active).map(({ id, treeHash }) => ({ id, treeHash, needs: needs.get(id) ?? [] }))
}
