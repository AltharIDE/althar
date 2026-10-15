import { releaseRun, installLocalCatalog, projectRun, activeSelection } from '@althar/skills'

/** Where the shared skill store is and the local catalog that seeds it (docs/plans/skills-across-harnesses.md). Without it, runs have no Althar-selected skills. */
export interface SkillsConfig {
  /** Althar's per-user skill store: objects, installs.json and runs (`@althar/skills`). Never inside a project. */
  readonly root: string
  /** A local catalog directory (`catalog.json` and `skills/<id>/`) installed as the default set. The person decides the real source later. */
  readonly catalog: string
}

export interface RunSkills {
  /** The folder to hand the agent as a local plugin. */
  readonly plugin: string
  /** Skills left out because Claude Code lacks a capability they need. */
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly missing: ReadonlyArray<string> }>
  readonly release: () => Promise<void>
}

/** What Claude Code can do that skills may need. It dispatches subagents. */
const CLAUDE_CODE_CAPABILITIES: ReadonlyArray<string> = ['subagents']

/**
 * The skills Althar selected for one Claude Code run, laid out under the store's `runs/<run-id>/` as a plugin for
 * that session alone. `keepOutOf` lists the run's repositories and worktrees: the store is refused inside any of them,
 * so a misplaced profile cannot put skill files in a checkout. Nothing is written to the person's Claude folder.
 */
export const claudeRunSkills = async (config: SkillsConfig, runId: string, keepOutOf: ReadonlyArray<string>): Promise<RunSkills> => {
  const catalog = await installLocalCatalog(config.root, config.catalog)
  const needs = new Map(catalog.skills.map(({ entry }) => [entry.id, entry.needs]))
  const projected = await projectRun({
    root: config.root,
    runId,
    agent: 'claude-code',
    selected: await activeSelection(config.root, needs),
    capabilities: CLAUDE_CODE_CAPABILITIES,
    keepOutOf,
    layout: 'claude-plugin',
  })
  return { plugin: projected.directory, omitted: projected.omitted, release: () => releaseRun(config.root, runId) }
}
