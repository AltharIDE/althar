import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

/*
 * How a repository runs, worked out from what is in it (ADR-023), until a
 * command is kept for it: its package.json's dev script, else its start or
 * serve script, run with the package manager its lockfile names, installing
 * first where it has packages and none are installed yet; else a Procfile's
 * web process; else a Makefile's dev, run or serve target. Nothing, where none
 * of these says. Installing never changes the lockfile, so a task's change
 * stays what its lead made.
 *
 * What makes a fresh copy ready is one thing, kept or worked out: Althar runs
 * it before each run, and in a task's worktree once, when it is made, before
 * its lead starts.
 *
 * Its package.json files' scripts, the root's and each workspace's, are what
 * the person picks something more to run from (ADR-044), each as the command
 * that runs it from the repository's root.
 */

export interface RunCommand {
  /** What runs it: `bun run dev`. */
  readonly command: string
  /** What makes a fresh copy ready first: before it runs, and in a task's worktree as it is made; null for nothing. */
  readonly setup: string | null
}

/** What is kept for a repository: either may be null, for worked out from it. */
export interface Kept {
  readonly command: string | null
  readonly setup: string | null
}

const MANAGERS: ReadonlyArray<{ readonly lockfile: string; readonly name: string; readonly install: string }> = [
  { lockfile: 'bun.lock', name: 'bun', install: 'bun install --frozen-lockfile' },
  { lockfile: 'bun.lockb', name: 'bun', install: 'bun install --frozen-lockfile' },
  { lockfile: 'pnpm-lock.yaml', name: 'pnpm', install: 'pnpm install --frozen-lockfile' },
  { lockfile: 'yarn.lock', name: 'yarn', install: 'yarn install --frozen-lockfile' },
  { lockfile: 'package-lock.json', name: 'npm', install: 'npm ci' },
]
const SCRIPTS = ['dev', 'start', 'serve']
const TARGETS = ['dev', 'run', 'serve']

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined

/** Installs only where nothing is installed yet, in this system's shell. */
const unlessInstalled = (install: string, platform: NodeJS.Platform) =>
  platform === 'win32' ? `if not exist node_modules ${install}` : `test -d node_modules || ${install}`

/** A folder's package.json, read; undefined where it has none, or one that isn't JSON. */
const manifestIn = (folder: string): Readonly<Record<string, unknown>> | undefined => {
  const text = read(join(folder, 'package.json'))
  if (text === null) return undefined
  try {
    return recordOf(JSON.parse(text))
  } catch {
    return undefined
  }
}

/** The package manager the lockfile beside it names, or the one at the repository's root in a folder of a larger one. */
const managerOf = (folder: string, root: string) =>
  MANAGERS.find((one) => existsSync(join(folder, one.lockfile)) || existsSync(join(root, one.lockfile)))

/** The workspaces a package.json names: npm's, Yarn's and Bun's list, or Yarn's `{ packages }`. */
const workspacesOf = (manifest: Readonly<Record<string, unknown>>): ReadonlyArray<unknown> => {
  const named = manifest.workspaces
  return Array.isArray(named)
    ? named
    : Array.isArray(recordOf(named)?.packages)
      ? (recordOf(named)?.packages as ReadonlyArray<unknown>)
      : []
}

/**
 * What installs a package.json's packages, where it has any: its own, or its
 * workspaces' at the root of a monorepo (pnpm names those beside it). Null for
 * nothing to install.
 */
const installFor = (manifest: Readonly<Record<string, unknown>>, folder: string, root: string) => {
  const own = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(
    (field) => Object.keys(recordOf(field) ?? {}).length > 0,
  )
  const workspaces = workspacesOf(manifest).length > 0 || existsSync(join(folder, 'pnpm-workspace.yaml'))
  return own || workspaces ? (managerOf(folder, root)?.install ?? 'npm install --no-package-lock') : null
}

/** What installs a package.json's packages only where none are installed yet, as a run wants before it starts. */
const guarded = (install: string | null, platform: NodeJS.Platform) => (install === null ? null : unlessInstalled(install, platform))

/** The command a package.json runs with, and what installs its packages first. */
const fromPackage = (folder: string, root: string, platform: NodeJS.Platform): RunCommand | null => {
  const manifest = manifestIn(folder)
  if (manifest === undefined) return null
  const scripts = recordOf(manifest.scripts) ?? {}
  const script = SCRIPTS.find((name) => typeof scripts[name] === 'string')
  if (script === undefined) return null
  return {
    command: `${managerOf(folder, root)?.name ?? 'npm'} run ${script}`,
    setup: guarded(installFor(manifest, folder, root), platform),
  }
}

/** A Procfile's web process, as Heroku and Foreman run it. */
const fromProcfile = (folder: string): RunCommand | null => {
  const web = /^web:\s*(.+)$/m.exec(read(join(folder, 'Procfile')) ?? '')?.[1]?.trim()
  return web === undefined || web === '' ? null : { command: web, setup: null }
}

/** A Makefile's dev, run or serve target. */
const fromMakefile = (folder: string): RunCommand | null => {
  const text = read(join(folder, 'Makefile')) ?? ''
  const target = TARGETS.find((name) => new RegExp(`^${name}:`, 'm').test(text))
  return target === undefined ? null : { command: `make ${target}`, setup: null }
}

/** How the repository in `folder` runs, as what is in it says; `root` is its repository's root, where that is above it. */
export const runCommandIn = (folder: string, root: string = folder, platform: NodeJS.Platform = process.platform): RunCommand | null =>
  fromPackage(folder, root, platform) ?? fromProcfile(folder) ?? fromMakefile(folder)

