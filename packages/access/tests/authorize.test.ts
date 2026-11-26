import { describe, expect, it } from 'vitest'

import { authorize, holdsSeat, indexList, reachOf, type Request, visibleProjects } from '../src'
import { NOW, northbank, P, PROJ, REPO, SVC, T } from './fixtures'

const index = indexList(northbank)
const person = (id: string) => ({ kind: 'person' as const, id })
const ask = (request: Omit<Request, 'now'> & { now?: number }) => authorize(index, { now: NOW, ...request })
const reach = (who: string, project: string) => reachOf(index, person(who), index.projects.get(project)!, NOW)

describe('project access', () => {
  it('gives the owning team its default, and counts membership upward', () => {
    expect(reach(P.ana, PROJ.fx).access).toBe('contribute')
    // Pam is in Payments, beside FX Manager: no default there, and no base access in this organization.
    expect(reach(P.pam, PROJ.fx).access).toBeUndefined()
    expect(ask({ actor: person(P.pam), permission: 'project.view', project: PROJ.fx })).toEqual({ allowed: false, reason: 'not_found' })
  })

  it('makes organization owners and admins of a team above admin, but not on a private project', () => {
    expect(reach(P.owner, PROJ.fx).access).toBe('admin')
    expect(reach(P.ada, PROJ.fx).access).toBe('admin')
    expect(reach(P.ben, PROJ.fx).access).toBe('admin')
    expect(reach(P.ben, PROJ.payments).access).toBeUndefined()
    expect(reach(P.owner, PROJ.secret).access).toBeUndefined()
    expect(reach(P.ana, PROJ.secret).access).toBe('view')
  })

  it('applies base access to members, never to guests', () => {
    const open = indexList({ ...northbank, baseAccess: 'view' })
    expect(reachOf(open, person(P.pam), open.projects.get(PROJ.fx)!, NOW).access).toBe('view')
    expect(reachOf(open, person(P.gus), open.projects.get(PROJ.fx)!, NOW).access).toBeUndefined()
    expect(reachOf(open, person(P.bill), open.projects.get(PROJ.company)!, NOW).access).toBeUndefined()
  })

  it('lets Contribute steer and answer only its own tasks, and Maintain anyone’s', () => {
    const steer = { permission: 'tasks.steer', project: PROJ.fx } as const
    expect(ask({ actor: person(P.ana), ...steer, taskOwner: P.ana }).allowed).toBe(true)
    expect(ask({ actor: person(P.ana), ...steer, taskOwner: P.ben })).toEqual({ allowed: false, reason: 'others_task' })
    expect(ask({ actor: person(P.ana), ...steer })).toEqual({ allowed: false, reason: 'others_task' })
    expect(ask({ actor: person(P.ben), permission: 'asks.answer', project: PROJ.fx, taskOwner: P.ana }).allowed).toBe(true)
  })

  it('keeps merging and terminals from Contribute', () => {
    expect(ask({ actor: person(P.ana), permission: 'changes.merge', project: PROJ.fx, repositories: [REPO.web] })).toEqual({
      allowed: false,
      reason: 'not_permitted',
    })
    expect(ask({ actor: person(P.ana), permission: 'terminals.use', project: PROJ.fx }).allowed).toBe(false)
    expect(ask({ actor: person(P.ben), permission: 'terminals.use', project: PROJ.fx }).allowed).toBe(true)
  })

  it('limits a grant to the repositories it names, and lets it read the rest when it says so', () => {
    expect(reach(P.sofia, PROJ.fx)).toEqual({ access: 'contribute', writes: new Set([REPO.design]), reads: 'all' })
    const run = { actor: person(P.sofia), permission: 'tasks.run', project: PROJ.fx } as const
    expect(ask({ ...run, repositories: [REPO.design] }).allowed).toBe(true)
    expect(ask({ ...run, repositories: [] }).allowed).toBe(true)
    expect(ask({ ...run, repositories: [REPO.design, REPO.api] })).toEqual({ allowed: false, reason: 'repository_not_writable' })
    expect(ask(run)).toEqual({ allowed: false, reason: 'repository_not_writable' })
    expect(ask({ actor: person(P.sofia), permission: 'project.view', project: PROJ.fx }).allowed).toBe(true)
  })

  it('reads only the repositories it writes when the grant doesn’t read others', () => {
    const narrow = indexList({
      ...northbank,
      grants: northbank.grants.map((grant) => (grant.principal.id === P.sofia ? { ...grant, readsOthers: false } : grant)),
    })
    expect(reachOf(narrow, person(P.sofia), narrow.projects.get(PROJ.fx)!, NOW).reads).toEqual(new Set([REPO.design]))
  })

  it('ends a grant on its date', () => {
    expect(ask({ actor: person(P.gus), permission: 'tasks.run', project: PROJ.payments, repositories: [] }).allowed).toBe(true)
    const later = Date.parse('2025-12-01T00:00:00.000Z')
    expect(ask({ actor: person(P.gus), permission: 'project.view', project: PROJ.payments, now: later })).toEqual({
      allowed: false,
      reason: 'list_expired',
    })
    const longer = indexList({ ...northbank, expiresAt: '2026-01-01T00:00:00.000Z' })
    expect(authorize(longer, { actor: person(P.gus), permission: 'project.view', project: PROJ.payments, now: later })).toEqual({
      allowed: false,
      reason: 'not_found',
    })
  })

  it('grants a team’s access to everyone who counts as in it', () => {
    const withTeamGrant = indexList({
      ...northbank,
      grants: [
        ...northbank.grants,
        {
          id: `grant_${'9'.repeat(32)}`,
          principal: { kind: 'team', id: T.markets },
          project: PROJ.secret,
          access: 'view',
          writes: null,
          readsOthers: false,
          expiresAt: null,
        },
      ],
    })
    expect(reachOf(withTeamGrant, person(P.pam), withTeamGrant.projects.get(PROJ.secret)!, NOW).access).toBe('view')
    expect(reachOf(withTeamGrant, person(P.sofia), withTeamGrant.projects.get(PROJ.secret)!, NOW).access).toBeUndefined()
  })

  it('names what it can’t find', () => {
    expect(ask({ actor: person(P.ana), permission: 'project.view', project: `proj_${'f'.repeat(32)}` })).toEqual({
      allowed: false,
      reason: 'not_found',
    })
    expect(ask({ actor: person(P.ana), permission: 'project.view' })).toEqual({ allowed: false, reason: 'no_scope' })
    expect(ask({ actor: person(`act_${'f'.repeat(32)}`), permission: 'project.view', project: PROJ.fx })).toEqual({
      allowed: false,
      reason: 'unknown_actor',
    })
  })
})

