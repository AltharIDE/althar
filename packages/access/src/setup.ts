import { Schema } from 'effect'

import { teamsOf, type Index } from './authorize'
import { FunctionId, ProjectId, TeamId } from './list'

/**
 * Which presets, skills and MCP servers reach one person's sessions on one project. Setup follows where the work is:
 * the organization, then each team from the top down to the one that owns the project, then the project. At each
 * level an item is for everyone or for one function, and is required, recommended or available. The person adds their
 * own and turns off what is only recommended. A team can also give its own people items that travel with them onto
 * other teams' projects, as recommendations only.
 */

export const SetupKind = Schema.Literals(['preset', 'skill', 'mcp_server'])
export type SetupKind = typeof SetupKind.Type

export const Standing = Schema.Literals(['required', 'recommended', 'available'])
export type Standing = typeof Standing.Type

export const Level = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('organization') }),
  Schema.Struct({ kind: Schema.Literal('team'), team: TeamId }),
  Schema.Struct({ kind: Schema.Literal('project'), project: ProjectId }),
])
export type Level = typeof Level.Type

export const SetupItem = Schema.Struct({
  kind: SetupKind,
  /** What two levels' items are compared by: a skill's or server's name, a preset's name. */
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  /** The content digest or version the level publishes. */
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  level: Level,
  standing: Standing,
  /** Null: for everyone at the level. */
  function: Schema.NullOr(FunctionId),
  /** "projects": on the projects the level holds. "people": with a team's members wherever they work, as a recommendation. */
  reach: Schema.Literals(['projects', 'people']),
})
export type SetupItem = typeof SetupItem.Type

/** The person's own: an item they added, or a choice about one a level gave. */
export interface Own {
  readonly added: ReadonlyArray<{ readonly kind: SetupKind; readonly name: string; readonly version: string }>
  /** By `kind:name`. On turns an available item on; off turns a recommended one off. Required ignores both. */
  readonly choices: ReadonlyMap<string, boolean>
}

export type Source = { readonly kind: 'level'; readonly level: Level; readonly standing: Standing } | { readonly kind: 'own' }

export interface Resolved {
  readonly kind: SetupKind
  readonly name: string
  readonly version: string
  readonly from: Source
}

export interface Unsettled {
  readonly kind: SetupKind
  readonly name: string
  /** Every version offered, with where it came from: the person picks, or a level's admins settle it. */
  readonly offers: ReadonlyArray<Resolved>
}

export interface Resolution {
  /** What the session gets, recorded with it. */
  readonly on: ReadonlyArray<Resolved>
  /** What the person could turn on, or turned off. */
  readonly off: ReadonlyArray<Resolved>
  readonly toSettle: ReadonlyArray<Unsettled>
}

export const keyOf = (item: { readonly kind: SetupKind; readonly name: string }): string => `${item.kind}:${item.name}`

/**
 * How close a level is: higher is closer. What a team's people bring with them sits just above the organization, so
 * the teams and the project where the work is win a clash with it.
 */
const PEOPLE = 0.5

export const resolveSetup = (
  index: Index,
  input: { readonly person: string; readonly project: string; readonly items: ReadonlyArray<SetupItem>; readonly own: Own },
): Resolution => {
  const person = index.people.get(input.person)
  const project = index.projects.get(input.project)
  if (person === undefined || project === undefined) return { on: [], off: [], toSettle: [] }

  // Top down: the organization, the owning team's chain from the top, then the project.
  const chain = project.team === null ? [] : [...(index.ancestry.get(project.team) ?? [])].reverse()
  const depth = new Map(chain.map((team, at) => [team, at + 1]))
  const own = new Set(teamsOf(index, person))
  const functions = new Set(person.projectFunctions.find((entry) => entry.project === project.id)?.functions ?? person.functions)

  const distance = (item: SetupItem): number | undefined => {
    if (item.function !== null && !functions.has(item.function)) return undefined
    const { level } = item
    if (item.reach === 'people') {
      if (level.kind !== 'team' || !own.has(level.team) || depth.has(level.team)) return undefined
      return PEOPLE
    }
    if (level.kind === 'organization') return 0
    if (level.kind === 'team') return depth.get(level.team)
    return level.project === project.id ? chain.length + 1 : undefined
  }

  const byKey = new Map<string, Array<{ item: SetupItem; at: number }>>()
  for (const item of input.items) {
    const at = distance(item)
    if (at === undefined) continue
    // What travels with people is a recommendation, never imposed on another team's project.
    const offered = item.reach === 'people' && item.standing === 'required' ? { ...item, standing: 'recommended' as const } : item
    byKey.set(keyOf(item), [...(byKey.get(keyOf(item)) ?? []), { item: offered, at }])
  }
  for (const added of input.own.added) if (!byKey.has(keyOf(added))) byKey.set(keyOf(added), [])

  const on: Array<Resolved> = []
  const off: Array<Resolved> = []
  const toSettle: Array<Unsettled> = []
  const resolved = (item: SetupItem): Resolved => ({
    kind: item.kind,
    name: item.name,
    version: item.version,
    from: { kind: 'level', level: item.level, standing: item.standing },
  })

  for (const [key, offers] of byKey) {
    const added = input.own.added.find((entry) => keyOf(entry) === key)
    const required = offers.filter((offer) => offer.item.standing === 'required').sort((a, b) => a.at - b.at)
    if (required.length > 0) {
      // The furthest level that requires it wins: an organization's requirement isn't overridden by a team's.
      const winner = required[0]!.item
      on.push(resolved(winner))
      const versions = new Set(required.map((offer) => offer.item.version))
      if (added !== undefined && added.version !== winner.version) versions.add(added.version)
      if (versions.size > 1)
        toSettle.push({
          kind: winner.kind,
          name: winner.name,
          offers: [
            ...required.map((offer) => resolved(offer.item)),
            ...(added === undefined || added.version === winner.version ? [] : [{ ...added, from: { kind: 'own' as const } }]),
          ],
        })
      continue
    }
    if (added !== undefined) {
      on.push({ ...added, from: { kind: 'own' } })
      continue
    }
    // Otherwise the closest level wins; two offers at that same level that differ are for someone to settle.
    const closest = Math.max(...offers.map((offer) => offer.at))
    const nearest = offers.filter((offer) => offer.at === closest)
    const winner = nearest[0]!.item
    if (new Set(nearest.map((offer) => offer.item.version)).size > 1)
      toSettle.push({ kind: winner.kind, name: winner.name, offers: nearest.map((offer) => resolved(offer.item)) })
    const choice = input.own.choices.get(key)
    const wanted = winner.standing === 'recommended' ? choice !== false : choice === true
    ;(wanted ? on : off).push(resolved(winner))
  }

  const order = (a: { readonly kind: SetupKind; readonly name: string }, b: { readonly kind: SetupKind; readonly name: string }) =>
    keyOf(a).localeCompare(keyOf(b))
  return { on: on.sort(order), off: off.sort(order), toSettle: toSettle.sort(order) }
}
