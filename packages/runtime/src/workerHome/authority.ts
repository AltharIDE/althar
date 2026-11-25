import { createHash, X509Certificate } from 'node:crypto'
import { networkInterfaces, hostname } from 'node:os'
import { join } from 'node:path'

import { issueCertificate, newKey } from '@althar/transport-node'
import { Schema } from 'effect'

import { privateDirectory, readPrivate, writePrivate } from '../privateFiles'
import { WorkerHomeError } from './errors'

/*
 * The home is its own certificate authority for its workers (ADR-103, foundations § Remote connections and native
 * workers). Made the first time the home is asked to take a worker, and kept in the profile's private `workers` folder:
 * the authority's key and certificate, and the certificate the home's worker port serves, signed by it. Nobody makes or
 * copies a certificate. A worker makes its own key, and the home signs it once the person adds it, as a client
 * certificate naming its worker ID. The authority only gets a worker through the TLS handshake: the home still takes only
 * a certificate its ledger enrolled, by its fingerprint. A worker trusts this authority alone, from what it was given at
 * enrollment, and checks that the home's certificate carries `SERVER_NAME`, whatever address it reached the home at, so
 * the home can move between addresses without new certificates.
 */

/** The name the home's worker certificate carries, and a worker checks with the home's own authority. */
export const SERVER_NAME = 'home.althar.invalid'

const Pair = Schema.Struct({ certificate: Schema.String, key: Schema.String })
const Stored = Schema.Struct({ version: Schema.Literal(1), authority: Pair, home: Pair })

export interface WorkerAuthority {
  /** The authority's certificate, PEM: what a worker trusts. */
  readonly certificate: string
  /** The home's worker port certificate and key, PEM. */
  readonly home: { readonly certificate: string; readonly key: string }
  /** SHA-256 of the authority's certificate, hex: how a one-time code names it. */
  readonly fingerprint: string
  /** Signs a worker's own public key (SPKI DER) as its client certificate. */
  readonly issue: (publicKey: Uint8Array, workerId: string, now: number) => string
}

const fileOf = (profile: string) => join(profile, 'workers', 'authority.json')

const of = (stored: typeof Stored.Type): WorkerAuthority => ({
  certificate: stored.authority.certificate,
  home: stored.home,
  fingerprint: createHash('sha256').update(new X509Certificate(stored.authority.certificate).raw).digest('hex'),
  issue: (publicKey, workerId, now) => {
    const key = Buffer.from(publicKey)
    try {
      // Only a P-256 key, as a worker makes it: the home signs nothing else.
      const certificate = new X509Certificate(
        issueCertificate({ name: workerId, publicKey: key, use: { kind: 'client' }, issuer: stored.authority, now }),
      )
      if (certificate.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('not P-256')
      return certificate.toString()
    } catch {
      throw new WorkerHomeError('InvalidConfig', 'The worker’s key isn’t one the home can sign: it needs a P-256 public key.')
    }
  },
})

/** The home's authority for its workers: the one it keeps, or a new one, made and kept now. */
export const workerAuthority = async (profile: string, now: number): Promise<WorkerAuthority> => {
  await privateDirectory(join(profile, 'workers'), true)
  const kept = await readPrivate(fileOf(profile), 16384)
  if (kept !== null) {
    try {
      return of(Schema.decodeUnknownSync(Stored)(JSON.parse(kept.toString('utf8'))))
    } catch {
      throw new WorkerHomeError(
        'InvalidConfig',
        'The home’s worker certificates can’t be read. Move workers/authority.json aside to make new ones.',
      )
    }
  }
  const authority = newKey()
  const certificate = issueCertificate({
    name: 'Althar home workers',
    publicKey: authority.publicKey,
    use: { kind: 'authority' },
    selfKey: authority.key,
    now,
  })
  const serving = newKey()
  const home = {
    certificate: issueCertificate({
      name: 'Althar home',
      publicKey: serving.publicKey,
      use: { kind: 'server', hosts: [SERVER_NAME] },
      issuer: { certificate, key: authority.key },
      now,
    }),
    key: serving.key,
  }
  const stored = { version: 1 as const, authority: { certificate, key: authority.key }, home }
  // Two first asks at once keep whichever was written first.
  if (!(await writePrivate(fileOf(profile), JSON.stringify(stored), false))) return workerAuthority(profile, now)
  return of(stored)
}

/**
 * Where a worker may reach this home, best first: this computer's addresses on its networks (a private network such as
 * Tailscale's included), then its own names. A worker tries each in turn and keeps the first that answers.
 */
export const homeAddresses = (port: number, first: ReadonlyArray<string> = []): ReadonlyArray<string> => {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces()))
    for (const one of list ?? []) {
      if (one.internal || (one.family === 'IPv6' && one.scopeid !== 0)) continue
      found.push(one.family === 'IPv6' ? `[${one.address}]` : one.address)
    }
  const name = hostname()
  const names = name === '' ? [] : name.includes('.') ? [name] : [`${name}.local`, name]
  // IPv4 first: a worker on the same network reaches it more often than an IPv6 address.
  const ordered = [...first, ...found.filter((one) => !one.startsWith('[')), ...names, ...found.filter((one) => one.startsWith('['))]
  return [...new Set(ordered)].slice(0, 12).map((host) => `${host}:${port}`)
}