describe('service accounts', () => {
  const ci = { kind: 'service_account' as const, id: SVC.ci }

  it('act on their grants, but never give the person’s word', () => {
    expect(ask({ actor: ci, permission: 'tasks.run', project: PROJ.fx, repositories: [REPO.web] }).allowed).toBe(true)
    expect(ask({ actor: ci, permission: 'tasks.steer', project: PROJ.fx, taskOwner: P.ana }).allowed).toBe(true)
    expect(ask({ actor: ci, permission: 'asks.answer', project: PROJ.fx, taskOwner: P.ana })).toEqual({
      allowed: false,
      reason: 'needs_person',
    })
    expect(ask({ actor: ci, permission: 'changes.merge', project: PROJ.fx, repositories: [] })).toEqual({
      allowed: false,
      reason: 'needs_person',
    })
    expect(ask({ actor: ci, permission: 'org.view' })).toEqual({ allowed: false, reason: 'not_permitted' })
    expect(ask({ actor: { kind: 'service_account', id: `svc_${'f'.repeat(32)}` }, permission: 'project.view', project: PROJ.fx })).toEqual({
      allowed: false,
      reason: 'unknown_actor',
    })
    expect(visibleProjects(index, ci, NOW)).toEqual(new Set([PROJ.fx]))
    expect(
      reachOf(index, { kind: 'service_account', id: `svc_${'f'.repeat(32)}` }, index.projects.get(PROJ.fx)!, NOW).access,
    ).toBeUndefined()
  })
})

