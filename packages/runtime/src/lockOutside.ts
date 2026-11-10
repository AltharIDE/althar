import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * What Run safely can't install (a task is a conversation plus parts, "Run
 * it"): a lockfile's entries that come from a git host or a tarball rather
 * than a registry. Installed offline from the registries its base branch
 * names, with install scripts off, those are left out, or fail the install:
 * the thread names each that isn't there, so the person knows what Trust
 * fully would add.
 */

/** One of a lockfile's entries from outside a registry: the package, and where it says it comes from. */
export interface OutsideEntry {
  readonly name: string
  readonly from: string
}

const GIT = /^(git\+|git:|github:|gitlab:|bitbucket:|https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|codeload\.github\.com)\/)/
/** A tarball a registry serves sits under its package's `/-/`; one elsewhere is from outside it. */
const TARBALL = /^https?:\/\/.+\.(tgz|tar\.gz)(#.*)?$/

/** Whether a resolution names a git host or a tarball off a registry. */
export const outsideRegistry = (from: string): boolean => GIT.test(from) || (TARBALL.test(from) && !from.includes('/-/'))

const dedupe = (entries: ReadonlyArray<OutsideEntry>) => [...new Map(entries.map((one) => [one.name, one])).values()]

/** package-lock.json: each package's `resolved`. */
const fromNpm = (text: string): ReadonlyArray<OutsideEntry> => {
  let lock: unknown
  try {
    lock = JSON.parse(text)
  } catch {
    return []
  }
  const packages = (lock as { packages?: Record<string, { resolved?: unknown; name?: unknown }> } | null)?.packages ?? {}
  return Object.entries(packages).flatMap(([key, entry]) => {
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : ''
    if (key === '' || !outsideRegistry(resolved)) return []
    const name = typeof entry.name === 'string' ? entry.name : key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    return [{ name, from: resolved }]
  })
}

/** bun.lock: `"name": ["name@where", …]`. */
const fromBun = (text: string): ReadonlyArray<OutsideEntry> =>
  [...text.matchAll(/^\s*"[^"]+":\s*\["((?:@[^"@/]+\/)?[^"@]+)@([^"]+)"/gm)].flatMap((match) => {
    const [, name = '', from = ''] = match
    return outsideRegistry(from) ? [{ name, from }] : []
  })

/** yarn.lock: an entry's header names it, its `resolved` line where it comes from. */
const fromYarn = (text: string): ReadonlyArray<OutsideEntry> =>
  text.split(/\n(?=\S)/).flatMap((block) => {
    const header = block.split('\n')[0] ?? ''
    const name = /^"?((?:@[^"@/]+\/)?[^"@,]+)@/.exec(header)?.[1]
    const resolved = /^\s+resolved:?\s+"?([^"\s]+)"?/m.exec(block)?.[1] ?? /@((?:git\+|github:)[^",:]+)/.exec(header)?.[1]
    return name !== undefined && resolved !== undefined && outsideRegistry(resolved) ? [{ name, from: resolved }] : []
  })

/** pnpm-lock.yaml: a package's resolution, a tarball or a git repository. */
const fromPnpm = (text: string): ReadonlyArray<OutsideEntry> =>
  text.split(/\n(?= {2}\S)/).flatMap((block) => {
    const name = /^\s{2}'?\/?((?:@[^@/']+\/)?[^@/'(:]+)@/.exec(block)?.[1]
    const tarball = /tarball:\s*'?([^,'}\s]+)/.exec(block)?.[1]
    const repo = /repo:\s*'?([^,'}\s]+)/.exec(block)?.[1]
    const from = tarball ?? (repo === undefined ? undefined : `git+${repo}`)
    return name !== undefined && from !== undefined && outsideRegistry(from) ? [{ name, from }] : []
  })

/** A lockfile's entries from outside a registry, by its file's name; none for one it doesn't know. */
export const outsideEntries = (lockfile: string, text: string): ReadonlyArray<OutsideEntry> =>
  dedupe(
    lockfile === 'package-lock.json'
      ? fromNpm(text)
      : lockfile === 'bun.lock'
        ? fromBun(text)
        : lockfile === 'yarn.lock'
          ? fromYarn(text)
          : lockfile === 'pnpm-lock.yaml'
            ? fromPnpm(text)
            : [],
  )

/** Whether a package is in the copy's node_modules: at its own name, or among pnpm's. */
const installed = (copy: string, name: string): boolean => {
  if (existsSync(join(copy, 'node_modules', name, 'package.json'))) return true
  const store = join(copy, 'node_modules', '.pnpm')
  if (!existsSync(store)) return false
  const prefix = `${name.replace('/', '+')}@`
  try {
    return readdirSync(store).some((entry) => entry.startsWith(prefix))
  } catch {
    return false
  }
}

/** Of the copy's lockfile's entries from outside a registry, those Run safely didn't install. */
export const notInstalled = (copy: string, lockfile: string): ReadonlyArray<OutsideEntry> => {
  const path = join(copy, lockfile)
  if (!existsSync(path)) return []
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  return outsideEntries(lockfile, text).filter((one) => !installed(copy, one.name))
}