/**
 * What installs the packages of the repository in `folder`, as what is in it
 * says, whether or not it says how it runs: its package.json's, or its
 * workspaces', with the package manager its lockfile names. Run as it is,
 * whatever is installed already: a task's worktree, whose setup is kept on
 * its workspace, isn't taken as set up for a `node_modules` an install cut
 * short left. Null for nothing to install.
 */
export const installIn = (folder: string, root: string = folder): string | null => {
  const manifest = manifestIn(folder)
  return manifest === undefined ? null : installFor(manifest, folder, root)
}

/** What makes a fresh copy ready before a run, as what is in it says: its install, only where nothing is installed yet. Null for nothing. */
export const setupIn = (folder: string, root: string = folder, platform: NodeJS.Platform = process.platform): string | null =>
  guarded(installIn(folder, root), platform)

/**
 * How a repository runs and is made ready: what is kept for it, and, for
 * what isn't, what is in it says. Null where nothing says how it runs.
 */
export const runOf = (
  kept: Kept,
  folder: string,
  root: string = folder,
  platform: NodeJS.Platform = process.platform,
): RunCommand | null => {
  const command = kept.command ?? runCommandIn(folder, root, platform)?.command
  return command === undefined ? null : { command, setup: kept.setup ?? setupIn(folder, root, platform) }
}

/** The line a shell runs: what makes it ready, then the command. */
export const lineOf = (run: RunCommand) => (run.setup === null ? run.command : `(${run.setup}) && ${run.command}`)

/** A script a package.json says, and the command that runs it from the repository's root. */
export interface Script {
  /** The package it is in, by its name: `althar`, `@althar/ui`. */
  readonly package: string
  readonly name: string
  /** What the script itself says. */
  readonly body: string
  /** `bun run dev`, `bun --filter @althar/ui storybook`. */
  readonly command: string
}

/** Scripts only an install, a publish or a version bump runs: never something to run by hand. */
const LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'preversion',
  'version',
  'postversion',
])

/** The folders a workspaces pattern names under `folder`: for `apps/*`, each folder in apps with a package.json; for `apps/web`, that one. */
const workspaceFolders = (folder: string, pattern: string): ReadonlyArray<string> => {
  if (pattern.startsWith('!')) return []
  const wild = /^(.*?)\/\*\*?$/.exec(pattern.replace(/\/+$/, ''))
  if (wild === null) return existsSync(join(folder, pattern, 'package.json')) ? [join(folder, pattern)] : []
  const parent = join(folder, wild[1] ?? '')
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name))
      .filter((child) => existsSync(join(child, 'package.json')))
      .sort()
  } catch {
    return []
  }
}

/** How a workspace's script runs from the repository's root, by the package manager's own words for it. */
const inWorkspace = (manager: string, workspace: string, script: string) => {
  switch (manager) {
    case 'bun':
      return `bun --filter ${workspace} ${script}`
    case 'pnpm':
      return `pnpm --filter ${workspace} ${script}`
    case 'yarn':
      return `yarn workspace ${workspace} ${script}`
    default:
      return `npm run ${script} --workspace ${workspace}`
  }
}

/** A package.json's scripts worth running by hand, as name and body. */
const scriptsOf = (manifest: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, string]> =>
  Object.entries(recordOf(manifest.scripts) ?? {}).flatMap(([name, body]) =>
    typeof body === 'string' && !LIFECYCLE.has(name) ? [[name, body] as const] : [],
  )

/**
 * The scripts in the package.json in `folder` and in each of its workspaces,
 * the root's first, each with the command that runs it from `folder` with
 * the package manager its lockfile names. None where it has no package.json.
 */
export const scriptsIn = (folder: string, root: string = folder): ReadonlyArray<Script> => {
  const manifest = manifestIn(folder)
  if (manifest === undefined) return []
  const manager = managerOf(folder, root)?.name ?? 'npm'
  const own = typeof manifest.name === 'string' ? manifest.name : basename(folder)
  const scripts: Array<Script> = scriptsOf(manifest).map(([name, body]) => ({
    package: own,
    name,
    body,
    command: `${manager} run ${name}`,
  }))
  const folders = new Set(
    workspacesOf(manifest).flatMap((pattern) => (typeof pattern === 'string' ? workspaceFolders(folder, pattern) : [])),
  )
  for (const workspace of folders) {
    const inner = manifestIn(workspace)
    if (inner === undefined) continue
    // With `/`, as a package manager's filter and the person write it, on Windows too.
    const path = relative(folder, workspace).split(sep).join('/')
    // A workspace with no name is named by its folder, which Yarn can't run it by.
    const named = typeof inner.name === 'string' ? inner.name : undefined
    if (named === undefined && manager === 'yarn') continue
    for (const [name, body] of scriptsOf(inner))
      scripts.push({ package: named ?? path, name, body, command: inWorkspace(manager, named ?? `./${path}`, name) })
  }
  return scripts
}

/** The package manager the lockfile in `folder`, or at its repository's root, names: `bun`; null where none does. */
export const managerIn = (folder: string, root: string = folder): string | null => managerOf(folder, root)?.name ?? null

/** The package.json in `folder` and each of its workspaces', read: none where it has no package.json. */
export const manifestsIn = (folder: string): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  const manifest = manifestIn(folder)
  if (manifest === undefined) return []
  const folders = new Set(
    workspacesOf(manifest).flatMap((pattern) => (typeof pattern === 'string' ? workspaceFolders(folder, pattern) : [])),
  )
  return [
    manifest,
    ...[...folders].flatMap((workspace) => {
      const inner = manifestIn(workspace)
      return inner === undefined ? [] : [inner]
    }),
  ]
}
