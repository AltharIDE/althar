import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * How a repository runs, worked out from what is in it (ADR-023), until a
 * command is kept for it: its package.json's dev script, else its start or
 * serve script, run with the package manager its lockfile names, installing
 * first where it has packages and none are installed yet; else a Procfile's
 * web process; else a Makefile's dev, run or serve target. Nothing, where none
 * of these says. Installing never changes the lockfile, so a task's change
 * stays what its lead made.
 */

export interface RunCommand {
  /** What runs it: `bun run dev`. */
  readonly command: string
  /** What makes a fresh copy ready first, each time it runs; null for nothing. */
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

/** The command a package.json runs with, and what installs its packages first. */
const fromPackage = (folder: string, root: string, platform: NodeJS.Platform): RunCommand | null => {
  const text = read(join(folder, 'package.json'))
  if (text === null) return null
  let manifest: Readonly<Record<string, unknown>> | undefined
  try {
    manifest = recordOf(JSON.parse(text))
  } catch {
    return null
  }
  const scripts = recordOf(manifest?.scripts) ?? {}
  const script = SCRIPTS.find((name) => typeof scripts[name] === 'string')
  if (script === undefined) return null
  // The lockfile beside it, or at the repository's root in a folder of a larger one.
  const manager = MANAGERS.find((one) => existsSync(join(folder, one.lockfile)) || existsSync(join(root, one.lockfile)))
  const name = manager?.name ?? 'npm'
  const packages = [manifest?.dependencies, manifest?.devDependencies].some((field) => Object.keys(recordOf(field) ?? {}).length > 0)
  const install = manager?.install ?? 'npm install --no-package-lock'
  return { command: `${name} run ${script}`, setup: packages ? unlessInstalled(install, platform) : null }
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

/** The line a shell runs: what makes it ready, then the command. */
export const lineOf = (run: RunCommand) => (run.setup === null ? run.command : `(${run.setup}) && ${run.command}`)
