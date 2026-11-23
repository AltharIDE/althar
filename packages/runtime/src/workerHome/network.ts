import { X509Certificate, createPrivateKey } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join, relative, sep } from 'node:path'

import { bindWorkerHandshake, workerCertificateFingerprint } from '@althar/worker-protocol/grpc'
import { makeAgentWorkerPool, type AgentWorkerConnection, type AgentWorkerPool } from '@althar/worker-protocol/agent-runs'
import { connectHomeRelay, validateHomeRelay } from '@althar/worker-protocol/relay'
import { Clock, Effect, Schema } from 'effect'

import { fileErrorCode, PrivateFileError, readPrivate, writePrivate } from '../privateFiles'
import { WorkerHomeError } from './errors'
import { homeAddresses, SERVER_NAME, workerAuthority } from './authority'
import { keyFingerprint, workerCodes, type WorkerGrant } from './codes'
import { openWorkerStore, type EnrolledWorker } from './store'

export interface WorkerHomePaths {
  readonly profile: string
  readonly worktrees: string
}

const insidePath = (root: string, path: string) => {
  const name = relative(root, path)
  return name === '' || (!isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`))
}

const canonical = (path: string) =>
  realpath(path).catch((error: unknown) => {
    if (fileErrorCode(error) === 'ENOENT') return path
    throw error
  })

const Configured = Schema.Struct({
  version: Schema.Literal(1),
  address: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
  ca: Schema.String,
  certificate: Schema.String,
  key: Schema.String,
  relay: Schema.optional(Schema.String),
})
export type WorkerConfiguration = typeof Configured.Type
/** Kept by the home itself once the person adds a worker: its own authority's certificates (`authority.ts`), on this port. */
const Managed = Schema.Struct({
  version: Schema.Literal(2),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
})
const Configuration = Schema.Union([Configured, Managed])
/** The port a home takes workers on, where it is free; another the system picks where it isn't. */
export const WORKER_PORT = 6770

const invalid = () =>
  new WorkerHomeError(
    'InvalidConfig',
    'Workers need an IP listen address, a certificate authority, and a matching private TLS certificate and key outside project workspaces',
  )
const configurationPath = (profile: string) => join(profile, 'workers.json')
const RelayLink = Schema.Struct({ url: Schema.String, tokenFile: Schema.String, caFile: Schema.String })

const relayFiles = async (options: WorkerHomePaths, path: string | undefined) => {
  if (path === undefined) return undefined
  try {
    const worktrees = await canonical(options.worktrees)
    if (!isAbsolute(path) || insidePath(worktrees, await realpath(path))) throw invalid()
    const config = await readPrivate(path, 4096, true)
    if (config === null) throw invalid()
    const link = Schema.decodeUnknownSync(RelayLink)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(config)))
    if (
      !isAbsolute(link.caFile) ||
      !isAbsolute(link.tokenFile) ||
      insidePath(worktrees, await realpath(link.caFile)) ||
      insidePath(worktrees, await realpath(link.tokenFile))
    )
      throw invalid()
    const ca = await readPrivate(link.caFile, 65536, true)
    if (ca === null) throw invalid()
    const secret = await readPrivate(link.tokenFile, 128, true)
    if (secret === null) throw invalid()
    try {
      const relay = { ca, token: secret.toString('utf8').trim(), url: link.url }
      validateHomeRelay(relay)
      return relay
    } finally {
      secret.fill(0)
    }
  } catch {
    throw new WorkerHomeError('InvalidConfig', 'Choose a private worker relay link and credentials outside project workspaces.')
  }
}

const tlsFiles = async (options: WorkerHomePaths, config: WorkerConfiguration) => {
  if (!isIP(config.address) || ![config.ca, config.certificate, config.key].every(isAbsolute)) throw invalid()
  const keyPath = await realpath(config.key)
  if (insidePath(await canonical(options.profile), keyPath) || insidePath(await canonical(options.worktrees), keyPath)) throw invalid()
  const ca = await readPrivate(config.ca, 65536, true)
  const certificate = await readPrivate(config.certificate, 65536, true)
  if (!ca || !certificate) throw invalid()
  const key = await readPrivate(config.key, 65536, true)
  if (!key) throw invalid()
  try {
    if (!new X509Certificate(ca).ca || !new X509Certificate(certificate).checkPrivateKey(createPrivateKey(key))) throw invalid()
    return { certificateAuthorityPem: ca, certificatePem: certificate, privateKeyPem: key }
  } catch (error) {
    key.fill(0)
    throw error
  }
}

const configureFailure = (error: unknown) => (error instanceof WorkerHomeError || error instanceof PrivateFileError ? error : invalid())

export const configureWorkers = (options: WorkerHomePaths, config: WorkerConfiguration | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const files = config === undefined ? undefined : await tlsFiles(options, config)
      try {
        await relayFiles(options, config?.relay)
        await writePrivate(configurationPath(options.profile), JSON.stringify(config ?? null), true)
      } finally {
        files?.privateKeyPem.fill(0)
      }
      return { enabled: config !== undefined }
    },
    catch: configureFailure,
  })

const readConfiguration = async (profile: string) => {
  const bytes = await readPrivate(configurationPath(profile), 16384, true)
  if (!bytes) return undefined
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (raw === null) return undefined
  return Schema.decodeUnknownSync(Configuration)(raw)
}

/** A home's worker listener, open: its port, its workers connected now, and its ledger of every one it enrolled. */
export interface WorkerListener {
  readonly port: number
  readonly agentWorkers: AgentWorkerPool
  /** The home's enrolled workers, connected or not, for its own list of them. */
  readonly workers: () => ReadonlyArray<EnrolledWorker>
  /** Takes a worker out of this home: its certificate is no longer accepted, and it gets no more work. */
  readonly revoke: (workerId: string) => void
  /** The run a worker's reservation still holds, through a dropped connection, until it says the run ended. */
  readonly outstanding: (workerId: string) => { readonly workspaceId: string } | undefined
  /** The home keeps its own authority: it enrolls workers itself (`managed`), rather than an operator's certificates. */
  readonly managed?: WorkerEnrollment
  readonly close: () => void
}

/** What the home's own authority lets it do: sign a worker's key, make a one-time code, and say which projects it works on. */
export interface WorkerEnrollment {
  readonly enroll: (input: { readonly publicKey: Uint8Array; readonly name: string; readonly ssh: string | null }) => WorkerGrant
  readonly code: (name: string) => Promise<{ readonly code: string; readonly expiresAt: number }>
  readonly assign: (workerId: string, projectIds: ReadonlyArray<string>) => void
}

const startListener = async (
  options: WorkerHomePaths,
  homeId: string,
  config: typeof Configuration.Type,
  now: () => number,
  connectionChanged: ((outcome: AgentWorkerConnection) => void) | undefined,
): Promise<WorkerListener> => {
  const relay = config.version === 1 ? await relayFiles(options, config.relay) : undefined
  const authority = config.version === 2 ? await workerAuthority(options.profile, now()) : undefined
  const tls =
    config.version === 1
      ? await tlsFiles(options, config)
      : {
          certificateAuthorityPem: Buffer.from(authority?.certificate ?? ''),
          certificatePem: Buffer.from(authority?.home.certificate ?? ''),
          privateKeyPem: Buffer.from(authority?.home.key ?? ''),
        }
  try {
    const store = await openWorkerStore(options.profile, homeId, now)
    let listener: Awaited<ReturnType<typeof bindWorkerHandshake>> | undefined
    let codes: ReturnType<typeof workerCodes> | undefined
    try {
      const address = config.version === 1 ? config.address : '::'
      const ip = address.includes(':') ? `[${address}]` : address
      const agentWorkers = makeAgentWorkerPool(store.agents, connectionChanged)
      const bound = await bindWorkerHandshake(`${ip}:${config.port}`, {
        homeId,
        ...tls,
        workerForCertificate: store.workerForCertificate,
        diagnostics: store,
        agentWorkers,
      })
      listener = bound
      const target = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '::1' : address
      const stopRelay =
        config.version === 1 && relay !== undefined ? connectHomeRelay(relay, { host: target, port: bound.port }) : undefined
      const grant = (workerId: string, publicKey: Uint8Array): WorkerGrant => {
        if (authority === undefined) throw new WorkerHomeError('InvalidConfig', 'This home takes workers by its operator’s certificates.')
        return {
          homeId,
          workerId,
          authority: authority.certificate,
          certificate: authority.issue(publicKey, workerId, now()),
          serverName: SERVER_NAME,
          port: bound.port,
          addresses: homeAddresses(bound.port),
        }
      }
      const enroll = (input: { readonly publicKey: Uint8Array; readonly name: string; readonly ssh: string | null }) => {
        if (authority === undefined) throw new WorkerHomeError('InvalidConfig', 'This home takes workers by its operator’s certificates.')
        // The certificate is made for its worker ID, which its fingerprint gives: sign once to name it, then enroll that.
        const fingerprint = keyFingerprint(input.publicKey)
        const workerId = store.enrollNamed(fingerprint, input.name, input.ssh)
        return grant(workerId, input.publicKey)
      }
      if (authority !== undefined)
        codes = workerCodes({
          homeId,
          authority,
          port: bound.port,
          now,
          enroll: (publicKey, name) => enroll({ publicKey, name, ssh: null }),
        })
      return {
        port: bound.port,
        agentWorkers,
        workers: () => store.workers(),
        revoke: (workerId: string) => store.revoke(workerId),
        outstanding: (workerId: string) => store.agents.outstanding(workerId),
        ...(codes === undefined
          ? {}
          : {
              managed: {
                enroll,
                code: codes.make,
                assign: (workerId, projectIds) => store.assign(workerId, projectIds),
              },
            }),
        close: () => {
          codes?.close()
          stopRelay?.()
          bound.close()
          store.close()
        },
      }
    } catch {
      codes?.close()
      listener?.close()
      store.close()
      throw new WorkerHomeError('HostUnavailable', 'Could not start the worker listener. Check its certificate files, address and port.')
    }
  } finally {
    tls.privateKeyPem.fill(0)
  }
}

export const listenWorkers = (options: WorkerHomePaths, homeId: string, connectionChanged?: (outcome: AgentWorkerConnection) => void) =>
  Clock.clockWith((clock) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const config = await readConfiguration(options.profile)
          if (config === undefined) return undefined
          return startListener(options, homeId, config, () => clock.currentTimeMillisUnsafe(), connectionChanged)
        },
        catch: configureFailure,
      }),
      (listener) => Effect.sync(() => listener?.close()),
    ),
  )

/**
 * Lets a home take workers, now, without a restart (the person's Add a worker): it keeps a managed configuration, makes
 * its own authority, and opens its worker port, `WORKER_PORT` where that is free. A home already listening stays as it is.
 */
export const openWorkers = (options: WorkerHomePaths, homeId: string, connectionChanged?: (outcome: AgentWorkerConnection) => void) =>
  Clock.clockWith((clock) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const now = () => clock.currentTimeMillisUnsafe()
          const kept = await readConfiguration(options.profile)
          if (kept !== undefined) return startListener(options, homeId, kept, now, connectionChanged)
          let listening: WorkerListener
          try {
            listening = await startListener(options, homeId, { version: 2, port: WORKER_PORT }, now, connectionChanged)
          } catch (error) {
            // Taken by something else (gRPC says only that it couldn't bind): the port the system picks, kept, so a worker
            // finds it there again after a restart.
            if (!(error instanceof WorkerHomeError) || error.code !== 'HostUnavailable') throw error
            listening = await startListener(options, homeId, { version: 2, port: 0 }, now, connectionChanged)
          }
          await writePrivate(configurationPath(options.profile), JSON.stringify({ version: 2, port: listening.port }), true)
          return listening
        },
        catch: configureFailure,
      }),
      (listener) => Effect.sync(() => listener.close()),
    ),
  )

export const workerCertificate = async (path: string) => {
  const bytes = await readPrivate(path, 65536, true)
  try {
    if (!bytes) throw invalid()
    const certificate = new X509Certificate(bytes)
    if (certificate.ca) throw invalid()
    return workerCertificateFingerprint(certificate.raw)
  } catch {
    throw new WorkerHomeError('InvalidConfig', 'Choose the worker client certificate in PEM format')
  }
}
