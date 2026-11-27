import type { Permission } from './catalog'

/**
 * The built-in roles: few, and fixed in code so they gain new permissions as features are added. People choose
 * between these; every check underneath is against a permission.
 */

export const organizationRoles = ['owner', 'admin', 'member', 'billing_manager', 'auditor'] as const
export type OrganizationRole = (typeof organizationRoles)[number]

/** Access to one project, lowest first. */
export const projectAccessLevels = ['view', 'contribute', 'maintain', 'admin'] as const
export type ProjectAccess = (typeof projectAccessLevels)[number]

export const accessRank = (access: ProjectAccess): number => projectAccessLevels.indexOf(access)

export const higherAccess = (a: ProjectAccess | undefined, b: ProjectAccess | undefined): ProjectAccess | undefined =>
  a === undefined ? b : b === undefined ? a : accessRank(a) >= accessRank(b) ? a : b

const admins: ReadonlyArray<Permission> = [
  'org.view',
  'org.manage',
  'members.invite',
  'members.manage',
  'roles.manage',
  'billing.view',
  'usage.view',
  'audit.view',
  'integrations.manage',
  'org.secrets.manage',
  'service_accounts.manage',
  'homes.manage',
  'pools.manage',
  'functions.manage',
]

/** What each organization role may do on the organization itself. A member's invite and project rights are the organization's settings. */
export const organizationPermissions: Record<OrganizationRole, ReadonlySet<Permission>> = {
  owner: new Set([...admins, 'org.delete', 'sign_in.manage', 'billing.manage', 'spend.manage', 'audit.export']),
  admin: new Set(admins),
  member: new Set(['org.view']),
  billing_manager: new Set(['org.view', 'billing.view', 'billing.manage', 'spend.manage', 'usage.view']),
  auditor: new Set(['org.view', 'usage.view', 'audit.view', 'audit.export']),
}

/** Organization roles that hold a seat. Billing managers and auditors see no project content and are free. */
export const seatRoles: ReadonlySet<OrganizationRole> = new Set(['owner', 'admin', 'member'])

/** Organization roles that are admin on every project that isn't private. */
export const projectAdminRoles: ReadonlySet<OrganizationRole> = new Set(['owner', 'admin'])

/** A team admin's rights over their team and the teams inside it. A team member may see the team. */
export const teamAdminPermissions: ReadonlySet<Permission> = new Set([
  'team.view',
  'team.manage',
  'team.members.manage',
  'team.setup.manage',
  'team.spend.manage',
  'projects.create',
])

const view: ReadonlyArray<Permission> = ['project.view', 'project.comment']
const contribute: ReadonlyArray<Permission> = [
  ...view,
  'coordinator.talk',
  'tasks.run',
  'tasks.steer',
  'asks.answer',
  'changes.ship',
  'reviews.post',
  'issues.manage',
  'notes.manage',
  'runs.use',
  'work.download',
  'compute.spend',
]
const maintain: ReadonlyArray<Permission> = [
  ...contribute,
  'changes.merge',
  'terminals.use',
  'automations.run',
  'automations.manage',
  'tools.manage',
  'repositories.manage',
  'rules.tighten',
  'project.manage',
]
const admin: ReadonlyArray<Permission> = [
  ...maintain,
  'rules.loosen',
  'project.setup.manage',
  'secrets.manage',
  'places.manage',
  'project.access',
  'project.delete',
  'project.transfer',
]

/** What each level of project access may do. */
export const projectPermissions: Record<ProjectAccess, ReadonlySet<Permission>> = {
  view: new Set(view),
  contribute: new Set(contribute),
  maintain: new Set(maintain),
  admin: new Set(admin),
}

/** For permissions that come as `own` or `any`: the lowest access that reaches anyone's tasks. */
export const anyTaskFrom: ProjectAccess = 'maintain'
