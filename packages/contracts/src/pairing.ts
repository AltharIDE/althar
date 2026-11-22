import { Schema } from 'effect'

import { ClientDeviceId, ClientName, ClientPublicKey, ClientSignature, HomeId, RegisteredClient } from './identities'

export const PairingToken = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))
export const PairingTokenHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
export const PAIRING_CODE_MAX_LENGTH = 12 * 1024
export const TLS_CERTIFICATE_MAX_BYTES = 4096
const tlsTrust = {
  tlsKeyPin: PairingTokenHash,
  tlsCertificate: Schema.String.check(
    Schema.isMaxLength(Math.ceil((TLS_CERTIFICATE_MAX_BYTES * 4) / 3)),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
}
export const HomeTlsTrust = Schema.Struct(tlsTrust)
export type HomeTlsTrust = typeof HomeTlsTrust.Type
const Origin = Schema.String.check(Schema.isMaxLength(2048))
export const HttpsHomeTarget = Schema.Struct({
  origin: Origin,
  homeId: HomeId,
  deviceId: ClientDeviceId,
  tlsKeyPin: tlsTrust.tlsKeyPin,
  // Retain saved preview targets so people can still select, forget or re-pair them.
  tlsCertificate: Schema.optional(tlsTrust.tlsCertificate),
})
export type HttpsHomeTarget = typeof HttpsHomeTarget.Type
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
  origin: Origin,
  ...tlsTrust,
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

const CODE_PREFIX = 'althar-pairing'
/** Where a pairing link points: a page that opens Althar on the phone, or sends a phone without it to its store. */
export const PAIRING_PAGE = 'https://althar.ai/pair'
/** The phone app's own address for the same, which the page's Open in Althar uses once Althar is installed. */
export const PAIRING_APP_LINK = 'althar://pair'

/**
 * A pairing code as a link a phone's own camera opens: the code after the #,
 * so the page's server never sees it (`https://althar.ai/pair#1.<base64url>`).
 */
export const pairingLinkOf = (code: string, base: string = PAIRING_PAGE): string =>
  code.startsWith(CODE_PREFIX) ? `${base}#${code.slice(CODE_PREFIX.length)}` : code

/** The pairing code in what was pasted or scanned: the code itself, or a pairing link (the page's or the app's). */
export const pairingCodeIn = (given: string): string => {
  const text = given.trim()
  for (const base of [PAIRING_PAGE, PAIRING_APP_LINK]) {
    if (!text.startsWith(`${base}#`) && !text.startsWith(`${base}/#`)) continue
    const fragment = text.slice(text.indexOf('#') + 1)
    return /^\d+\./.test(fragment) ? `${CODE_PREFIX}${fragment}` : text
  }
  return text
}

/** A pairing code made by the home for a window to show: the code to paste, the link its QR carries, and what to ask after. */
export const PairingCodeMade = Schema.Struct({
  code: Schema.String,
  link: Schema.String,
  tokenHash: PairingTokenHash,
  expiresAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type PairingCodeMade = typeof PairingCodeMade.Type

/** How a code made by the home stands: waiting for a phone, run out (or unknown), or used by the device it paired. */
export const PairingStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal('waiting'), expiresAt: Schema.Int }),
  Schema.Struct({ state: Schema.Literal('expired') }),
  Schema.Struct({ state: Schema.Literal('paired'), device: RegisteredClient }),
])
export type PairingStatus = typeof PairingStatus.Type

/**
 * Whether phones can reach the home: where it answers them, or null. A
 * desktop's own home can switch its listener from the window (switchable);
 * a host's is configured on the host.
 */
export const PhoneAccess = Schema.Struct({
  origin: Schema.NullOr(Schema.String),
  switchable: Schema.Boolean,
  on: Schema.Boolean,
})
export type PhoneAccess = typeof PhoneAccess.Type
