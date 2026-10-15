import { chmod, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isTreeHash, readObject } from './store'

/** A skill chosen for a run: its id and the stored version to use. */
export interface Selected {
  readonly id: string
  readonly treeHash: string
  readonly needs?: ReadonlyArray<string>
}

/**
 * How a run's directory is laid out. `plain`: `<agent>/<id>/…`. `claude-plugin`: a local plugin Claude Code loads
 * for the session alone (`plugins: [{ type: 'local', path }]`), `<agent>/plugin/skills/<id>/…` with a manifest
 * that names no hooks, commands, agents or servers, so nothing is written to the person's Claude home or a repository.
 */
export type Layout = 'plain' | 'claude-plugin'

export interface Projected {
  readonly directory: string
  readonly projected: ReadonlyArray<string>
  /** Skills left out because the agent lacks a capability they need; shown as a parity difference, not hidden. */
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly missing: ReadonlyArray<string> }>
}

/** The path with symlinks resolved in its deepest existing part, so an alias cannot hide an overlap. */
const canonical = async (path: string): Promise<string> => {
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(await canonical(parent), basename(absolute))
  }
}

const inside = (child: string, parent: string): boolean => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/**
 * Lays one run's chosen skills out for one agent, as read-only copies under `runs/<run-id>/<agent>/`.
 * The overlay is Althar's, outside every project: it refuses a store inside any of `keepOutOf` (a
 * repository's working tree), so a mistaken path cannot put skill files in a checkout.
 * Which native directory an agent reads this from is the adapter's job, once probed.
 */
export const projectRun = async (input: {
  readonly root: string
  readonly runId: string
  readonly agent: string
  readonly selected: ReadonlyArray<Selected>
  readonly capabilities: ReadonlyArray<string>
  readonly keepOutOf: ReadonlyArray<string>
  readonly layout?: Layout
}): Promise<Projected> => {
  const { root, runId, agent, selected, capabilities, keepOutOf, layout = 'plain' } = input
  if (!/^[\w.-]+$/.test(runId) || !/^[\w.-]+$/.test(agent) || runId === '.' || runId === '..') throw new Error('unsafe run or agent name')
  const base = join(root, 'runs', runId, agent)
  const directory = layout === 'claude-plugin' ? join(base, 'plugin') : base
  const skillsAt = layout === 'claude-plugin' ? join(directory, 'skills') : directory
  const where = await canonical(base)
  for (const repository of keepOutOf) {
    const there = await canonical(repository)
    if (inside(where, there)) throw new Error(`${base} is inside the repository ${repository}`)
    if (inside(there, where)) throw new Error(`the repository ${repository} is inside ${base}, which is removed first`)
  }
  const seen = new Set<string>()
  for (const { id, treeHash } of selected) {
    if (seen.has(id)) throw new Error(`the skill ${id} is selected twice`)
    seen.add(id)
    if (!isTreeHash(treeHash)) throw new Error(`the skill ${id} has no valid tree hash`)
  }
  const projected: string[] = []
  const omitted: Array<{ id: string; missing: string[] }> = []
  await rm(base, { recursive: true, force: true })
  await mkdir(skillsAt, { recursive: true })
  if (layout === 'claude-plugin') {
    const manifest = join(directory, '.claude-plugin', 'plugin.json')
    await mkdir(dirname(manifest), { recursive: true })
    await writeFile(
      manifest,
      `${JSON.stringify({ name: 'althar', description: 'Skills Althar selected for this run', version: '0.0.0' }, null, 2)}\n`,
      { mode: 0o444 },
    )
  }
  for (const skill of selected) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id)) throw new Error(`unsafe skill id: ${skill.id}`)
    const missing = (skill.needs ?? []).filter((need) => !capabilities.includes(need))
    if (missing.length > 0) {
      omitted.push({ id: skill.id, missing })
      continue
    }
    for (const [path, bytes] of await readObject(root, skill.treeHash)) {
      const target = join(skillsAt, skill.id, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes, { mode: 0o444 })
    }
    projected.push(skill.id)
  }
  return { directory, projected, omitted }
}

/** Removes a finished run's projection. */
export const releaseRun = async (root: string, runId: string): Promise<void> => {
  if (!/^[\w.-]+$/.test(runId) || runId === '.' || runId === '..') throw new Error('unsafe run name')
  const directory = join(root, 'runs', runId)
  await chmodTree(directory)
  await rm(directory, { recursive: true, force: true })
}

const chmodTree = async (directory: string): Promise<void> => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  await chmod(directory, 0o755)
  for (const entry of entries) if (entry.isDirectory()) await chmodTree(join(directory, entry.name))
}
