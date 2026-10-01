import { Schema } from 'effect'

/**
 * Why a call to a code host or tracker didn't do what was asked, classified
 * so the runtime can act on it: sign in again, wait, or tell the person.
 *
 * - `unauthorized`: the token is missing, expired or revoked; sign in again.
 * - `forbidden`: signed in, but this account may not do it.
 * - `not_found`: it isn't there, or this account can't see it.
 * - `rate_limited`: too many calls; `retryAt` says when to try again.
 * - `unreachable`: the network, or the service, didn't answer.
 * - `rejected`: the service refused the request as it stands, such as a
 *   pull request whose branch has nothing to merge.
 * - `invalid_response`: an answer Charrette couldn't read.
 */
export class ConnectorFailed extends Schema.TaggedError<ConnectorFailed>()('ConnectorFailed', {
  product: Schema.String,
  reason: Schema.Literals(['unauthorized', 'forbidden', 'not_found', 'rate_limited', 'unreachable', 'rejected', 'invalid_response']),
  message: Schema.String,
  /** The HTTP status, when there was one. */
  status: Schema.optional(Schema.Number),
  /** When a rate-limited call may be tried again. */
  retryAt: Schema.optional(Schema.String),
}) {}

/** A sign-in that ended without a token: the person said no, or the code expired before they said anything. */
export class SignInEnded extends Schema.TaggedError<SignInEnded>()('SignInEnded', {
  product: Schema.String,
  reason: Schema.Literals(['denied', 'expired']),
}) {}
