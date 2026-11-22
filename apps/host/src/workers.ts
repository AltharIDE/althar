import { X509Certificate, createPrivateKey } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'

import { bindWorkerHandshake, workerCertificateFingerprint } from '@althar/worker-protocol/grpc'
import { makeAgentWorkerPool } from '@althar/worker-protocol/agent-runs'
import { connectHomeRelay, validateHomeRelay } from '@althar/worker-protocol/relay'
import { Effect, Schema } from 'effect'

import { HostError, storageFailure } from './errors'
import { insidePath } from './network'
import type { HostOptions } from './options'
import { readPrivate, writePrivate } from './privateFiles'
import { hostStatus } from './status'
import { readHomeId } from './updates/store'
import { openWorkerStore } from './workerStore'

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
  new HostError({
    code: 'InvalidConfig',
    message:
      'Workers need an IP listen address, a certificate authority, and a matching private TLS certificate and key outside project workspaces',
  })
const configurationPath = (profile: string) => join(profile, 'workers.json')
const RelayLink = Schema.Struct({ url: Schema.String, tokenFile: Schema.String, caFile: Schema.String })

const relayFiles = async (options: HostOptions, path: string | undefined) => {
  if (path === undefined) return undefined
  try {
    if (!isAbsolute(path) || insidePath(options.worktrees, await realpath(path))) throw invalid()
    const config = await readPrivate(path, 4096, true)
    if (config === null) throw invalid()
    const link = Schema.decodeUnknownSync(RelayLink)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(config)))
    if (
      !isAbsolute(link.caFile) ||
      !isAbsolute(link.tokenFile) ||
      insidePath(options.worktrees, await realpath(link.caFile)) ||
      insidePath(options.worktrees, await realpath(link.tokenFile))
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
    throw new HostError({
      code: 'InvalidConfig',
      message: 'Choose a private worker relay link and credentials outside project workspaces.',
    })
  }
}

const tlsFiles = async (options: HostOptions, config: WorkerConfiguration) => {
  if (!isIP(config.address) || ![config.ca, config.certificate, config.key].every(isAbsolute)) throw invalid()
  const keyPath = await realpath(config.key)
  if (insidePath(options.profile, keyPath) || insidePath(options.worktrees, keyPath)) throw invalid()
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

const configureFailure = (error: unknown) => (error instanceof HostError ? error : invalid())

export const configureWorkers = (options: HostOptions, config: WorkerConfiguration | undefined) =>
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

export const listenWorkers = (options: HostOptions, homeId: string) =>
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
          const store = await openWorkerStore(options.profile, homeId)
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
            throw new HostError({
              code: 'HostUnavailable',
              message: 'Could not start the worker listener. Check its certificate files, address and port.',
            })
          }
        } finally {
          tls.privateKeyPem.fill(0)
        }
      },
      catch: configureFailure,
    }),
    (listener) => Effect.sync(() => listener?.close()),
  )

export const workerOperation = <A>(
  profile: string,
  operation: (store: Awaited<ReturnType<typeof openWorkerStore>>) => A | Promise<A>,
  projectId?: string,
) =>
  Effect.gen(function* () {
    // The live runtime holds its database exclusively. Use its authenticated
    // local endpoint, and read the offline identity only while it is stopped.
    const homeId = yield* hostStatus(profile, false, projectId).pipe(
      Effect.map((ready) => ready.homeId),
      Effect.catchIf(
        (error) => projectId === undefined && error.code === 'HostUnavailable',
        () => Effect.try({ try: () => readHomeId(join(profile, 'althar.sqlite')), catch: storageFailure }),
      ),
    )
    return yield* Effect.tryPromise({
      try: async () => {
        const store = await openWorkerStore(profile, homeId)
        try {
          return await operation(store)
        } finally {
          store.close()
        }
      },
      catch: storageFailure,
    })
  })

export const workerCertificate = async (path: string) => {
  const bytes = await readPrivate(path, 65536, true)
  try {
    if (!bytes) throw invalid()
    const certificate = new X509Certificate(bytes)
    if (certificate.ca) throw invalid()
    return workerCertificateFingerprint(certificate.raw)
  } catch {
    throw new HostError({ code: 'InvalidConfig', message: 'Choose the worker client certificate in PEM format' })
  }
}
