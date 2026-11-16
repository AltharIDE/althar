import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { Secrets, SecretsUnavailable } from '@althar/runtime'
import { Effect, Layer, Schema, Semaphore } from 'effect'

import { fileErrorCode, HostError, storageFailure } from './errors'
import { privateDirectory, readPrivate, removePrivate, writePrivate } from './privateFiles'

const MAX_SECRET_BYTES = 1_048_576
const MAX_SEALED_BYTES = 1_500_000
const hex = (length: number) => Schema.String.check(Schema.isPattern(new RegExp(`^[0-9a-f]{${length}}$`)))
export const VaultMetadata = Schema.Struct({ version: Schema.Literal(1), vaultId: hex(32), keyId: hex(64) })
const Envelope = Schema.Struct({ version: Schema.Literal(1), iv: Schema.String, tag: Schema.String, ciphertext: Schema.String })
const decodeMeta = Schema.decodeUnknownSync(VaultMetadata)
const decodeEnvelope = Schema.decodeUnknownSync(Envelope)
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const unreadable = () =>
  new SecretsUnavailable({
    reason: 'This encrypted secret could not be read safely. Restore it with its original host key, or sign in again.',
    unreadable: true,
  })
const within = (root: string, file: string) => {
  const path = relative(root, file)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export interface VaultOptions {
  readonly profile: string
  readonly keyFile: string
  readonly worktrees?: string
}

export const externalKeyFile = async (options: VaultOptions, profile: string, initialize = false) => {
  const keyFile = resolve(options.keyFile)
  if (within(resolve(options.profile), keyFile) || (options.worktrees !== undefined && within(resolve(options.worktrees), keyFile)))
    throw new HostError({
      code: 'UnsafeKeyLocation',
      message: 'Keep the host master key outside the profile, its backups and task worktrees.',
    })
  const parent = initialize
    ? await privateDirectory(dirname(keyFile), true)
    : await fs.realpath(dirname(keyFile)).catch((error: unknown) => {
        if (fileErrorCode(error) !== 'ENOENT') throw error
        throw new HostError({
          code: 'NotInitialized',
          message: 'The host master key is missing. Restore the original key; do not generate a replacement for an existing host.',
        })
      })
  const canonical = join(parent, basename(keyFile))
  if (within(profile, canonical))
    throw new HostError({
      code: 'UnsafeKeyLocation',
      message: 'Keep the host master key outside the profile, its backups and task worktrees.',
    })
  if (options.worktrees !== undefined) {
    const worktrees = await fs.realpath(options.worktrees).catch((error: unknown) => {
      if (fileErrorCode(error) !== 'ENOENT') throw error
      return resolve(options.worktrees ?? '')
    })
    if (within(worktrees, canonical))
      throw new HostError({ code: 'UnsafeKeyLocation', message: 'Keep the host master key outside task worktrees.' })
  }
  return canonical
}

const bytes = (value: string, length?: number) => {
  const result = Buffer.from(value, 'base64url')
  if (result.toString('base64url') !== value || (length !== undefined && result.length !== length)) throw unreadable()
  return result
}

const open = (options: VaultOptions, initialize: boolean) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    const paths = yield* Effect.tryPromise({
      try: async () => {
        const profile = await privateDirectory(options.profile, initialize)
        const folder = await privateDirectory(join(profile, 'secrets'), initialize)
        const metadata = join(profile, 'host-vault.json')
        const before = await readPrivate(metadata, 4096)
        if (before === null && !initialize)
          throw new HostError({ code: 'NotInitialized', message: 'This host has not been initialized. Run althar-host init first.' })
        if (before === null && (await fs.readdir(folder)).length !== 0)
          throw new HostError({
            code: 'CorruptVault',
            message:
              'Existing secrets have no headless vault metadata. Import them explicitly; initialization cannot replace desktop keyring encryption.',
          })
        return { profile, folder, metadata, before, keyFile: await externalKeyFile(options, profile, initialize) }
      },
      catch: storageFailure,
    })
    let active = true
    const key = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          if (initialize && paths.before === null) {
            const generated = randomBytes(32)
            try {
              await writePrivate(paths.keyFile, generated, false)
            } finally {
              generated.fill(0)
            }
          }
          const loaded = await readPrivate(paths.keyFile, 32, true)
          if (loaded === null)
            throw new HostError({
              code: 'NotInitialized',
              message:
                'The host master key is missing. Restore the original key; initialization never replaces the key of an existing vault.',
            })
          if (loaded.length !== 32) {
            loaded.fill(0)
            throw new HostError({ code: 'InvalidConfig', message: 'The host master key must contain exactly 32 random bytes.' })
          }
          return loaded
        },
        catch: storageFailure,
      }),
      (key) =>
        lock.withPermit(
          Effect.sync(() => {
            active = false
            key.fill(0)
          }),
        ),
    )
    const meta = yield* Effect.tryPromise({
      try: async () => {
        const keyId = createHash('sha256').update(key).digest('hex')
        if (paths.before === null)
          await writePrivate(paths.metadata, JSON.stringify({ version: 1, vaultId: randomBytes(16).toString('hex'), keyId }), false)
        let value: typeof VaultMetadata.Type
        try {
          value = decodeMeta(JSON.parse(text((await readPrivate(paths.metadata, 4096)) ?? Buffer.alloc(0))))
        } catch (error) {
          if (error instanceof HostError) throw error
          throw new HostError({ code: 'CorruptVault', message: 'The encrypted host vault metadata is invalid. Restore it from a backup.' })
        }
        if (value.keyId !== keyId)
          throw new HostError({
            code: 'WrongKey',
            message: 'This master key does not match the encrypted host vault. Restore its original key.',
          })
        return value
      },
      catch: storageFailure,
    })
    const aad = (name: string) => Buffer.from(JSON.stringify(['althar.host.secret', 1, meta.vaultId, name]))
    const pathOf = (name: string) => {
      if (!/^[\w-][\w.-]{0,199}$/.test(name)) throw unreadable()
      return join(paths.folder, `${name}.json`)
    }
    const operation = <A>(run: () => Promise<A>) =>
      lock.withPermit(
        Effect.tryPromise({
          try: async () => {
            if (!active) throw new SecretsUnavailable({ reason: 'The encrypted host secret store is closed.' })
            await privateDirectory(paths.folder)
            return await run()
          },
          catch: (error) =>
            error instanceof SecretsUnavailable
              ? error
              : error instanceof HostError && error.code === 'UnsafePermissions'
                ? unreadable()
                : new SecretsUnavailable({
                    reason: 'The encrypted host secret store is unavailable. Check permissions and free disk space.',
                  }),
        }).pipe(Effect.uninterruptible),
      )
    const secrets = Secrets.of({
      set: (name, value) =>
        operation(async () => {
          const path = pathOf(name)
          if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) throw unreadable()
          const plain = Buffer.from(value)
          try {
            if (plain.toString('utf8') !== value) throw unreadable()
            await readPrivate(path, MAX_SEALED_BYTES)
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, iv)
            cipher.setAAD(aad(name))
            const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
            await writePrivate(
              path,
              JSON.stringify({
                version: 1,
                iv: iv.toString('base64url'),
                tag: cipher.getAuthTag().toString('base64url'),
                ciphertext: ciphertext.toString('base64url'),
              }),
              true,
            )
          } finally {
            plain.fill(0)
          }
        }),
      get: (name) =>
        operation(async () => {
          const stored = await readPrivate(pathOf(name), MAX_SEALED_BYTES)
          if (stored === null) return null
          try {
            const envelope = decodeEnvelope(JSON.parse(text(stored)))
            const decipher = createDecipheriv('aes-256-gcm', key, bytes(envelope.iv, 12))
            decipher.setAuthTag(bytes(envelope.tag, 16))
            decipher.setAAD(aad(name))
            const plain = Buffer.concat([decipher.update(bytes(envelope.ciphertext)), decipher.final()])
            try {
              return text(plain)
            } finally {
              plain.fill(0)
            }
          } catch {
            throw unreadable()
          }
        }),
      remove: (name) => operation(() => removePrivate(pathOf(name), MAX_SEALED_BYTES)),
    })
    return { secrets: Layer.succeed(Secrets, secrets), vaultId: meta.vaultId }
  })

/** Initialization may create a new key only before vault metadata exists; reopening never rotates or repairs keys. */
export const initializeVault = (options: VaultOptions) => Effect.scoped(open(options, true)).pipe(Effect.asVoid)
export const openVault = (options: VaultOptions) => open(options, false)
