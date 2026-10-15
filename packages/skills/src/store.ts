import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { type Files, treeHash } from './hash'
import { isSafePath } from './validate'
import { type Parsed } from './catalog'

/*
 * The shared store, in Althar's per-user data and never in a project checkout:
 *   objects/<tree-hash>/   immutable skill trees
 *   installs.json          what is installed: source, pin, hashes, review state
 *   runs/<run-id>/<agent>/ one run's projection (projection.ts)
 */

const Install = z
  .strictObject({
    id: z.string().min(1),
    /** `github` can be refreshed from its repository; `local` only by re-importing; `althar-default` comes with the catalog. */
    source: z.enum(['github', 'local', 'althar-default']),
    repo: z.string().optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    subpath: z.string().optional(),
    treeHash: z.string().regex(/^[0-9a-f]{64}$/),
    review: z.enum(['not-reviewed', 'reviewed', 'default']),
    /** Whether it is bound for use; installed is not the same as active. */
    active: z.boolean(),
  })
  .refine((install) => !(install.active && install.review === 'not-reviewed'), {
    message: 'an install that was not reviewed cannot be active',
    path: ['active'],
  })

const Installs = z.strictObject({ version: z.literal(1), installs: z.array(Install) })

export type Install = z.infer<typeof Install>
export type Installs = z.infer<typeof Installs>

export const EMPTY_INSTALLS: Installs = { version: 1, installs: [] }

const HASH = /^[0-9a-f]{64}$/

export const isTreeHash = (value: string): boolean => HASH.test(value)

const objectDirectory = (root: string, hash: string) => {
  if (!isTreeHash(hash)) throw new Error('a tree hash is 64 lowercase hex characters')
  return join(root, 'objects', hash)
}

/** Writes `text` so a reader sees the old file or the new one, never half. */
const writeAtomically = async (path: string, text: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Keeps a skill tree under its hash. The same tree is the same object, so putting it twice changes nothing.
 * Refuses an unsafe path rather than writing outside the object.
 */
export const putObject = async (root: string, files: Files): Promise<string> => {
  for (const path of files.keys()) {
    if (!isSafePath(path)) throw new Error(`unsafe path in skill: ${path}`)
  }
  const hash = treeHash(files)
  const directory = objectDirectory(root, hash)
  if (await exists(directory)) return hash
  const staging = `${directory}.${randomUUID()}.partial`
  for (const [path, bytes] of files) {
    const target = join(staging, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { mode: 0o444 })
  }
  await mkdir(staging, { recursive: true })
  try {
    await rename(staging, directory)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (!(await exists(directory))) throw error
  }
  return hash
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** Reads a stored tree back, and checks it still hashes to its name. A symlink or a changed file is a refusal. */
export const readObject = async (root: string, hash: string): Promise<Files> => {
  const base = objectDirectory(root, hash)
  const files = new Map<string, Uint8Array>()
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(base, relative), { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.set(path, new Uint8Array(await readFile(join(base, path))))
      else throw new Error(`${path} in ${hash} is not a plain file`)
    }
  }
  await walk('')
  if (treeHash(files) !== hash) throw new Error(`the stored skill ${hash} no longer matches its hash`)
  return files
}

const queues = new Map<string, Promise<unknown>>()

/** Runs `work` after every earlier one on the same store has finished: installs.json is read, changed and rewritten, and two at once would lose one. */
export const serialized = <A>(root: string, work: () => Promise<A>): Promise<A> => {
  const run = (queues.get(root) ?? Promise.resolve()).then(work)
  queues.set(
    root,
    run.catch(() => undefined),
  )
  return run
}

export const readInstalls = async (root: string): Promise<Parsed<Installs>> => {
  let text: string
  try {
    text = await readFile(join(root, 'installs.json'), 'utf8')
  } catch {
    return { ok: true, value: EMPTY_INSTALLS }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'installs.json is not JSON' }
  }
  const result = Installs.safeParse(json)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
}

export const writeInstalls = async (root: string, installs: Installs): Promise<void> =>
  writeAtomically(join(root, 'installs.json'), `${JSON.stringify(Installs.parse(installs), null, 2)}\n`)

/** Adds or replaces an install by id. A replaced version's object stays until nothing references it. */
export const withInstall = (installs: Installs, install: Install): Installs => ({
  version: 1,
  installs: [...installs.installs.filter(({ id }) => id !== install.id), install].toSorted((a, b) => a.id.localeCompare(b.id)),
})
