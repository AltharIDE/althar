import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'

import { workerKeyFingerprint } from '@althar/worker-protocol/grpc'

import { homeAddresses, type WorkerAuthority } from './authority'
import { WorkerHomeError } from './errors'

/*
 * A worker the home signed: what it needs to reach the home and prove who it is, and nothing it would have to copy by
 * hand. The SSH setup hands it over (the window asks the home to sign the worker's key, and writes this on the worker);
 * a machine without SSH asks for it itself, with a one-time code.
 *
 * A code is `althar-worker1.` and base64url JSON: the home's id, where it may be reached, the port it enrolls on, the
 * certificate of its own authority (so the worker trusts the home it reached before it sends anything), a random token
 * and when it expires. The home keeps only the token's SHA-256, in memory: a code ends after ten minutes or when the home
 * restarts, and takes one worker. The worker that used it may ask again with the same key, for a reply it lost; another
 * key can't. The port it enrolls on is open only while a code waits.
 */

export interface WorkerGrant {
  readonly homeId: string
  readonly workerId: string
  /** The home's authority's certificate, PEM: the only one the worker trusts. */
  readonly authority: string
  /** The worker's own certificate, PEM, signed for its own key. */
  readonly certificate: string
  /** The name the home's certificate carries, whatever address it is reached at. */
  readonly serverName: string
  /** The home's worker port. */
  readonly port: number
  /** Where the worker may reach the home, `host:port`, best first. */
  readonly addresses: ReadonlyArray<string>
}

export const keyFingerprint = (publicKey: Uint8Array) => workerKeyFingerprint(publicKey)

const PREFIX = 'althar-worker1.'
const LIFETIME = 10 * 60_000
const AFTER = 10 * 60_000
const MAX_CODES = 16
const MAX_BODY = 4096
const PER_MINUTE = 30

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export interface WorkerCode {
  readonly homeId: string
  readonly addresses: ReadonlyArray<string>
  readonly port: number
  readonly authority: string
  readonly token: string
  readonly expiresAt: number
}

