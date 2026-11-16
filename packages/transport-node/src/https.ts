import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto'
import { Agent, request } from 'node:https'
import { isIP } from 'node:net'
import { connect } from 'node:tls'

import { Clock, Effect, Schema } from 'effect'
import { PairingTokenHash } from '@althar/contracts'

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

export const tlsPublicKeyPin = (certificate: string | Buffer): string =>
  createHash('sha256')
    .update(new X509Certificate(certificate).publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')

/** A pin is supplied by the operator's pairing code, never learned from a network response. */
export const homeHttpsAgent = (origin: string, pin?: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const url = new URL(httpsOrigin(origin))
      const clock = yield* Clock.Clock
      if (pin !== undefined)
        yield* Schema.decodeUnknownEffect(PairingTokenHash)(pin).pipe(
          Effect.mapError(() => transportError('InvalidConnection', 'This home certificate pin is invalid. Pair the home again.')),
        )
      const agent = new Agent({ keepAlive: false, maxSockets: 4, maxTotalSockets: 4, minVersion: 'TLSv1.2' })
      if (pin !== undefined) {
        const pending = new Set<ReturnType<typeof connect>>()
        const destroy = agent.destroy.bind(agent)
        agent.destroy = () => {
          for (const socket of pending) socket.destroy()
          destroy()
        }
        // A private/self-signed certificate is accepted only for the exact SPKI key
        // in the out-of-band code. No HTTP header is sent before that check passes.
        agent.createConnection = (_options, callback) => {
          const host = url.hostname.replace(/^\[|\]$/g, '')
          const socket = connect({
            host,
            port: Number(url.port || 443),
            ...(isIP(host) ? {} : { servername: host }),
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2',
          })
          pending.add(socket)
          socket.once('close', () => pending.delete(socket))
          let settled = false
          const finish = (error: Error | null) => {
            if (settled) return
            settled = true
            socket.off('error', fail)
            if (error !== null) socket.destroy()
            callback?.(error, socket)
          }
          const fail = () => finish(new Error('The home TLS connection failed.'))
          socket.once('error', fail)
          socket.setTimeout(10_000, fail)
          socket.once('secureConnect', () => {
            try {
              const certificate = new X509Certificate(socket.getPeerCertificate().raw)
              const at = clock.currentTimeMillisUnsafe()
              if (
                Date.parse(certificate.validFrom) > at ||
                Date.parse(certificate.validTo) <= at ||
                !timingSafeEqual(Buffer.from(tlsPublicKeyPin(certificate.raw), 'hex'), Buffer.from(pin, 'hex'))
              )
                return fail()
              socket.setTimeout(0)
              finish(null)
            } catch {
              fail()
            }
          })
          return undefined
        }
      }
      return agent
    }),
    (agent) => Effect.sync(() => agent.destroy()),
  )

/** Small bootstrap messages only. RPC uses the separately bounded persistent stream. Redirects are never followed. */
export const httpsJson = (origin: string, path: string, agent: Agent, body?: unknown) =>
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
