import type { AgentDefinition } from '@althar/provider-adapters'
import {
  activeSelection,
  type Install,
  listInstalls,
  parseFrontmatter,
  projectRun,
  readObject,
  releaseRun,
  removeBundledSkills,
  SkillRefused,
  type SkillStoreFailed,
} from '@althar/skills'
import { Cause, Effect, Layer, Option } from 'effect'

import { RuntimeConfig } from './Config'
import { contained } from './Failures'

/** Where the shared skill store is (docs/plans/skills-across-harnesses.md). Without it, runs have no Althar-selected skills. Althar ships none: the store holds what the person added from GitHub. */
export interface SkillsConfig {
  /** Althar's per-user skill store: objects, installs.json and runs (`@althar/skills`). Never inside a project. */
  readonly root: string
}

/**
 * On the first start after the update that stopped Althar shipping skills of its own: takes the ones an older Althar
 * installed out of the person's store, so no run is given them again, and leaves what they added from GitHub. Every
 * start after it finds nothing to do. A store that can't be changed is said in the log and left, and a read of the
 * store leaves those skills out meanwhile (`@althar/skills`' `legacy.ts`).
 */
export const dropShippedSkills = Effect.gen(function* () {
  const config = yield* RuntimeConfig
  if (config.skills === undefined) return
  const taken = yield* removeBundledSkills(config.skills.root).pipe(
    Effect.catch((error) =>
      Effect.logWarning('The skills Althar used to ship were not taken out of the store', error).pipe(
        Effect.as([] as ReadonlyArray<string>),
      ),
    ),
  )
  if (taken.length > 0) yield* Effect.logInfo('Took out the skills Althar used to ship').pipe(Effect.annotateLogs({ count: taken.length }))
})

export const shippedSkillsLayer = Layer.effectDiscard(dropShippedSkills)

/** A skill a run was given: its id and the stored version, by its tree hash, which is what the run's record keeps. */
export interface GivenSkill {
  readonly id: string
  readonly treeHash: string
}

export interface RunSkills {
  /** The folder the agent is pointed at, laid out as its registry entry's `skills.layout` says. */
  readonly folder: string
  /** The skills it is given, fixed for the run: each by id and the version it got. */
  readonly given: ReadonlyArray<GivenSkill>
  /** Skills left out because the agent lacks a capability they need. */
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly missing: ReadonlyArray<string> }>
  readonly release: Effect.Effect<void, SkillStoreFailed>
}

/**
 * The skills Althar selected for one run of an agent, laid out under the store's `runs/<run-id>/<agent>/` as the
 * agent's registry entry says, for that session alone; undefined for an agent with no way to be given them. Every
 * agent is given the same active set, less what it can't do. `keepOutOf` lists the run's repositories and worktrees:
 * the store is refused inside any of them, so a misplaced profile cannot put skill files in a checkout. Nothing is
 * written to the agent's home or the person's own folders. `held` names those the person turned off for the run's
 * role or project (`heldSkillsFor`): left out, so neither the folder nor the brief has them.
 */
export const runSkills = (
  config: SkillsConfig,
  definition: Pick<AgentDefinition, 'id' | 'skills'>,
  runId: string,
  keepOutOf: ReadonlyArray<string>,
  held: ReadonlySet<string> = new Set(),
): Effect.Effect<RunSkills | undefined, SkillStoreFailed> =>
  Effect.gen(function* () {
    const { skills } = definition
    if (skills === null) return undefined
    const selected = (yield* activeSelection(config.root)).filter(({ id }) => !held.has(id))
    const projected = yield* projectRun({
      root: config.root,
      runId,
      agent: definition.id,
      selected,
      capabilities: skills.capabilities,
      keepOutOf,
      layout: skills.layout,
    })
    const given = new Set(projected.projected)
    return {
      folder: projected.directory,
      given: selected.filter(({ id }) => given.has(id)).map(({ id, treeHash }) => ({ id, treeHash })),
      omitted: projected.omitted,
      release: releaseRun(config.root, runId),
    }
  })

/**
 * The installed skills as the window lists them. Each is kept to itself (ADR-047): one whose record or stored files
 * don't read is listed with a `problem`, and the rest as they are. What Althar didn't expect is logged and reported.
 */
export const listSkills = (config: SkillsConfig) =>
  Effect.gen(function* () {
    const listed = yield* listInstalls(config.root)
    const skills = []
    for (const one of listed) {
      skills.push(
        one.ok
          ? yield* describe(config.root, one.install).pipe(
              contained('ListSkills.skill', () => ({ ...viewOf(one.install, null), problem: UNREADABLE })),
            )
          : yield* Effect.die(new Error(`installs.json entry ${one.at + 1}: ${one.problem}`)).pipe(
              contained('ListSkills.skill', () => broken(one.id)),
            ),
      )
    }
    return { enabled: true, skills }
  })

const UNREADABLE = "Althar can't read this skill's stored files, so runs aren't given it. Install it again to put it right."

/** An install whose record doesn't read: named as it was, given to no run, with what is wrong. */
const broken = (id: string) => ({
  id,
  source: 'local' as const,
  description: null,
  license: null,
  repo: null,
  subpath: null,
  ref: null,
  sha: null,
  treeHash: '',
  review: 'not-reviewed' as const,
  active: false,
  canRollBack: false,
  problem: "Althar can't read what it keeps of this skill, so runs aren't given it.",
})

const decoder = new TextDecoder()

/** An install as the window shows it, with what its `SKILL.md` says where that was read. */
const viewOf = (install: Install, front: Readonly<Record<string, unknown>> | null) => {
  const said = (key: string) => {
    const value = front?.[key]
    return typeof value === 'string' ? value.trim() : null
  }
  return {
    id: install.id,
    source: install.source,
    description: said('description'),
    license: said('license'),
    repo: install.repo ?? null,
    subpath: install.subpath ?? null,
    ref: install.ref ?? null,
    sha: install.sha ?? null,
    treeHash: install.treeHash,
    review: install.review,
    active: install.active,
    canRollBack: (install.history?.length ?? 0) > 0,
  }
}

/** An installed skill as the window lists it, with what its stored `SKILL.md` says. */
export const describe = (root: string, install: Install) =>
  Effect.map(readObject(root, install.treeHash), (files) => {
    const skill = files.get('SKILL.md')
    return viewOf(install, skill === undefined ? null : (parseFrontmatter(decoder.decode(skill))?.data ?? null))
  })

/** The refusal a skills failure is, where it is one: the person's to put right, never a store that failed or a defect. */
export const refusalOf = (cause: Cause.Cause<unknown>): SkillRefused | undefined =>
  Option.getOrUndefined(Option.filter(Cause.findErrorOption(cause), (error): error is SkillRefused => error instanceof SkillRefused))
