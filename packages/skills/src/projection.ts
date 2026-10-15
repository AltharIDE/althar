import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { readObject } from './store'

/** A skill chosen for a run: its id and the stored version to use. */
export interface Selected {
  readonly id: string
  readonly treeHash: string
  readonly needs?: ReadonlyArray<string>
}

export interface Projected {
  readonly directory: string
  readonly projected: ReadonlyArray<string>
  /** Skills left out because the agent lacks a capability they need; shown as a parity difference, not hidden. */
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly missing: ReadonlyArray<string> }>
}

const inside = (child: string, parent: string): boolean => {
  const path = relative(resolve(parent), resolve(child))
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
}): Promise<Projected> => {
  const { root, runId, agent, selected, capabilities, keepOutOf } = input
  if (!/^[\w.-]+$/.test(runId) || !/^[\w.-]+$/.test(agent) || runId === '.' || runId === '..') throw new Error('unsafe run or agent name')
  const directory = join(root, 'runs', runId, agent)
  for (const repository of keepOutOf) {
    if (inside(directory, repository)) throw new Error(`${directory} is inside the repository ${repository}`)
  }
  const projected: string[] = []
  const omitted: Array<{ id: string; missing: string[] }> = []
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  for (const skill of selected) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id)) throw new Error(`unsafe skill id: ${skill.id}`)
    const missing = (skill.needs ?? []).filter((need) => !capabilities.includes(need))
    if (missing.length > 0) {
      omitted.push({ id: skill.id, missing })
      continue
    }
    for (const [path, bytes] of await readObject(root, skill.treeHash)) {
      const target = join(directory, skill.id, path)
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
