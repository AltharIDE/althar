import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { ApiError, ClientDeviceId, type ClientIdentity, type PermissionApproval } from '@althar/contracts'
import type { WebAuthnCredential } from '@simplewebauthn/server'
import { Schema } from 'effect'

const lifetimeMs = 90_000
const maxPending = 64
const maxPerDevice = 4
const base64url = (max: number) => Schema.String.check(Schema.isMaxLength(max), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
export const CredentialId = base64url(1368)
export const ApprovalCode = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))

export const ApprovalCredentials = Schema.Array(
  Schema.Struct({ deviceId: ClientDeviceId, credentialId: CredentialId, publicKey: base64url(2048) }),
).check(Schema.isMaxLength(100))
export type ApprovalCredentials = typeof ApprovalCredentials.Type

const Assertion = Schema.Struct({
  id: CredentialId,
  rawId: CredentialId,
  type: Schema.Literal('public-key'),
  response: Schema.Struct({
    clientDataJSON: base64url(4096),
    authenticatorData: base64url(1024),
    signature: base64url(1024),
    userHandle: Schema.optionalKey(base64url(128)),
  }),
})

const refused = () =>
  new ApiError({ reason: 'ApprovalRefused', message: 'This approval could not be verified. Open it again from Althar.' })

interface Pending {
  readonly identity: ClientIdentity
  readonly action: PermissionApproval
  readonly title: string
  readonly command: string | null
  readonly remembered: string | null
  readonly challenge: string
  readonly expiresAt: number
  readonly credential: WebAuthnCredential
  state: 'open' | 'checking' | 'refused'
}

const decodeKey = (encoded: string) => {
  const value = Buffer.from(encoded, 'base64url')
  if (value.toString('base64url') !== encoded) throw refused()
  return value
}
const visible = (value: string) => value.replace(/\p{Bidi_Control}/gu, (control) => `\\u{${control.codePointAt(0)?.toString(16)}}`)

export const approvalClientData = (encoded: string) => {
  const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeKey(encoded)))
  if (typeof data !== 'object' || data === null || 'topOrigin' in data || ('crossOrigin' in data && data.crossOrigin !== false))
    throw refused()
}

/** A separate WebAuthn assertion for each decision. A device's transport key only lets it request this ceremony. */
export const makePermissionApprovals = (origin: URL, homeId: string, registrations: ApprovalCredentials) => {
  const rpID = origin.hostname
  if (origin.protocol !== 'https:' || isIP(rpID) !== 0 || rpID.startsWith('[')) throw refused()
  const credentials = new Map<string, WebAuthnCredential>()
  const used = new Set<string>()
  for (const { deviceId, credentialId, publicKey } of Schema.decodeUnknownSync(ApprovalCredentials)(registrations)) {
    if (credentials.has(deviceId) || used.has(credentialId)) throw refused()
    decodeKey(credentialId)
    credentials.set(deviceId, { id: credentialId, publicKey: decodeKey(publicKey), counter: 0 })
    used.add(credentialId)
  }
  const pending = new Map<string, Pending>()
  const available = (code: string, now: number) => {
    const entry = pending.get(code)
    if (entry === undefined || entry.expiresAt <= now) throw refused()
    return entry
  }

  return {
    begin(
      identity: ClientIdentity,
      action: PermissionApproval,
      title: string,
      command: string | null,
      now: number,
      remembered: string | null = null,
    ): string {
      for (const [code, entry] of pending) if (entry.expiresAt <= now) pending.delete(code)
      const credential = credentials.get(identity.deviceId)
      if (
        identity.role !== 'socket' ||
        identity.homeId !== homeId ||
        credential === undefined ||
        pending.size >= maxPending ||
        [...pending.values()].filter((entry) => entry.identity.deviceId === identity.deviceId).length >= maxPerDevice
      )
        throw refused()
      const code = randomBytes(32).toString('base64url')
      pending.set(code, {
        identity: { ...identity },
        action: { ...action },
        title,
        command,
        remembered,
        challenge: randomBytes(32).toString('base64url'),
        expiresAt: now + lifetimeMs,
        credential,
        state: 'open',
      })
      return code
    },
    view(code: string, now: number) {
      const entry = available(code, now)
      if (entry.state !== 'open') throw refused()
      return {
        identity: entry.identity,
        title: visible(entry.title),
        command: entry.command === null ? null : visible(entry.command),
        decision: entry.action.decision,
        reason: entry.action.reason === undefined ? null : visible(entry.action.reason),
        scope: entry.action.always ?? null,
        remembered: entry.remembered === null ? null : visible(entry.remembered),
        publicKey: {
          rpId: rpID,
          challenge: entry.challenge,
          allowCredentials: [{ id: entry.credential.id, type: 'public-key' as const }],
          userVerification: 'required' as const,
          timeout: entry.expiresAt - now,
        },
      }
    },
    async verify(code: string, raw: unknown, now: number) {
      const entry = available(Schema.decodeUnknownSync(ApprovalCode)(code), now)
      if (entry.state !== 'open') throw refused()
      entry.state = 'checking'
      try {
        const proof = Schema.decodeUnknownSync(Assertion)(raw)
        if (proof.id !== entry.credential.id || proof.rawId !== proof.id) throw refused()
        approvalClientData(proof.response.clientDataJSON)
        const { verifyAuthenticationResponse } = await import('@simplewebauthn/server')
        const verified = await verifyAuthenticationResponse({
          response: { ...proof, clientExtensionResults: {} },
          credential: entry.credential,
          expectedChallenge: entry.challenge,
          expectedOrigin: origin.origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        })
        if (
          !verified.verified ||
          verified.authenticationInfo.credentialBackedUp ||
          verified.authenticationInfo.credentialDeviceType !== 'singleDevice'
        ) {
          throw refused()
        }
        if (entry.credential.counter > 0 && verified.authenticationInfo.newCounter <= entry.credential.counter) throw refused()
        entry.credential.counter = verified.authenticationInfo.newCounter
        return { identity: entry.identity, action: entry.action, expiresAt: entry.expiresAt }
      } catch {
        entry.state = 'refused'
        throw refused()
      }
    },
    request(code: string, now: number) {
      const { identity, action, state } = available(code, now)
      return { identity, action, state }
    },
  }
}
