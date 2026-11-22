import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto'
import { Agent, request } from 'node:https'
import { getCACertificates } from 'node:tls'

import { Clock, Effect, Schema } from 'effect'
import { HomeTlsTrust, TLS_CERTIFICATE_MAX_BYTES } from '@althar/contracts'

import { transportError } from './errors'

export const httpsOrigin = (given: string): string => {
  try {
    if (
      given.length > 2048 ||
      /\s/u.test(given) ||
      Array.from(given).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new Error('Invalid origin')
    const url = new URL(given)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    )
      throw new Error('Invalid origin')
    return url.origin
  } catch {
    throw transportError('InvalidConnection', 'Use an HTTPS home address without a path, credentials or query.')
  }
}

const keyPinOf = (certificate: X509Certificate) =>
  createHash('sha256')
    .update(certificate.publicKey.export({ format: 'der', type: 'spki' }))
    .digest()

export const tlsPublicKeyPin = (certificate: string | Buffer): string => keyPinOf(new X509Certificate(certificate)).toString('hex')

export const pairedCertificate = (given: HomeTlsTrust): X509Certificate => {
  const trust = Schema.decodeUnknownSync(HomeTlsTrust)(given)
  const bytes = Buffer.from(trust.tlsCertificate, 'base64url')
  if (bytes.length > TLS_CERTIFICATE_MAX_BYTES || bytes.toString('base64url') !== trust.tlsCertificate)
    throw new Error('Invalid home certificate')
  const certificate = new X509Certificate(bytes)
  if (!certificate.raw.equals(bytes) || !timingSafeEqual(keyPinOf(certificate), Buffer.from(trust.tlsKeyPin, 'hex')))
    throw new Error('The home certificate does not match its key pin')
  return certificate
}

/** The operator supplies the trust anchor and key pin in the pairing code. */
export const homeHttpsAgent = (origin: string, trust?: HomeTlsTrust) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      yield* Effect.try({ try: () => httpsOrigin(origin), catch: () => transportError('InvalidConnection', 'Use an HTTPS home address.') })
      const options = { keepAlive: false, maxSockets: 4, maxTotalSockets: 4, minVersion: 'TLSv1.2', rejectUnauthorized: true } as const
      if (trust === undefined) return new Agent(options)
      const clock = yield* Clock.Clock
      const certificate = yield* Effect.try({
        try: () => pairedCertificate(trust),
        catch: () => transportError('InvalidConnection', 'This home certificate or pin is invalid. Pair the home again.'),
      })
      const pin = Buffer.from(trust.tlsKeyPin, 'hex')
      return new Agent({
        ...options,
        ca: [...getCACertificates('default'), certificate.toString()],
        allowPartialTrustChain: true,
        maxCachedSessions: 0,
        // The pairing code authenticates the key independently of the certificate's DNS name.
        // Node verifies the chain before calling this check, and sends no HTTP bytes on failure.
        checkServerIdentity: (_name, peer) => {
          try {
            const leaf = new X509Certificate(peer.raw)
            const now = clock.currentTimeMillisUnsafe()
            if (Date.parse(leaf.validFrom) <= now && Date.parse(leaf.validTo) > now && timingSafeEqual(keyPinOf(leaf), pin))
              return undefined
          } catch {
            // An unreadable peer certificate cannot authenticate the home.
          }
          return new Error('The home certificate does not match this pairing.')
        },
      })
    }),
    (agent) => Effect.sync(() => agent.destroy()),
  )

/** Small bootstrap messages only. RPC uses the separately bounded persistent stream. Redirects are never followed. */
export const httpsJson = (origin: string, path: string, agent: Agent, body?: unknown, authorization?: string) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<unknown>((resolve, reject) => {
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
        if (bytes !== undefined && bytes.length > 16 * 1024) return reject(new Error('Oversized request'))
        const req = request(
          new URL(path, httpsOrigin(origin)),
          {
            agent,
            signal,
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              accept: 'application/json',
              ...(bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': bytes.length }),
              ...(authorization === undefined ? {} : { authorization }),
            },
          },
          (response) => {
            const chunks: Buffer[] = []
            let total = 0
            response.on('data', (chunk: Buffer) => {
              total += chunk.length
              if (total > 16 * 1024) {
                response.destroy()
                req.destroy()
                reject(new Error('Oversized response'))
                return
              }
              chunks.push(chunk)
            })
            response.once('error', reject)
            response.once('aborted', () => reject(new Error('Interrupted response')))
            response.once('end', () => {
              try {
                if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0] !== 'application/json')
                  throw new Error('Rejected request')
                resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))))
              } catch {
                reject(new Error('Invalid home response'))
              }
            })
          },
        )
        req.once('error', reject)
        req.end(bytes)
      }),
    catch: () =>
      transportError('HostUnavailable', 'The home did not accept this secure request. Check its address, certificate and pairing code.'),
  }).pipe(
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () => Effect.fail(transportError('HostUnavailable', 'The home did not answer in time.')),
    }),
  )
