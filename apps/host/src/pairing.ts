import { createHash, randomBytes } from 'node:crypto'

import { API_VERSION, ApiError } from '@althar/contracts'
import { apiClient, encodePairingCode, openLocalConnection, TransportError } from '@althar/transport-node'
import { Effect } from 'effect'

import { HostError } from './errors'
import { networkFiles, readNetworkConfiguration } from './network'
import type { HostOptions } from './options'

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`
const safeError = (error: unknown) =>
  new HostError({
    code: 'InvalidConfig',
    message:
      error instanceof ApiError || error instanceof TransportError || error instanceof HostError
        ? error.message
        : 'The host could not manage this connection device. Check its status and try again.',
  })

export const issuePairing = (options: HostOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const network = yield* readNetworkConfiguration(options.profile)
      if (network === undefined)
        return yield* new HostError({
          code: 'InvalidConfig',
          message: 'Configure direct HTTPS/WSS access and restart the host before creating a pairing code.',
        })
      const files = yield* networkFiles(options, network)
      files.key.fill(0)
      const { api } = yield* apiClient(yield* openLocalConnection(options.profile))
      const token = randomBytes(32).toString('base64url')
      const invitation = yield* api.IssueDevicePairing({
        commandId: commandId(),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      })
      return {
        homeId: invitation.homeId,
        expiresAt: invitation.expiresAt,
        code: encodePairingCode({
          ...invitation,
          protocol: 1,
          apiVersion: API_VERSION,
          origin: files.config.origin,
          tlsKeyPin: files.tlsKeyPin,
          tlsCertificate: files.tlsCertificate,
          token,
        }),
      }
    }),
  ).pipe(Effect.mapError(safeError))

export const listConnectionDevices = (options: HostOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { api } = yield* apiClient(yield* openLocalConnection(options.profile))
      return yield* api.ListClientDevices({ limit: 100, ...(options.deviceAfter === undefined ? {} : { after: options.deviceAfter }) })
    }),
  ).pipe(Effect.mapError(safeError))

export const revokeConnectionDevice = (options: HostOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { api } = yield* apiClient(yield* openLocalConnection(options.profile))
      yield* api.RevokeConnectionDevice({ commandId: commandId(), deviceId: options.revokeDeviceId ?? '' })
    }),
  ).pipe(Effect.mapError(safeError))
