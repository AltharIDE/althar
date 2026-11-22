import { X509Certificate, createPrivateKey } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join, relative, sep } from 'node:path'

import { bindWorkerHandshake, workerCertificateFingerprint } from '@althar/worker-protocol/grpc'
import { makeAgentWorkerPool } from '@althar/worker-protocol/agent-runs'
import { connectHomeRelay, validateHomeRelay } from '@althar/worker-protocol/relay'
import { Clock, Effect, Schema } from 'effect'

import { fileErrorCode, PrivateFileError, readPrivate, writePrivate } from '../privateFiles'
import { WorkerHomeError } from './errors'
import { openWorkerStore } from './store'

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

const Configuration = Schema.Struct({
  version: Schema.Literal(1),
  address: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
  ca: Schema.String,
  certificate: Schema.String,
  key: Schema.String,
  relay: Schema.optional(Schema.String),
})
export type WorkerConfiguration = typeof Configuration.Type

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

export const listenWorkers = (options: WorkerHomePaths, homeId: string) =>
  Clock.clockWith((clock) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const bytes = await readPrivate(configurationPath(options.profile), 16384, true)
          if (!bytes) return undefined
          const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          if (raw === null) return undefined
          const config = Schema.decodeUnknownSync(Configuration)(raw)
          const relay = await relayFiles(options, config.relay)
          const tls = await tlsFiles(options, config)
          try {
            const store = await openWorkerStore(options.profile, homeId, () => clock.currentTimeMillisUnsafe())
            let listener: Awaited<ReturnType<typeof bindWorkerHandshake>> | undefined
            try {
              const ip = config.address.includes(':') ? `[${config.address}]` : config.address
              const agentWorkers = makeAgentWorkerPool(store.agents)
              const bound = await bindWorkerHandshake(`${ip}:${config.port}`, {
                homeId,
                ...tls,
                workerForCertificate: store.workerForCertificate,
                diagnostics: store,
                agentWorkers,
              })
              listener = bound
              const target = config.address === '0.0.0.0' ? '127.0.0.1' : config.address === '::' ? '::1' : config.address
              const stopRelay = relay === undefined ? undefined : connectHomeRelay(relay, { host: target, port: bound.port })
              return {
                port: bound.port,
                agentWorkers,
                close: () => {
                  stopRelay?.()
                  bound.close()
                  store.close()
                },
              }
            } catch {
              listener?.close()
              store.close()
              throw new WorkerHomeError(
                'HostUnavailable',
                'Could not start the worker listener. Check its certificate files, address and port.',
              )
            }
          } finally {
            tls.privateKeyPem.fill(0)
          }
        },
        catch: configureFailure,
      }),
      (listener) => Effect.sync(() => listener?.close()),
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
