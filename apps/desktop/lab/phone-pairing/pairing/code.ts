import { qrcodegen } from './qrcodegen.js'
import type { Invitation, LabHome } from './world'

/*
 * The pairing code, as `althar-host pair` prints it (contracts' PairingCode,
 * transport-node's encodePairingCode): `althar-pairing1.` and then the code's
 * JSON in base64url, the home's TLS certificate inside it. The lab's
 * certificate is made-up bytes the size of a P-256 one (about 420 bytes in
 * DER), so the QR is as dense as a real one. "Short" leaves the certificate
 * out, as a code could if the phone fetched it from the home and checked it
 * against the pin it already carries.
 */

const API_VERSION = 1
const CERTIFICATE_BYTES = 420

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** Bytes that stay the same for a home, so its QR doesn't change between renders. */
const steady = (seed: string, length: number) => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return Uint8Array.from({ length }, () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return (h >>> 24) & 255
  })
}

export const pairingCode = (home: LabHome, invitation: Invitation, short: boolean) => {
  const body = {
    protocol: 1,
    homeId: home.homeId,
    apiVersion: API_VERSION,
    origin: home.origin,
    tlsKeyPin: home.tlsKeyPin,
    ...(short ? {} : { tlsCertificate: base64url(steady(home.homeId, CERTIFICATE_BYTES)) }),
    token: invitation.token,
    expiresAt: invitation.expiresAt,
  }
  return `althar-pairing1.${base64url(new TextEncoder().encode(JSON.stringify(body)))}`
}

export interface Matrix {
  readonly size: number
  readonly version: number
  readonly dark: (x: number, y: number) => boolean
}

export const qrOf = (text: string): Matrix => {
  const code = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.LOW)
  return { size: code.size, version: code.version, dark: (x, y) => code.getModule(x, y) }
}
