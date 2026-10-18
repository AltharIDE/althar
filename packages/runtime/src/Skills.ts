import type { AgentDefinition } from '@althar/provider-adapters'
import { releaseRun, installLocalCatalog, projectRun, activeSelection } from '@althar/skills'

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
