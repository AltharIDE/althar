import type { AgentDefinition } from '@althar/provider-adapters'
import {
  activeSelection,
  type Install,
  installLocalCatalog,
  parseFrontmatter,
  projectRun,
  readInstalls,
  readObject,
  releaseRun,
} from '@althar/skills'

/** Where the shared skill store is and the local catalog that seeds it (docs/plans/skills-across-harnesses.md). Without it, runs have no Althar-selected skills. */
export interface SkillsConfig {
  /** Althar's per-user skill store: objects, installs.json and runs (`@althar/skills`). Never inside a project. */
  readonly root: string
  /** A local catalog directory (`catalog.json` and `skills/<id>/`) installed as the default set. The person decides the real source later. */
  readonly catalog: string
}

export interface RunSkills {
  /** The folder the agent is pointed at, laid out as its registry entry's `skills.layout` says. */
  readonly folder: string
  /** The skills it is given. */
  readonly projected: ReadonlyArray<string>
  /** Skills left out because the agent lacks a capability they need. */
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly missing: ReadonlyArray<string> }>
  readonly release: () => Promise<void>
}

/**
 * The skills Althar selected for one run of an agent, laid out under the store's `runs/<run-id>/<agent>/` as the
 * agent's registry entry says, for that session alone; undefined for an agent with no way to be given them. Every
 * agent is given the same active set, less what it can't do. `keepOutOf` lists the run's repositories and worktrees:
 * the store is refused inside any of them, so a misplaced profile cannot put skill files in a checkout. Nothing is
 * written to the agent's home or the person's own folders.
 */
export const runSkills = async (
  config: SkillsConfig,
  definition: Pick<AgentDefinition, 'id' | 'skills'>,
  runId: string,
  keepOutOf: ReadonlyArray<string>,
): Promise<RunSkills | undefined> => {
  const { skills } = definition
  if (skills === undefined) return undefined
  const catalog = await installLocalCatalog(config.root, config.catalog)
  const needs = new Map(catalog.skills.map(({ entry }) => [entry.id, entry.needs]))
  const projected = await projectRun({
    root: config.root,
    runId,
    agent: definition.id,
    selected: await activeSelection(config.root, needs),
    capabilities: skills.capabilities,
    keepOutOf,
    layout: skills.layout,
  })
  return {
    folder: projected.directory,
    projected: projected.projected,
    omitted: projected.omitted,
    release: () => releaseRun(config.root, runId),
  }
}

/** An installed skill as the window lists it, with what its stored `SKILL.md` says and what the catalog says it needs. */
export const listSkills = async (config: SkillsConfig) => {
  const catalog = await installLocalCatalog(config.root, config.catalog)
  const known = new Map(catalog.skills.map(({ entry }) => [entry.id, entry]))
  const read = await readInstalls(config.root)
  if (!read.ok) throw new Error(read.error)
  const skills = []
  for (const install of read.value.installs) skills.push(await describe(config.root, install, known))
  return { enabled: true, catalogRevision: catalog.revision, skills }
}

const decoder = new TextDecoder()

/** What the catalog says of a default: its licence and what it needs. */
type Known = ReadonlyMap<string, { readonly license: string; readonly needs: ReadonlyArray<string> }>

export const describe = async (root: string, install: Install, known: Known = new Map()) => {
  const entry = install.source === 'althar-default' ? known.get(install.id) : undefined
  const skill = (await readObject(root, install.treeHash)).get('SKILL.md')
  const front = skill === undefined ? null : parseFrontmatter(decoder.decode(skill))?.data
  const said = (key: string) => (typeof front?.[key] === 'string' ? (front[key] as string).trim() : null)
  return {
    id: install.id,
    source: install.source,
    description: said('description'),
    license: said('license') ?? entry?.license ?? null,
    repo: install.repo ?? null,
    subpath: install.subpath ?? null,
    ref: install.ref ?? null,
    sha: install.sha ?? null,
    treeHash: install.treeHash,
    review: install.review,
    active: install.active,
    needs: [...(entry?.needs ?? [])],
    canRollBack: (install.history?.length ?? 0) > 0,
  }
}
