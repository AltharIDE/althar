import { Schema } from 'effect'

import { organizationRoles, projectAccessLevels } from './roles'

/**
 * The access list Althar Cloud compiles for one home: who may act there, through which teams and grants, on which
 * projects. The cloud signs it (sign.ts); the home keeps the newest one it has verified and checks every call against
 * it, so members keep working while the cloud is out of reach, until the list expires.
 *
 * Ids follow the identities every client already uses: a kind's prefix, an underscore and 32 lowercase hex digits.
 */

const id = (prefix: string) => Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[0-9a-f]{32}$`)))

export const HomeId = id('home')
export const OrganizationId = id('org')
export const PersonId = id('act')
export const TeamId = id('team')
export const ServiceAccountId = id('svc')
export const ProjectId = id('proj')
export const GrantId = id('grant')
export const FunctionId = id('fn')
/** A repository binding of a project, as the home names it. */
export const RepositoryId = id('repo')

/** UTC, with milliseconds, as every timestamp Althar records. */
export const Instant = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/))

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))

export const OrganizationRoleSchema = Schema.Literals(organizationRoles)
export const ProjectAccessSchema = Schema.Literals(projectAccessLevels)

export const Team = Schema.Struct({
  id: TeamId,
  name: Name,
  /** The team it sits in; null for a team directly under the organization, which is the top team. */
  parent: Schema.NullOr(TeamId),
  /** What its own members, and the members of the teams inside it, get on the projects it owns. Null: none. */
  defaultAccess: Schema.NullOr(ProjectAccessSchema),
})
export type Team = typeof Team.Type

export const WorkFunction = Schema.Struct({
  id: FunctionId,
  name: Name,
  /** A team's own function, for its projects; null for one of the organization's. */
  team: Schema.NullOr(TeamId),
})
export type WorkFunction = typeof WorkFunction.Type

export const TeamMembership = Schema.Struct({ team: TeamId, admin: Schema.Boolean })
export type TeamMembership = typeof TeamMembership.Type

/** A passkey whose assertion the home accepts as the person's word for the irreversible list. */
export const Passkey = Schema.Struct({
  credentialId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,1366}$/)),
  /** COSE public key, unpadded base64url. */
  publicKey: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,2048}$/)),
})
export type Passkey = typeof Passkey.Type

export const Person = Schema.Struct({
  id: PersonId,
  name: Name,
  /** Null for a guest: someone with access to particular projects only. */
  role: Schema.NullOr(OrganizationRoleSchema),
  teams: Schema.Array(TeamMembership),
  /** The person's functions in the organization. */
  functions: Schema.Array(FunctionId),
  /** Per project, where the person's functions differ there ("on FX Manager I'm QA"). */
  projectFunctions: Schema.Array(Schema.Struct({ project: ProjectId, functions: Schema.Array(FunctionId) })),
  passkeys: Schema.Array(Passkey),
})
export type Person = typeof Person.Type

export const ServiceAccount = Schema.Struct({ id: ServiceAccountId, name: Name })
export type ServiceAccount = typeof ServiceAccount.Type

export const Project = Schema.Struct({
  id: ProjectId,
  /** The one team it belongs to; null for the organization itself. Its setup follows this team and those above it. */
  team: Schema.NullOr(TeamId),
  /** Only grants reach a private project: not base access, a team's default, or an organization admin's role. */
  private: Schema.Boolean,
})
export type Project = typeof Project.Type

export const Principal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('person'), id: PersonId }),
  Schema.Struct({ kind: Schema.Literal('team'), id: TeamId }),
  Schema.Struct({ kind: Schema.Literal('service_account'), id: ServiceAccountId }),
])
export type Principal = typeof Principal.Type

export const Grant = Schema.Struct({
  id: GrantId,
  principal: Principal,
  project: ProjectId,
  access: ProjectAccessSchema,
  /** Null: every repository. Otherwise the only repositories its work may change ("writing only to fx-design"). */
  writes: Schema.NullOr(Schema.Array(RepositoryId)),
  /** With `writes` set, whether it may still read the project's other repositories. */
  readsOthers: Schema.Boolean,
  /** Null: until revoked. */
  expiresAt: Schema.NullOr(Instant),
})
export type Grant = typeof Grant.Type

export const AccessList = Schema.Struct({
  /** The permission catalog it was compiled for (catalog.ts). */
  catalog: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  home: HomeId,
  organization: OrganizationId,
  /** Rises with every change; a home never goes back to a lower one. */
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  issuedAt: Instant,
  /** A home that can't reach the cloud keeps serving until here, then refuses members until a new list comes. */
  expiresAt: Instant,
  /** What every member, but not a guest, gets on every project that isn't private. Null: none. */
  baseAccess: Schema.NullOr(ProjectAccessSchema),
  /** Whether members may invite people, and make projects in the teams they belong to. */
  membersMayInvite: Schema.Boolean,
  membersMayCreateProjects: Schema.Boolean,
  teams: Schema.Array(Team),
  functions: Schema.Array(WorkFunction),
  people: Schema.Array(Person),
  serviceAccounts: Schema.Array(ServiceAccount),
  projects: Schema.Array(Project),
  grants: Schema.Array(Grant),
})
export type AccessList = typeof AccessList.Type

export const decodeAccessList = Schema.decodeUnknownSync(AccessList)
