import type { ClientIdentity } from '@althar/contracts'
import { Context } from 'effect'

/** Authenticated ingress supplies this context; RPC payloads never do. Undefined only for in-process runtime work. */
export const CurrentClient = Context.Reference<ClientIdentity | undefined>('@althar/runtime/CurrentClient', {
  defaultValue: () => undefined,
})
