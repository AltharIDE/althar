import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import type { ProjectWorker, ToolNeed, WorkerReadiness } from '@althar/contracts'
import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from './Instance'

/*
 * The tools a project's files say it needs, with why (as Orca's environment doctor reads a repository): its package
 * manager from `package.json`'s `packageManager` or its lockfile (`bun.lock` Bun, `pnpm-lock.yaml` pnpm, `yarn.lock` Yarn,
 * `package-lock.json` npm), and Node for any but Bun; Node's version from `.nvmrc`, `.node-version` or `engines.node`;
 * Bun's from `.bun-version`; uv where `uv.lock` or `pyproject.toml` say so, else Python; `Cargo.toml` cargo, `go.mod` Go,
 * `Gemfile` Bundler. Git every task needs, and a worker's own check says. For a worker, those it lacks (`needsOn`): the
 * ones it installs itself, without root, before a task's setup (Bun, Node, pnpm, uv), and the rest for its lead.
 */

export type Need = Omit<ToolNeed, 'installs'>

/** The tools a worker installs itself (apps/host/src/workerTools.ts). */
export const INSTALLED_BY_WORKER: ReadonlySet<string> = new Set(['bun', 'node', 'pnpm', 'uv'])

type Read = (path: string) => Promise<string | undefined>

/** A version as a project pins it: `v24.11.0` 24.11.0, `lts/*` lts, `^22.18.0 || >=24` 22; none where it pins none. */
export const pinnedVersion = (text: string | undefined): string | undefined => {
  const value = text?.trim()
  if (value === undefined || value === '') return undefined
  if (/^lts(\/|$)/iu.test(value)) return 'lts'
  const exact = /^v?(\d+(?:\.\d+){0,2})$/u.exec(value)
  if (exact !== null) return exact[1]
  return /(\d+)/u.exec(value)?.[1]
}

