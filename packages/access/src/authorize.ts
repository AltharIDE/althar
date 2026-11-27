import { type Permission, permissionInfo } from './catalog'
import type { AccessList, Grant, Person, Project, Team } from './list'
import {
  accessRank,
  anyTaskFrom,
  higherAccess,
  organizationPermissions,
  type ProjectAccess,
  projectAdminRoles,
  projectPermissions,
  seatRoles,
  teamAdminPermissions,
} from './roles'

/**
 * One check, everywhere: may this principal do this, here? The cloud asks it of organization actions and every home
 * asks it of project ones, from the same access list, so both answer alike.
 *
 * Access only adds up: a person's grants, their teams' grants, their team's default and the organization's base access
 * combine, and the highest wins. There are no deny rules. Membership counts upward (someone in FX Manager also counts
 * as in Markets, which it sits in); administration reaches downward (an admin of Markets runs FX Manager's projects).
 */

export interface Index {
  readonly list: AccessList
  readonly expiresAt: number
  readonly people: ReadonlyMap<string, Person>
  readonly serviceAccounts: ReadonlySet<string>
  readonly teams: ReadonlyMap<string, Team>
  readonly projects: ReadonlyMap<string, Project>
  readonly grants: ReadonlyMap<string, ReadonlyArray<Grant>>
  /** Each team with the teams above it, itself first. */
  readonly ancestry: ReadonlyMap<string, ReadonlyArray<string>>
}

export const indexList = (list: AccessList): Index => {
  const teams = new Map(list.teams.map((team) => [team.id, team]))
  const ancestry = new Map<string, ReadonlyArray<string>>()
  for (const team of list.teams) {
    const chain: Array<string> = []
    let at: Team | undefined = team
    // A parent named twice would loop; a list the cloud made never has one, and the walk stops at the first repeat.
    while (at !== undefined && !chain.includes(at.id)) {
      chain.push(at.id)
      at = at.parent === null ? undefined : teams.get(at.parent)
    }
    ancestry.set(team.id, chain)
  }
  const grants = new Map<string, Array<Grant>>()
  for (const grant of list.grants) grants.set(grant.project, [...(grants.get(grant.project) ?? []), grant])
  return {
    list,
    expiresAt: Date.parse(list.expiresAt),
    people: new Map(list.people.map((person) => [person.id, person])),
    serviceAccounts: new Set(list.serviceAccounts.map((account) => account.id)),
    teams,
    projects: new Map(list.projects.map((project) => [project.id, project])),
    grants,
    ancestry,
  }
}

export type Actor = { readonly kind: 'person'; readonly id: string } | { readonly kind: 'service_account'; readonly id: string }

export interface Request {
  readonly actor: Actor
  readonly permission: Permission
  /** For a project permission. */
  readonly project?: string
  /** For a team permission. */
  readonly team?: string
  /** For a permission that comes as `own` or `any`: who owns the task it acts on. */
  readonly taskOwner?: string
  /** For a permission that changes repositories: every repository the action changes. An empty list changes none. */
  readonly repositories?: ReadonlyArray<string>
  /** Milliseconds since the epoch, from the caller's clock. */
  readonly now: number
}

export type Refusal =
  /** The list is past its expiry: the home waits for a new one. */
  | 'list_expired'
  /** Not on this home's list. */
  | 'unknown_actor'
  /** No such project, or none the actor can see: the caller answers "not found", never "forbidden". */
  | 'not_found'
  | 'unknown_team'
  /** A service account asked for a permission only a person's word gives. */
  | 'needs_person'
  | 'not_permitted'
  /** An `own` permission, on someone else's task. */
  | 'others_task'
  /** A grant limited to some repositories, and the action changes another or doesn't say which. */
  | 'repository_not_writable'
  /** The request named no project for a project permission, or no team for a team one. */
  | 'no_scope'

export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly reason: Refusal }

const allow: Decision = { allowed: true }
const refuse = (reason: Refusal): Decision => ({ allowed: false, reason })

/** Every team the person counts as in: those they belong to and every team above those. */
export const teamsOf = (index: Index, person: Person): ReadonlySet<string> =>
  new Set(person.teams.flatMap((membership) => index.ancestry.get(membership.team) ?? []))

/** Whether the person administers this team: an admin of it, or of a team above it. */
const administers = (index: Index, person: Person, team: string): boolean => {
  const above = new Set(index.ancestry.get(team) ?? [])
  return person.teams.some((membership) => membership.admin && above.has(membership.team))
}

const live = (grant: Grant, now: number): boolean => grant.expiresAt === null || Date.parse(grant.expiresAt) > now

/** What someone may do on one project, and which of its repositories their work may change and read. */
export interface Reach {
  readonly access: ProjectAccess | undefined
  readonly writes: 'all' | ReadonlySet<string>
  readonly reads: 'all' | ReadonlySet<string>
}

const none: Reach = { access: undefined, writes: new Set(), reads: new Set() }

