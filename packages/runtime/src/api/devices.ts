import { API_VERSION, SOCKET_CALLS, type ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { DevicePairings } from '../DevicePairings'
import { RuntimeConfig } from '../Config'
import { Instance } from '../Instance'
import { ClientIdentities } from '../ClientIdentities'
import type { ApiKit } from './kit'

/**
 * Which clients may reach the home: pairing a device, the phone, and the devices and sockets registered.
 * Includes the connection info a client reads about itself.
 */
export const devicesHandlers = ({ identity, api, connectionAdmin }: ApiKit) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    const identities = yield* ClientIdentities
    const pairings = yield* DevicePairings
    const sql = yield* SqlClient.SqlClient
    const config = yield* RuntimeConfig
    return {
      GetConnectionInfo: () =>
        api(
          Effect.map(
            sql<{ cursor: number; checkpoint: string }>`SELECT cursor, checkpoint FROM change_log ORDER BY cursor DESC LIMIT 1`,
            ([last]) => ({
              identity,
              hostDeviceId: instance.deviceId,
              apiVersion: API_VERSION,
              appVersion: config.appVersion,
              position: { homeId: instance.homeId, cursor: last?.cursor ?? 0, checkpoint: last?.checkpoint ?? null },
              ...(identity.role === 'socket' ? { calls: [...SOCKET_CALLS] } : {}),
            }),
          ),
        ),
      IssueDevicePairing: ({ tokenHash }) => connectionAdmin(pairings.issue(tokenHash)),
      CreatePairingCode: () => connectionAdmin(pairings.create()),
      GetPairingStatus: ({ tokenHash }) => connectionAdmin(pairings.status(tokenHash)),
      GetPhoneAccess: () => connectionAdmin(pairings.access()),
      SetPhoneAccess: ({ on }) => connectionAdmin(pairings.setAccess(on)),
      RevokeConnectionDevice: ({ deviceId }) => connectionAdmin(pairings.revokeConnection(deviceId)),
      ListClientDevices: (options) => connectionAdmin(identities.list(options)),
      RegisterClientDevice: ({ name, publicKey, role }) => identities.register({ name, publicKey, role }),
      RevokeClientDevice: ({ deviceId }) => identities.revoke(deviceId),
    } satisfies Partial<ApiHandlers>
  })
