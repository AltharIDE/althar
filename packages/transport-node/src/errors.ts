import { Schema } from 'effect'

export const TransportReason = Schema.Literals([
  'InvalidConnection',
  'UnsafeEndpoint',
  'HostUnavailable',
  'HomeMismatch',
  'ApiVersionMismatch',
  'AuthenticationFailed',
  'ApprovalUnavailable',
  'ConnectionClosed',
  'SshUnavailable',
  'SshHostKeyRejected',
  'SshAuthenticationFailed',
])
export class TransportError extends Schema.TaggedError<TransportError>()('TransportError', {
  reason: TransportReason,
  message: Schema.String,
}) {}
export const transportError = (reason: typeof TransportReason.Type, message: string) => new TransportError({ reason, message })