describe('the organization and its teams', () => {
  it('follows organization roles', () => {
    expect(ask({ actor: person(P.owner), permission: 'billing.manage' }).allowed).toBe(true)
    expect(ask({ actor: person(P.bill), permission: 'billing.manage' }).allowed).toBe(true)
    expect(ask({ actor: person(P.ana), permission: 'billing.view' }).allowed).toBe(false)
    expect(ask({ actor: person(P.ana), permission: 'org.view' }).allowed).toBe(true)
    expect(ask({ actor: person(P.gus), permission: 'org.view' })).toEqual({ allowed: false, reason: 'not_permitted' })
  })

  it('lets members invite only when the organization allows it', () => {
    expect(ask({ actor: person(P.ana), permission: 'members.invite' }).allowed).toBe(false)
    const inviting = indexList({ ...northbank, membersMayInvite: true })
    expect(authorize(inviting, { actor: person(P.ana), permission: 'members.invite', now: NOW }).allowed).toBe(true)
  })

  it('lets team admins run their team and those inside it', () => {
    expect(ask({ actor: person(P.ben), permission: 'team.setup.manage', team: T.fx }).allowed).toBe(true)
    expect(ask({ actor: person(P.ben), permission: 'team.setup.manage', team: T.markets }).allowed).toBe(false)
    expect(ask({ actor: person(P.ada), permission: 'team.members.manage', team: T.payments }).allowed).toBe(true)
    expect(ask({ actor: person(P.owner), permission: 'team.manage', team: T.design }).allowed).toBe(true)
    expect(ask({ actor: person(P.ana), permission: 'team.view', team: T.markets }).allowed).toBe(true)
    expect(ask({ actor: person(P.ana), permission: 'team.view', team: T.design }).allowed).toBe(false)
    expect(ask({ actor: person(P.ana), permission: 'team.view', team: `team_${'f'.repeat(32)}` })).toEqual({
      allowed: false,
      reason: 'unknown_team',
    })
  })

  it('lets members make projects in their teams when allowed, and admins make the organization’s own', () => {
    expect(ask({ actor: person(P.ana), permission: 'projects.create', team: T.fx }).allowed).toBe(true)
    expect(ask({ actor: person(P.ana), permission: 'projects.create', team: T.design }).allowed).toBe(false)
    expect(ask({ actor: person(P.ana), permission: 'projects.create' }).allowed).toBe(false)
    expect(ask({ actor: person(P.owner), permission: 'projects.create' }).allowed).toBe(true)
    const closed = indexList({ ...northbank, membersMayCreateProjects: false })
    expect(authorize(closed, { actor: person(P.ana), permission: 'projects.create', team: T.fx, now: NOW }).allowed).toBe(false)
  })
})

describe('feeds and seats', () => {
  it('lists the projects a member can see', () => {
    expect(visibleProjects(index, person(P.ana), NOW)).toEqual(new Set([PROJ.fx, PROJ.secret]))
    expect(visibleProjects(index, person(P.owner), NOW)).toEqual(new Set([PROJ.fx, PROJ.payments, PROJ.company]))
    expect(visibleProjects(index, person(P.ana), Date.parse(northbank.expiresAt))).toEqual(new Set())
  })

  it('counts members and contributing guests as seats', () => {
    expect(holdsSeat(index, P.ana, NOW)).toBe(true)
    expect(holdsSeat(index, P.bill, NOW)).toBe(false)
    expect(holdsSeat(index, P.gus, NOW)).toBe(true)
    expect(holdsSeat(index, P.gus, Date.parse('2025-12-02T00:00:00.000Z'))).toBe(false)
    expect(holdsSeat(index, `act_${'f'.repeat(32)}`, NOW)).toBe(false)
  })

  it('stops at a team that names itself as an ancestor', () => {
    const looped = indexList({
      ...northbank,
      teams: northbank.teams.map((team) => (team.id === T.markets ? { ...team, parent: T.fx } : team)),
    })
    expect(looped.ancestry.get(T.fx)).toEqual([T.fx, T.markets])
  })
})