const parsed = (text: string | undefined): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text ?? '')
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** What a project's own files say it needs, each once, with the file that says so. */
export const projectNeeds = async (read: Read): Promise<ReadonlyArray<Need>> => {
  const needs: Need[] = []
  const add = (name: string, why: string, version?: string) => {
    if (needs.some((need) => need.name === name)) return
    needs.push({ name, why, ...(version === undefined ? {} : { version }) })
  }
  const has = async (path: string) => (await read(path)) !== undefined
  const pkg = await read('package.json')
  const manifest = parsed(pkg)
  const engines = typeof manifest.engines === 'object' && manifest.engines !== null ? (manifest.engines as Record<string, unknown>) : {}
  const declared = typeof manifest.packageManager === 'string' ? /^(bun|pnpm|yarn|npm)@([^+\s]+)/u.exec(manifest.packageManager) : null
  const manager =
    declared !== null
      ? { name: declared[1]!, why: 'package.json', version: pinnedVersion(declared[2]) }
      : (await has('bun.lock')) || (await has('bun.lockb'))
        ? { name: 'bun', why: (await has('bun.lock')) ? 'bun.lock' : 'bun.lockb' }
        : (await has('pnpm-lock.yaml'))
          ? { name: 'pnpm', why: 'pnpm-lock.yaml' }
          : (await has('yarn.lock'))
            ? { name: 'yarn', why: 'yarn.lock' }
            : pkg !== undefined
              ? { name: 'npm', why: (await has('package-lock.json')) ? 'package-lock.json' : 'package.json' }
              : undefined
  if (manager !== undefined) {
    const version =
      manager.version ??
      (manager.name === 'bun'
        ? pinnedVersion(await read('.bun-version'))
        : pinnedVersion(typeof engines[manager.name] === 'string' ? (engines[manager.name] as string) : undefined))
    add(manager.name, manager.why, version)
  }
  // Bun runs a project's scripts itself; every other manager runs on Node. A pinned Node counts either way.
  const nvmrc = await read('.nvmrc')
  const nodeVersion = await read('.node-version')
  const nodeWhy = nvmrc !== undefined ? '.nvmrc' : nodeVersion !== undefined ? '.node-version' : 'package.json'
  const node = pinnedVersion(nvmrc ?? nodeVersion ?? (typeof engines.node === 'string' ? engines.node : undefined))
  if ((manager !== undefined && manager.name !== 'bun') || nvmrc !== undefined || nodeVersion !== undefined) add('node', nodeWhy, node)
  const pyproject = await read('pyproject.toml')
  if ((await has('uv.lock')) || (pyproject !== undefined && /^\s*\[tool\.uv\b/mu.test(pyproject)))
    add('uv', (await has('uv.lock')) ? 'uv.lock' : 'pyproject.toml')
  else if (pyproject !== undefined || (await has('requirements.txt')))
    add('python3', pyproject !== undefined ? 'pyproject.toml' : 'requirements.txt')
  for (const [file, name] of [
    ['Cargo.toml', 'cargo'],
    ['go.mod', 'go'],
    ['Gemfile', 'bundle'],
  ] as const)
    if (await has(file)) add(name, file)
  return needs
}

/** Reads a project's needs from a checkout on this computer: its files at their top, or in its folder within. */
export const needsIn = (folder: string) =>
  projectNeeds(async (path) => {
    try {
      const file = join(folder, path)
      const stat = await fs.stat(file)
      // A lockfile can be large: whether it is there is what counts.
      return stat.isFile() ? (stat.size > 262_144 ? '' : await fs.readFile(file, 'utf8')) : undefined
    } catch {
      return undefined
    }
  })

/** What several folders' files need, each tool once, as the first folder that names it says: a task's repositories, each in its folder. */
export const needsInAll = async (folders: ReadonlyArray<string>): Promise<ReadonlyArray<Need>> => {
  const all: Need[] = []
  for (const needs of await Promise.all(folders.map(needsIn)))
    for (const need of needs) if (!all.some((one) => one.name === need.name)) all.push(need)
  return all
}

/** Whether a version a worker has is the one asked: the same, or of the same major or minor. */
const meets = (asked: string | undefined, have: string) =>
  asked === undefined || asked === 'lts' || have === asked || have.startsWith(`${asked}.`)

/**
 * What a worker lacks of a project's needs, as its own check found its tools: npm comes with a Node it installs; none
 * where it hasn't checked, as nothing is known.
 */
export const needsOn = (needs: ReadonlyArray<Need>, readiness: WorkerReadiness | undefined): ReadonlyArray<ToolNeed> | undefined => {
  if (readiness === undefined) return undefined
  const has = (name: string, version: string | undefined) =>
    readiness.tools.some((tool) => tool.name === name && meets(version, tool.version))
  const lacking = needs.filter((need) => !has(need.name, need.version))
  const installsNode = lacking.some((need) => need.name === 'node')
  const node = needs.find((need) => need.name === 'node')?.version
  return lacking.flatMap((need): ReadonlyArray<ToolNeed> => {
    // npm comes with Node's own build: the worker's own Node, which runs Althar, has none.
    if (need.name === 'npm')
      return installsNode ? [] : [{ name: 'node', why: need.why, ...(node === undefined ? {} : { version: node }), installs: true }]
    return [{ ...need, installs: INSTALLED_BY_WORKER.has(need.name) }]
  })
}

/** What a run asks its worker to install before its setup: each it lacks that it installs itself, at the version asked. */
export const toolsToInstall = (lacking: ReadonlyArray<ToolNeed> | undefined) =>
  (lacking ?? [])
    .filter((need) => need.installs)
    .map((need) => ({ name: need.name, version: need.version ?? (need.name === 'node' ? 'lts' : 'latest') }))

/** What each project's checkout here said it needs, and when: read again after a while, as its files change. */
const read = new Map<string, { readonly at: number; readonly needs: ReadonlyArray<Need> }>()
const READ_AGAIN = 30_000

/** A project's needs, from each of its repositories' checkouts on this computer (each in its folder within, where it has one). */
export const checkoutNeeds = (projectId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const kept = read.get(projectId)
    if (kept !== undefined && now - kept.at < READ_AGAIN) return kept.needs
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    // Every repository's, each in its folder, as its setup runs there.
    const found = yield* sql<{ path: string; folder: string | null }>`
      SELECT l.path, b.folder FROM repository_bindings b
      JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
    const needs = yield* Effect.promise(() => needsInAll(found.map((one) => (one.folder === null ? one.path : join(one.path, one.folder)))))
    read.set(projectId, { at: now, needs })
    return needs
  })

/** Each worker with what the project needs that it lacks, by its own check; one that hasn't checked, as it is. */
export const withNeeds = (workers: ReadonlyArray<ProjectWorker>, needs: ReadonlyArray<Need>): ReadonlyArray<ProjectWorker> =>
  workers.map((worker) => {
    const lacking = needsOn(needs, worker.readiness)
    return lacking === undefined || lacking.length === 0 ? worker : { ...worker, needs: lacking }
  })
