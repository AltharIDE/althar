import { createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join, relative, sep } from 'node:path'

import { TLS_CERTIFICATE_MAX_BYTES } from '@althar/contracts'
import { httpsOrigin, tlsPublicKeyPin } from '@althar/transport-node'
import { Effect, Schema } from 'effect'

import { HostError, storageFailure } from './errors'
import { readApprovalKeys } from './approvalKeys'
import type { HostOptions } from './options'
import { readPrivate, writePrivate } from './privateFiles'

const Configuration = Schema.Struct({
  version: Schema.Literal(1),
  origin: Schema.String,
  address: Schema.String,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  certificate: Schema.String,
  key: Schema.String,
  approvalKeys: Schema.optional(Schema.String),
})
export type NetworkConfiguration = typeof Configuration.Type
const invalid = () =>
  new HostError({
    code: 'InvalidConfig',
    message:
      'Configure an HTTPS origin, IP listen address, port and matching private TLS certificate/key files outside project workspaces.',
  })
export const insidePath = (root: string, path: string) => {
  const name = relative(root, path)
  return name === '' || (!isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`))
}

export const readNetworkConfiguration = (profile: string) =>
  Effect.tryPromise({
    try: async () => {
      const bytes = await readPrivate(join(profile, 'network.json'), 16 * 1024)
      if (bytes === null) return undefined
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (
        typeof value === 'object' &&
        value !== null &&
        'version' in value &&
        value.version === 1 &&
        'disabled' in value &&
        value.disabled === true
      )
        return undefined
      return Schema.decodeUnknownSync(Configuration)(value)
    },
    catch: (error) => (error instanceof HostError ? error : invalid()),
  })

export const networkFiles = (options: Pick<HostOptions, 'profile' | 'worktrees'>, given: NetworkConfiguration) =>
  Effect.tryPromise({
    try: async () => {
      const config = Schema.decodeUnknownSync(Configuration)(given)
      const origin = httpsOrigin(config.origin)
      const approvalKeys = config.approvalKeys === undefined ? undefined : await readApprovalKeys(config.approvalKeys, origin)
      if (!isIP(config.address) || !isAbsolute(config.certificate) || !isAbsolute(config.key)) throw invalid()
      const keyPath = await realpath(config.key)
      if (insidePath(await realpath(options.profile), keyPath) || insidePath(await realpath(options.worktrees), keyPath)) throw invalid()
      const certificate = await readPrivate(config.certificate, 64 * 1024)
      const key = await readPrivate(config.key, 64 * 1024)
      if (certificate === null || key === null) throw invalid()
      try {
        const parsed = new X509Certificate(certificate)
        if (!['rsa', 'rsa-pss', 'ec'].includes(parsed.publicKey.asymmetricKeyType ?? ''))
          throw new HostError({ code: 'InvalidConfig', message: 'Use an RSA or ECDSA TLS certificate for desktop compatibility.' })
        if (parsed.raw.length > TLS_CERTIFICATE_MAX_BYTES)
          throw new HostError({ code: 'InvalidConfig', message: 'Use a TLS leaf certificate of at most 4 KiB for pairing.' })
        if (!parsed.checkPrivateKey(createPrivateKey(key))) throw invalid()
        const tlsCertificate = parsed.raw.toString('base64url')
        const networkFingerprint = createHash('sha256')
          .update(JSON.stringify([origin, config.address, config.port, tlsCertificate]))
          .digest('hex')
        return {
          config: { ...config, origin },
          certificate,
          key,
          approvalKeys,
          tlsKeyPin: tlsPublicKeyPin(certificate),
          tlsCertificate,
          networkFingerprint,
        }
      } catch (error) {
        key.fill(0)
        throw error
      }
    },
    catch: (error) => (error instanceof HostError ? error : invalid()),
  })

export const configureNetwork = (options: HostOptions) =>
  Effect.gen(function* () {
    if (options.network === undefined) return yield* invalid()
    const files = yield* networkFiles(options, options.network)
    yield* Effect.tryPromise({
      try: () => writePrivate(join(options.profile, 'network.json'), JSON.stringify(files.config), true),
      catch: storageFailure,
    }).pipe(Effect.ensuring(Effect.sync(() => files.key.fill(0))))
    return { origin: files.config.origin, tlsKeyPin: files.tlsKeyPin }
  })

export const disableNetwork = (profile: string) =>
  Effect.tryPromise({
    try: () => writePrivate(join(profile, 'network.json'), JSON.stringify({ version: 1, disabled: true }), true),
    catch: storageFailure,
  })
