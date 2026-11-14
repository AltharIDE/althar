import { Schema } from 'effect'

const identity = (prefix: string) => Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[0-9a-f]{32}$`)))

/** A durable runtime home, independent of its current process, machine or URL. */
export const HomeId = identity('home')
export const ClientDeviceId = identity('dev')
export const PersonId = identity('act')
export const OrganizationId = identity('org')
export const ProjectIdentity = identity('proj')

/** Ownership is independent of hosting, a signed-in device, and the account paying for compute. */
export const ProjectOwner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('person'), id: PersonId }),
  Schema.Struct({ kind: Schema.Literal('organization'), id: OrganizationId }),
])
export type ProjectOwner = typeof ProjectOwner.Type

export const ClientRole = Schema.Literals(['window', 'paired_device', 'socket', 'internal'])
export type ClientRole = typeof ClientRole.Type

/** Established by authenticated ingress. None of these fields are accepted from an ordinary RPC payload. */
export const ClientIdentity = Schema.Struct({
  homeId: HomeId,
  actorId: PersonId,
  deviceId: ClientDeviceId,
  role: ClientRole,
})
export type ClientIdentity = typeof ClientIdentity.Type

/** Ed25519 raw public key and signature, encoded as unpadded base64url. Private keys never reach a home. */
export const ClientPublicKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))
export const ClientSignature = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/))
export const ClientName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))

export const RegisteredClient = Schema.Struct({
  deviceId: ClientDeviceId,
  name: ClientName,
  publicKey: ClientPublicKey,
  role: Schema.Literals(['paired_device', 'socket']),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
})
export type RegisteredClient = typeof RegisteredClient.Type

export const ClientListOptions = Schema.Struct({
  after: Schema.optional(ClientDeviceId),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
})
export type ClientListOptions = typeof ClientListOptions.Type
export const ClientPage = Schema.Struct({ clients: Schema.Array(RegisteredClient), next: Schema.NullOr(ClientDeviceId) })
export type ClientPage = typeof ClientPage.Type

/** A reconnect position belongs to one home. A cursor from another database must never silently skip changes. */
export const FeedPosition = Schema.Struct({
  homeId: HomeId,
  cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  /** Identifies the exact history entry at this cursor, detecting restored or divergent history. Null only at cursor zero. */
  checkpoint: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/))),
})
export type FeedPosition = typeof FeedPosition.Type

export const ClientChallenge = Schema.Struct({
  protocol: Schema.Literal(1),
  homeId: HomeId,
  deviceId: ClientDeviceId,
  apiVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  nonce: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type ClientChallenge = typeof ClientChallenge.Type

/** Domain-separated, unambiguous signing input. The home, device, version, nonce and expiry are all authenticated. */
export const clientChallengeMessage = (challenge: ClientChallenge): string =>
  JSON.stringify([
    'althar.client.authentication',
    challenge.protocol,
    challenge.homeId,
    challenge.deviceId,
    challenge.apiVersion,
    challenge.nonce,
    challenge.expiresAt,
  ])

export const ConnectionInfo = Schema.Struct({
  identity: ClientIdentity,
  hostDeviceId: ClientDeviceId,
  apiVersion: Schema.Int,
  appVersion: Schema.String,
  position: FeedPosition,
})
export type ConnectionInfo = typeof ConnectionInfo.Type