/** A code, as a worker reads it; undefined where it isn't one. */
export const workerCodeOf = (code: string): WorkerCode | undefined => {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) return undefined
  try {
    const value: unknown = JSON.parse(Buffer.from(trimmed.slice(PREFIX.length), 'base64url').toString('utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const { homeId, addresses, port, authority, token, expiresAt } = value as Record<string, unknown>
    if (
      typeof homeId !== 'string' ||
      !Array.isArray(addresses) ||
      !addresses.every((one) => typeof one === 'string') ||
      typeof port !== 'number' ||
      typeof authority !== 'string' ||
      typeof token !== 'string' ||
      typeof expiresAt !== 'number'
    )
      return undefined
    return { homeId, addresses: addresses as string[], port, authority, token, expiresAt }
  } catch {
    return undefined
  }
}

interface Pending {
  readonly name: string
  readonly expiresAt: number
  /** The key that used it, and what it was given. */
  claimed?: { readonly key: string; readonly grant: WorkerGrant }
}

/** The home's one-time codes, and the port they enroll on while any waits. */
export const workerCodes = (options: {
  readonly homeId: string
  readonly authority: WorkerAuthority
  readonly port: number
  readonly now: () => number
  readonly enroll: (publicKey: Uint8Array, name: string) => WorkerGrant
}) => {
  const pending = new Map<string, Pending>()
  const asked = new Map<string, { at: number; count: number }>()
  let server: Server | undefined
  let opening: Promise<number> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const sweep = () => {
    const at = options.now()
    for (const [hash, code] of pending) if (code.expiresAt + (code.claimed === undefined ? 0 : AFTER) <= at) pending.delete(hash)
    if (pending.size === 0) close()
  }
  const close = () => {
    clearTimeout(timer)
    timer = undefined
    server?.close()
    server = undefined
    opening = undefined
  }
  const refused = (status: number, message: string) => ({ status, body: { message } })
  const answer = (from: string, raw: string): { status: number; body: unknown } => {
    const at = options.now()
    const seen = asked.get(from)
    const window = seen === undefined || at - seen.at > 60_000 ? { at, count: 0 } : seen
    window.count += 1
    asked.set(from, window)
    if (window.count > PER_MINUTE) return refused(429, 'Too many tries. Wait a minute.')
    let request: { token?: unknown; publicKey?: unknown; name?: unknown }
    try {
      request = JSON.parse(raw) as typeof request
    } catch {
      return refused(400, 'That isn’t an enrollment request.')
    }
    if (typeof request.token !== 'string' || typeof request.publicKey !== 'string') return refused(400, 'That isn’t an enrollment request.')
    sweep()
    const code = pending.get(tokenHash(request.token))
    if (code === undefined || code.expiresAt <= at)
      return refused(403, 'This code expired or was used. Make a new one in Settings › Computers.')
    const publicKey = Buffer.from(request.publicKey, 'base64url')
    const key = keyFingerprint(publicKey)
    if (code.claimed !== undefined)
      return code.claimed.key === key ? { status: 200, body: code.claimed.grant } : refused(403, 'This code was used by another worker.')
    try {
      const grant = options.enroll(
        publicKey,
        typeof request.name === 'string' && request.name.trim() !== '' ? request.name.trim() : code.name,
      )
      code.claimed = { key, grant }
      return { status: 200, body: grant }
    } catch (error) {
      return refused(400, error instanceof Error ? error.message : 'The home couldn’t enroll this worker.')
    }
  }
  const open = async (): Promise<number> => {
    const listening = server?.address()
    if (listening !== null && listening !== undefined && typeof listening === 'object') return listening.port
    if (opening !== undefined) return opening
    opening = (async () => {
      const made = createServer({ cert: options.authority.home.certificate, key: options.authority.home.key }, (request, response) => {
        const reply = (status: number, body: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          response.end(JSON.stringify(body))
        }
        if (request.method !== 'POST' || request.url !== '/v1/workers/enroll') return reply(404, { message: 'Not found' })
        const chunks: Buffer[] = []
        let size = 0
        request.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BODY) request.destroy()
          else chunks.push(chunk)
        })
        request.on('end', () => {
          const result = answer(request.socket.remoteAddress ?? '', Buffer.concat(chunks).toString('utf8'))
          reply(result.status, result.body)
        })
      })
      made.headersTimeout = 10_000
      made.requestTimeout = 15_000
      // Beside the worker port where that is free, else wherever the system puts it: the code says which.
      const listen = (port: number) =>
        new Promise<void>((resolve, reject) => {
          made.once('error', reject)
          made.listen(port, '::', () => {
            made.off('error', reject)
            resolve()
          })
        })
      await listen(options.port + 1).catch(() => listen(0))
      server = made
      return (made.address() as AddressInfo).port
    })()
    try {
      return await opening
    } catch {
      opening = undefined
      throw new WorkerHomeError('HostUnavailable', 'The home couldn’t open a port for a worker to enroll on.')
    }
  }
  return {
    /** A new one-time code, for a worker by this name: it opens the port it enrolls on until every code is over. */
    make: async (name: string) => {
      sweep()
      if (pending.size >= MAX_CODES)
        throw new WorkerHomeError('InvalidConfig', 'Too many codes are waiting. Use one, or wait for them to expire.')
      const enrollPort = await open()
      const token = randomBytes(32).toString('base64url')
      const expiresAt = options.now() + LIFETIME
      pending.set(tokenHash(token), { name: name.trim().slice(0, 80) || 'Worker', expiresAt })
      clearTimeout(timer)
      // Node's own timer, outside any effect: closing the port once the last code is over.
      // oxlint-disable-next-line althar/one-clock
      timer = setTimeout(sweep, LIFETIME + AFTER + 1_000)
      timer.unref()
      const code: WorkerCode = {
        homeId: options.homeId,
        addresses: homeAddresses(enrollPort),
        port: enrollPort,
        authority: Buffer.from(new X509Certificate(options.authority.certificate).raw).toString('base64url'),
        token,
        expiresAt,
      }
      return { code: `${PREFIX}${Buffer.from(JSON.stringify(code)).toString('base64url')}`, expiresAt }
    },
    close,
    /** For tests: what a request to the enrollment port gets. */
    answer,
  }
}
