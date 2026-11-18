import { X509Certificate, createPrivateKey } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'

import { bindWorkerHandshake, workerCertificateFingerprint } from '@althar/worker-protocol/grpc'
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
})
export type WorkerConfiguration = typeof Configuration.Type

const invalid = () =>
  new HostError({
    code: 'InvalidConfig',
    message:
      'Workers need an IP listen address, a certificate authority, and a matching private TLS certificate and key outside project workspaces',
  })
const configurationPath = (profile: string) => join(profile, 'workers.json')

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
        const tls = await tlsFiles(options, config)
        try {
          const store = await openWorkerStore(options.profile, homeId)
          try {
            const ip = config.address.includes(':') ? `[${config.address}]` : config.address
            const listener = await bindWorkerHandshake(`${ip}:${config.port}`, {
              homeId,
              ...tls,
              workerForCertificate: store.workerForCertificate,
              diagnostics: store,
            })
            return {
              port: listener.port,
              close: () => {
                listener.close()
                store.close()
              },
            }
          } catch {
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

export const workerOperation = <A>(profile: string, operation: (store: Awaited<ReturnType<typeof openWorkerStore>>) => A | Promise<A>) =>
  Effect.gen(function* () {
    // The live runtime holds its database exclusively. Use its authenticated
    // local endpoint, and read the offline identity only while it is stopped.
    const homeId = yield* hostStatus(profile).pipe(
      Effect.map((ready) => ready.homeId),
      Effect.catchIf(
        (error) => error.code === 'HostUnavailable',
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
