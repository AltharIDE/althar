import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Effect } from 'effect'
import { SkillStoreFailed } from './errors'
import { looksExecutable } from './executable'
import { io, lockTree, unlockTree } from './files'
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
 * `agents`: `<agent>/.agents/skills/<id>/…`, the Agent Skills folder Codex looks for in each of a session's added
 * directories, so `directory` is handed to it as one.
 */
export type Layout = 'plain' | 'claude-plugin' | 'agents'

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
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const refused = (message: string) => new SkillStoreFailed({ message })

const SAFE_NAME = /^[\w.-]+$/
const safeName = (name: string) => SAFE_NAME.test(name) && name !== '.' && name !== '..'

/**
 * Lays one run's chosen skills out for one agent, as read-only copies under `runs/<run-id>/<agent>/`, folders and
 * files alike. The overlay is Althar's, outside every project: it refuses a store inside any of `keepOutOf` (a
 * repository's working tree), so a mistaken path cannot put skill files in a checkout.
 * Which native directory an agent reads this from is the adapter's job, once probed.
 */
export const projectRun = (input: {
  readonly root: string
  readonly runId: string
  readonly agent: string
  readonly selected: ReadonlyArray<Selected>
  readonly capabilities: ReadonlyArray<string>
  readonly keepOutOf: ReadonlyArray<string>
  readonly layout?: Layout
}): Effect.Effect<Projected, SkillStoreFailed> =>
  Effect.gen(function* () {
    const { root, runId, agent, selected, capabilities, keepOutOf, layout = 'plain' } = input
    if (!safeName(runId) || !safeName(agent)) return yield* refused('unsafe run or agent name')
    const base = join(root, 'runs', runId, agent)
    const directory = layout === 'claude-plugin' ? join(base, 'plugin') : base
    const skillsAt =
      layout === 'claude-plugin' ? join(directory, 'skills') : layout === 'agents' ? join(directory, '.agents', 'skills') : directory
    const where = yield* io('resolving the run folder', () => canonical(base))
    for (const repository of keepOutOf) {
      const there = yield* io('resolving a repository', () => canonical(repository))
      if (inside(where, there)) return yield* refused(`${base} is inside the repository ${repository}`)
      if (inside(there, where)) return yield* refused(`the repository ${repository} is inside ${base}, which is removed first`)
    }
    const seen = new Set<string>()
    for (const { id, treeHash } of selected) {
      if (seen.has(id)) return yield* refused(`the skill ${id} is selected twice`)
      seen.add(id)
      if (!isTreeHash(treeHash)) return yield* refused(`the skill ${id} has no valid tree hash`)
    }
    const projected: string[] = []
    const omitted: Array<{ id: string; missing: string[] }> = []
    // A copy laid out before is read-only, folders too: opened up first, so it can be replaced.
    yield* unlockTree(base)
    yield* io('clearing the run folder', async () => {
      await rm(base, { recursive: true, force: true })
      await mkdir(skillsAt, { recursive: true })
    })
    if (layout === 'claude-plugin') {
      const manifest = join(directory, '.claude-plugin', 'plugin.json')
      yield* io('writing the plugin manifest', async () => {
        await mkdir(dirname(manifest), { recursive: true })
        await writeFile(
          manifest,
          `${JSON.stringify({ name: 'althar', description: 'Skills Althar selected for this run', version: '0.0.0' }, null, 2)}\n`,
          { mode: 0o444 },
        )
      })
    }
    for (const skill of selected) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id)) return yield* refused(`unsafe skill id: ${skill.id}`)
      const missing = (skill.needs ?? []).filter((need) => !capabilities.includes(need))
      if (missing.length > 0) {
        omitted.push({ id: skill.id, missing })
        continue
      }
      const files = yield* readObject(root, skill.treeHash)
      yield* io(`copying ${skill.id}`, async () => {
        for (const [path, bytes] of files) {
          const target = join(skillsAt, skill.id, path)
          await mkdir(dirname(target), { recursive: true })
          // Read-only; a script stays runnable, as the skill's text runs it by its path (the agent runs it, under its rules).
          await writeFile(target, bytes, { mode: looksExecutable(path) ? 0o555 : 0o444 })
        }
      })
      projected.push(skill.id)
    }
    yield* lockTree(base)
    return { directory, projected, omitted }
  })

/** Removes a finished run's projection, its read-only folders opened up first. */
export const releaseRun = (root: string, runId: string): Effect.Effect<void, SkillStoreFailed> =>
  Effect.gen(function* () {
    if (!safeName(runId)) return yield* refused('unsafe run name')
    const directory = join(root, 'runs', runId)
    yield* unlockTree(directory)
    yield* io('removing the run folder', () => rm(directory, { recursive: true, force: true }))
  })
