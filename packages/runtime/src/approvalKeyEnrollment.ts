import { randomBytes } from 'node:crypto'

import { ApiError, type ClientIdentity } from '@althar/contracts'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server'
import { Schema } from 'effect'

import { approvalClientData, CredentialId, type ApprovalCredentials } from './permissionApprovals'

const lifetime = 5 * 60_000
const bounded = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const Registration = Schema.Struct({
  id: CredentialId,
  rawId: CredentialId,
  type: Schema.Literal('public-key'),
  response: Schema.Struct({ clientDataJSON: bounded(4096), attestationObject: bounded(8192) }),
})
const refused = () => new ApiError({ reason: 'ApprovalEnrollmentRefused', message: 'Althar could not register this security key.' })

interface Pending {
  readonly identity: ClientIdentity
  readonly publicKey: PublicKeyCredentialCreationOptionsJSON
  readonly expiresAt: number
}

/** Returns a proposed public key to the person for the administrator to install. It grants no authority. */
export const approvalKeyEnrollment = (origin: URL, credentials: ApprovalCredentials) => {
  const pending = new Map<string, Pending>()
  const entryFor = (code: string, now: number) => {
    const entry = pending.get(code)
    if (entry === undefined || entry.expiresAt <= now) throw refused()
    return entry
  }
  return {
    async begin(identity: ClientIdentity, name: string, now: number) {
      for (const [code, entry] of pending) if (entry.expiresAt <= now) pending.delete(code)
      if (pending.size >= 32 || identity.role !== 'socket') throw refused()
      const { generateRegistrationOptions } = await import('@simplewebauthn/server')
      const publicKey = await generateRegistrationOptions({
        rpID: origin.hostname,
        rpName: 'Althar',
        userName: identity.deviceId,
        userID: Buffer.from(identity.deviceId, 'utf8'),
        userDisplayName: name,
        timeout: lifetime,
        preferredAuthenticatorType: 'securityKey',
        authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -8, -257],
      })
      for (const [code, entry] of pending) if (entry.identity.deviceId === identity.deviceId) pending.delete(code)
      if (pending.size >= 32) throw refused()
      const code = randomBytes(32).toString('base64url')
      pending.set(code, { identity, publicKey, expiresAt: now + lifetime })
      return code
    },
    view: entryFor,
    async finish(code: string, raw: unknown, now: number) {
      const entry = entryFor(code, now)
      pending.delete(code)
      try {
        const proof = Schema.decodeUnknownSync(Registration)(raw)
        approvalClientData(proof.response.clientDataJSON)
        const { verifyRegistrationResponse } = await import('@simplewebauthn/server')
        const result = await verifyRegistrationResponse({
          response: { ...proof, clientExtensionResults: {} },
          expectedOrigin: origin.origin,
          expectedRPID: origin.hostname,
          expectedChallenge: entry.publicKey.challenge,
          requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -8, -257],
        })
        const info = result.registrationInfo
        if (!result.verified || info === undefined || info.credentialBackedUp || info.credentialDeviceType !== 'singleDevice')
          throw refused()
        const { id, publicKey } = info.credential
        if (credentials.some((key) => key.credentialId === id && key.deviceId !== entry.identity.deviceId)) throw refused()
        const key = { deviceId: entry.identity.deviceId, credentialId: id, publicKey: Buffer.from(publicKey).toString('base64url') }
        return {
          identity: entry.identity,
          manifest: { version: 1, homeId: entry.identity.homeId, origin: origin.origin, credentials: [key] },
        }
      } catch {
        throw refused()
      }
    },
  }
}
