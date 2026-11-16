import { Schema } from 'effect'

import { ClientDeviceId, ClientName, ClientPublicKey, ClientSignature, HomeId, RegisteredClient } from './identities'

export const PairingToken = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))
export const PairingTokenHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
export const PairingInvitation = Schema.Struct({
  homeId: HomeId,
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type PairingInvitation = typeof PairingInvitation.Type

/** The code comes from the operator, never from unauthenticated network discovery. */
export const PairingCode = Schema.Struct({
  protocol: Schema.Literal(1),
  homeId: HomeId,
  apiVersion: Schema.Int,
  origin: Schema.String.check(Schema.isMaxLength(2048)),
  tlsKeyPin: PairingTokenHash,
  token: PairingToken,
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type PairingCode = typeof PairingCode.Type

export const PairingRegistration = Schema.Struct({
  homeId: HomeId,
  token: PairingToken,
  name: ClientName,
  publicKey: ClientPublicKey,
  signature: ClientSignature,
})
export type PairingRegistration = typeof PairingRegistration.Type

/** Proof of possession binds the intended home, one-use invitation, device name and key. */
export const pairingRegistrationMessage = (input: Omit<PairingRegistration, 'signature'>): string =>
  JSON.stringify(['althar.device.pairing', 1, input.homeId, input.token, input.name, input.publicKey])

export const NetworkHomeInfo = Schema.Struct({
  homeId: HomeId,
  hostDeviceId: ClientDeviceId,
  apiVersion: Schema.Int,
  version: Schema.String.check(Schema.isMaxLength(128)),
})
export const PairingResult = Schema.Struct({ homeId: HomeId, apiVersion: Schema.Int, device: RegisteredClient })
