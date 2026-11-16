import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { ClientPublicKey, PairingTokenHash } from '@althar/contracts'
import { createDeviceKey, type DeviceKey } from '@althar/transport-node'
import { Effect, Schema } from 'effect'

const Id = Schema.String.check(Schema.isPattern(/^remote_[0-9a-f]{32}$/))
const Record = Schema.Struct({
  id: Id,
  pairingHash: PairingTokenHash,
  expiresAt: Schema.Int,
  publicKey: ClientPublicKey,
  sealed: Schema.String.check(Schema.isMaxLength(8192)),
})
const File = Schema.Struct({ version: Schema.Literal(1), keys: Schema.Array(Record).check(Schema.isMaxLength(64)) })
const Key = Schema.Struct({
  id: Id,
  pairingHash: PairingTokenHash,
  publicKey: ClientPublicKey,
  privateKey: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{64}$/)),
})
const unavailable = () => new Error('Saved connection keys could not be opened safely. Unlock the system keyring or pair the home again.')
export type ProtectCredential = (sealing: boolean, value: string) => Promise<string>

/** OS-encrypted connection keys, separate from public home settings. No plaintext fallback. */
export const connectionCredentials = (profile: string, protect: ProtectCredential, now = Date.now) => {
  const directory = join(profile, 'connection-keys')
  const path = join(directory, 'devices.json')
  let tail: Promise<unknown> = Promise.resolve()
  let queued = 0
  const read = async () => {
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const dir = await fs.lstat(directory)
      if (
        !dir.isDirectory() ||
        dir.isSymbolicLink() ||
        (process.getuid !== undefined && dir.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (dir.mode & 0o077) !== 0)
      )
        throw unavailable()
      let handle
      try {
        handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
        throw unavailable()
      }
      try {
        const stat = await handle.stat()
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > 256 * 1024 ||
          (process.getuid !== undefined && stat.uid !== process.getuid()) ||
          (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        )
          throw unavailable()
        const bytes = Buffer.alloc(256 * 1024 + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 256 * 1024) throw unavailable()
        const file = Schema.decodeUnknownSync(File)(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))),
        )
        if (
          new Set(file.keys.map((key) => key.id)).size !== file.keys.length ||
          new Set(file.keys.map((key) => key.pairingHash)).size !== file.keys.length
        )
          throw unavailable()
        return file.keys
      } finally {
        await handle.close()
      }
    } catch {
      throw unavailable()
    }
  }
  const write = async (keys: ReadonlyArray<typeof Record.Type>) => {
    const temporary = join(directory, `devices-${randomUUID()}.tmp`)
    try {
      const bytes = Buffer.from(JSON.stringify({ version: 1, keys }))
      if (bytes.length > 256 * 1024) throw unavailable()
      const handle = await fs.open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, path)
      if (process.platform !== 'win32') {
        const dir = await fs.open(directory, 'r')
        try {
          await dir.sync()
        } finally {
          await dir.close()
        }
      }
    } catch {
      throw unavailable()
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  const unlock = async (record: typeof Record.Type): Promise<DeviceKey> => {
    const plain = await protect(false, record.sealed)
    try {
      const key = Schema.decodeUnknownSync(Key)(JSON.parse(plain))
      if (key.id !== record.id || key.pairingHash !== record.pairingHash || key.publicKey !== record.publicKey) throw unavailable()
      return { publicKey: key.publicKey, privateKey: key.privateKey }
    } catch {
      throw unavailable()
    }
  }
  const serialized = <A>(operation: () => Promise<A>): Promise<A> => {
    if (queued >= 16) return Promise.reject(new Error('Connection keys are busy. Try again shortly.'))
    queued++
    const next = tail.then(operation).finally(() => {
      queued--
    })
    tail = next.catch(() => undefined)
    return next
  }
  return {
    pending: (pairingHash: string, expiresAt: number, used: ReadonlySet<string>) =>
      serialized(async () => {
        Schema.decodeUnknownSync(PairingTokenHash)(pairingHash)
        const records = (await read()).filter((key) => key.expiresAt > now() || used.has(key.id))
        const previous = records.find((key) => key.pairingHash === pairingHash)
        if (previous !== undefined) return { id: previous.id, key: await unlock(previous) }
        if (records.length >= 64) throw new Error('Forget an unused home before pairing another.')
        const id = `remote_${randomUUID().replaceAll('-', '')}`
        const key = await Effect.runPromise(createDeviceKey)
        const sealed = await protect(true, JSON.stringify({ id, pairingHash, ...key }))
        await write([...records, { id, pairingHash, expiresAt, publicKey: key.publicKey, sealed }])
        return { id, key }
      }),
    load: (id: string) =>
      serialized(async () => {
        const record = (await read()).find((key) => key.id === id)
        if (record === undefined) throw unavailable()
        return unlock(record)
      }),
    forget: (id: string) => serialized(async () => write((await read()).filter((key) => key.id !== id))),
  }
}