export const reachOf = (index: Index, actor: Actor, project: Project, now: number): Reach => {
  let access: ProjectAccess | undefined
  let writesAll = false
  let readsAll = false
  const writes = new Set<string>()
  const unlimited = (level: ProjectAccess | null | undefined) => {
    if (level === null || level === undefined) return
    access = higherAccess(access, level)
    readsAll = true
    if (accessRank(level) >= accessRank('contribute')) writesAll = true
  }
  let principals: ReadonlySet<string>
  if (actor.kind === 'person') {
    const person = index.people.get(actor.id)
    if (person === undefined) return none
    const counted = teamsOf(index, person)
    principals = new Set([person.id, ...counted])
    if (!project.private) {
      if (person.role !== null && projectAdminRoles.has(person.role)) unlimited('admin')
      if (project.team !== null && administers(index, person, project.team)) unlimited('admin')
      if (project.team !== null && counted.has(project.team)) unlimited(index.teams.get(project.team)?.defaultAccess)
      if (person.role !== null && seatRoles.has(person.role)) unlimited(index.list.baseAccess)
    }
  } else {
    if (!index.serviceAccounts.has(actor.id)) return none
    principals = new Set([actor.id])
  }
  for (const grant of index.grants.get(project.id) ?? []) {
    if (!live(grant, now) || !principals.has(grant.principal.id)) continue
    if (grant.writes === null) {
      unlimited(grant.access)
      continue
    }
    access = higherAccess(access, grant.access)
    if (accessRank(grant.access) >= accessRank('contribute')) for (const repository of grant.writes) writes.add(repository)
    if (grant.readsOthers) readsAll = true
  }
  if (access === undefined) return none
  return {
    access,
    writes: writesAll ? 'all' : writes,
    reads: readsAll ? 'all' : writes,
  }
}

const projectDecision = (index: Index, request: Request): Decision => {
  if (request.project === undefined) return refuse('no_scope')
  const project = index.projects.get(request.project)
  if (project === undefined) return refuse('not_found')
  const reach = reachOf(index, request.actor, project, request.now)
  if (reach.access === undefined) return refuse('not_found')
  if (!projectPermissions[reach.access].has(request.permission)) return refuse('not_permitted')
  const info = permissionInfo(request.permission)
  if (info.qualified === true && accessRank(reach.access) < accessRank(anyTaskFrom) && request.taskOwner !== request.actor.id)
    return refuse('others_task')
  if (info.writes === true && reach.writes !== 'all') {
    const allowed = reach.writes
    if (request.repositories === undefined || request.repositories.some((repository) => !allowed.has(repository)))
      return refuse('repository_not_writable')
  }
  return allow
}

const teamDecision = (index: Index, person: Person, request: Request): Decision => {
  if (request.team === undefined) return refuse('no_scope')
  if (!index.teams.has(request.team)) return refuse('unknown_team')
  if (person.role !== null && projectAdminRoles.has(person.role)) return allow
  if (administers(index, person, request.team) && teamAdminPermissions.has(request.permission)) return allow
  const member = teamsOf(index, person).has(request.team)
  if (request.permission === 'team.view' && member) return allow
  if (request.permission === 'projects.create' && member && index.list.membersMayCreateProjects) return allow
  return refuse('not_permitted')
}

const organizationDecision = (index: Index, person: Person, request: Request): Decision => {
  if (person.role === null) return refuse('not_permitted')
  if (organizationPermissions[person.role].has(request.permission)) return allow
  if (request.permission === 'members.invite' && person.role === 'member' && index.list.membersMayInvite) return allow
  // Making a project owned by the organization itself, rather than a team.
  if (request.permission === 'projects.create' && projectAdminRoles.has(person.role)) return allow
  return refuse('not_permitted')
}

export const authorize = (index: Index, request: Request): Decision => {
  if (request.now >= index.expiresAt) return refuse('list_expired')
  const info = permissionInfo(request.permission)
  if (request.actor.kind === 'service_account') {
    if (!index.serviceAccounts.has(request.actor.id)) return refuse('unknown_actor')
    if (info.word === true) return refuse('needs_person')
    return info.scope === 'project' ? projectDecision(index, request) : refuse('not_permitted')
  }
  const person = index.people.get(request.actor.id)
  if (person === undefined) return refuse('unknown_actor')
  if (info.scope === 'project') return projectDecision(index, request)
  if (info.scope === 'team')
    return request.team === undefined ? organizationDecision(index, person, request) : teamDecision(index, person, request)
  return organizationDecision(index, person, request)
}

/** The projects someone can see at all: what a member's change feed carries. */
export const visibleProjects = (index: Index, actor: Actor, now: number): ReadonlySet<string> => {
  if (now >= index.expiresAt) return new Set()
  return new Set(
    index.list.projects.filter((project) => reachOf(index, actor, project, now).access !== undefined).map((project) => project.id),
  )
}

/** Whether a person takes a seat: an owner, admin or member, or a guest who can change something somewhere. */
export const holdsSeat = (index: Index, person: string, now: number): boolean => {
  const found = index.people.get(person)
  if (found === undefined) return false
  if (found.role !== null) return seatRoles.has(found.role)
  return index.list.projects.some((project) => {
    const access = reachOf(index, { kind: 'person', id: person }, project, now).access
    return access !== undefined && accessRank(access) >= accessRank('contribute')
  })
}
