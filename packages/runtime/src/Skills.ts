import type { AgentDefinition } from '@althar/provider-adapters'
import { atLeastVersion } from '@althar/provider-adapters'
import {
  activeSelection,
  catalogEntries,
  type Install,
  installLocalCatalog,
  listInstalls,
  parseFrontmatter,
  projectRun,
  readObject,
  releaseRun,
  SkillRefused,
  type SkillStoreFailed,
} from '@althar/skills'
import { Cause, Effect, Option } from 'effect'

import { contained } from './Failures'

/** Where the shared skill store is and the local catalog that seeds it (docs/plans/skills-across-harnesses.md). Without it, runs have no Althar-selected skills. */
export interface SkillsConfig {
  /** Althar's per-user skill store: objects, installs.json and runs (`@althar/skills`). Never inside a project. */
  readonly root: string
  /** A local catalog directory (`catalog.json` and `skills/<id>/`) installed as the default set. The person decides the real source later. */
  readonly catalog: string
}

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

/** The bundled harness uses its pinned capabilities; an external host CLI must meet its declared minimum. */
export const skillsCapabilities = (
  definition: {
    readonly skills: { readonly capabilities: ReadonlyArray<string>; readonly externalMinimumVersion?: string } | null
  },
  version: string | null,
  external: boolean,
): ReadonlyArray<string> => {
  const skills = definition.skills
  if (skills === null) return []
  return external && skills.externalMinimumVersion !== undefined && !atLeastVersion(version, skills.externalMinimumVersion)
    ? []
    : skills.capabilities
}

/**
 * The skills Althar selected for one run of an agent, laid out under the store's `runs/<run-id>/<agent>/` as the
 * agent's registry entry says, for that session alone; undefined for an agent with no way to be given them. Every
 * agent is given the same active set, less what it can't do. `keepOutOf` lists the run's repositories and worktrees:
 * the store is refused inside any of them, so a misplaced profile cannot put skill files in a checkout. Nothing is
 * written to the agent's home or the person's own folders.
 */
export const runSkills = (
  config: SkillsConfig,
  definition: Pick<AgentDefinition, 'id' | 'skills'>,
  runId: string,
  keepOutOf: ReadonlyArray<string>,
  capabilities?: ReadonlyArray<string>,
): Effect.Effect<RunSkills | undefined, SkillStoreFailed> =>
  Effect.gen(function* () {
    const { skills } = definition
    if (skills === null) return undefined
    // A catalog that can't be installed, as when one record in installs.json doesn't read and the store is not written
    // over it, costs the run no skill the person already has: it is only read, for what each skill needs.
    const catalog = yield* installLocalCatalog(config.root, config.catalog).pipe(
      Effect.catch((error) =>
        Effect.logWarning('The skills catalog was not installed; the run gets what is installed', error).pipe(
          Effect.andThen(catalogEntries(config.catalog)),
        ),
      ),
    )
    const needs = new Map(catalog.entries.map((entry) => [entry.id, entry.needs]))
    const selected = yield* activeSelection(config.root, needs)
    const projected = yield* projectRun({
      root: config.root,
      runId,
      agent: definition.id,
      selected,
      capabilities: capabilities ?? skills.capabilities,
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

/** What the catalog says of a default: its licence and what it needs. */
type Known = ReadonlyMap<string, { readonly license: string; readonly needs: ReadonlyArray<string> }>

/**
 * The installed skills as the window lists them. Each is kept to itself (ADR-047): one whose record or stored files
 * don't read is listed with a `problem`, and the rest as they are; a catalog that doesn't load costs the list only
 * what the catalog says of its defaults. What Althar didn't expect is logged and reported.
 */
export const listSkills = (config: SkillsConfig) =>
  Effect.gen(function* () {
    const catalog = yield* installLocalCatalog(config.root, config.catalog).pipe(contained('ListSkills.catalog', () => null))
    const known: Known = new Map(catalog?.entries.map((entry) => [entry.id, entry]) ?? [])
    const listed = yield* listInstalls(config.root)
    const skills = []
    for (const one of listed) {
      skills.push(
        one.ok
          ? yield* describe(config.root, one.install, known).pipe(
              contained('ListSkills.skill', () => ({ ...viewOf(one.install, known, null), problem: UNREADABLE })),
            )
          : yield* Effect.die(new Error(`installs.json entry ${one.at + 1}: ${one.problem}`)).pipe(
              contained('ListSkills.skill', () => broken(one.id)),
            ),
      )
    }
    return { enabled: true, catalogRevision: catalog?.revision ?? null, skills }
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
  needs: [],
  canRollBack: false,
  problem: "Althar can't read what it keeps of this skill, so runs aren't given it.",
})

const decoder = new TextDecoder()

/** An install as the window shows it, with what its `SKILL.md` says where that was read. */
const viewOf = (install: Install, known: Known, front: Readonly<Record<string, unknown>> | null) => {
  const entry = install.source === 'althar-default' ? known.get(install.id) : undefined
  const said = (key: string) => {
    const value = front?.[key]
    return typeof value === 'string' ? value.trim() : null
  }
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

/** An installed skill as the window lists it, with what its stored `SKILL.md` says and what the catalog says it needs. */
export const describe = (root: string, install: Install, known: Known = new Map()) =>
  Effect.map(readObject(root, install.treeHash), (files) => {
    const skill = files.get('SKILL.md')
    return viewOf(install, known, skill === undefined ? null : (parseFrontmatter(decoder.decode(skill))?.data ?? null))
  })

/** The refusal a skills failure is, where it is one: the person's to put right, never a store that failed or a defect. */
export const refusalOf = (cause: Cause.Cause<unknown>): SkillRefused | undefined =>
  Option.getOrUndefined(Option.filter(Cause.findErrorOption(cause), (error): error is SkillRefused => error instanceof SkillRefused))
