import { webcrypto } from 'node:crypto'

import {
  API_VERSION,
  PAIRING_CODE_MAX_LENGTH,
  PairingCode,
  PairingResult,
  pairingCodeIn,
  pairingRegistrationMessage,
} from '@althar/contracts'
import { Clock, Effect, Schema } from 'effect'

import { homeHttpsAgent, httpsJson, httpsOrigin, pairedCertificate } from './https'
import { transportError } from './errors'

const invalid = () => transportError('InvalidConnection', 'Use a new pairing code from the host. This code is invalid or expired.')
export interface DeviceKey {
  readonly publicKey: string
  readonly privateKey: string
}

/** Software credentials authenticate a connection; they never claim protected approval authority. */
export const createDeviceKey = Effect.tryPromise({
  try: async (): Promise<DeviceKey> => {
    const key = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    if (!('publicKey' in key) || !('privateKey' in key)) throw new Error('Expected an Ed25519 key pair')
    return {
      publicKey: Buffer.from(await webcrypto.subtle.exportKey('raw', key.publicKey)).toString('base64url'),
      privateKey: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key.privateKey)).toString('base64url'),
    }
  },
  catch: invalid,
})

export const signDeviceMessage = (privateKey: string, message: string) =>
  Effect.tryPromise({
    try: async () => {
      if (!/^[A-Za-z0-9_-]{64}$/.test(privateKey)) throw new Error('Invalid device key')
      const bytes = Buffer.from(privateKey, 'base64url')
      try {
        const key = await webcrypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign'])
        return Buffer.from(await webcrypto.subtle.sign('Ed25519', key, Buffer.from(message))).toString('base64url')
      } finally {
        bytes.fill(0)
      }
    },
    catch: () => transportError('AuthenticationFailed', 'This device key could not sign. Pair the device again.'),
  })

export const encodePairingCode = (code: PairingCode): string => `althar-pairing1.${Buffer.from(JSON.stringify(code)).toString('base64url')}`

/** A pairing code, or a pairing link with the code after its # (as the Mac's QR carries it). */
export const decodePairingCode = (pasted: string): PairingCode => {
  try {
    const given = pairingCodeIn(pasted)
    if (given.length > PAIRING_CODE_MAX_LENGTH || !/^althar-pairing1\.[A-Za-z0-9_-]+$/.test(given)) throw invalid()
    const encoded = given.slice('althar-pairing1.'.length)
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw invalid()
    const code = Schema.decodeUnknownSync(PairingCode)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    if (code.apiVersion !== API_VERSION) throw invalid()
    pairedCertificate(code)
    return { ...code, origin: httpsOrigin(code.origin) }
  } catch {
    throw invalid()
  }
}

/** The caller saves its encrypted pending key before exchange, so a lost reply can retry with the same key. */
export const completeDevicePairing = (code: PairingCode, key: DeviceKey, name: string) =>
  Effect.gen(function* () {
    if (code.expiresAt <= (yield* Clock.currentTimeMillis)) return yield* invalid()
    const agent = yield* homeHttpsAgent(code.origin, code)
    const input = { homeId: code.homeId, token: code.token, name, publicKey: key.publicKey }
    const signature = yield* signDeviceMessage(key.privateKey, pairingRegistrationMessage(input))
    const result = yield* Schema.decodeUnknownEffect(PairingResult)(
      yield* httpsJson(code.origin, '/v1/pairing/complete', agent, { ...input, signature }),
    ).pipe(Effect.mapError(invalid))
    if (
      result.homeId !== code.homeId ||
      result.apiVersion !== API_VERSION ||
      result.device.role !== 'socket' ||
      result.device.publicKey !== key.publicKey ||
      result.device.revokedAt !== null
    )
      return yield* invalid()
    return {
      origin: code.origin,
      tlsKeyPin: code.tlsKeyPin,
      tlsCertificate: code.tlsCertificate,
      homeId: code.homeId,
      deviceId: result.device.deviceId,
    }
  })
