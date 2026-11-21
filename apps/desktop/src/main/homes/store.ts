import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { HttpsHomeTarget, HomeId } from '@althar/contracts'
import { httpsOrigin, sshArguments } from '@althar/transport-node'
import { Schema } from 'effect'

import type { RemoteHome, SshHomeTarget } from '../../homes'

const MAX_BYTES = 384 * 1024
const MAX_HOMES = 50
const target = Schema.Struct({
  target: Schema.String,
  profile: Schema.optional(Schema.String),
  launcher: Schema.optional(Schema.String),
  configFile: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int),
})
const base = {
  id: Schema.String.check(Schema.isPattern(/^remote_[0-9a-f]{32}$/)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  homeId: HomeId,
}
const home = Schema.Union([
  Schema.Struct({ ...base, ssh: target }),
  Schema.Struct({
    ...base,
    https: HttpsHomeTarget,
  }),
])
const file = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    homes: Schema.Array(Schema.Struct({ ...base, ssh: target })).check(Schema.isMaxLength(MAX_HOMES)),
  }),
  Schema.Struct({ version: Schema.Literal(2), homes: Schema.Array(home).check(Schema.isMaxLength(MAX_HOMES)) }),
])
const unsafe = () => new Error('Saved home connections could not be read safely. Check this app profile’s permissions.')
const controls = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

export const homeName = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 120 || controls(value))
    throw new Error('Give the home a name of at most 120 characters, without control characters.')
  return value.trim()
}
export const homeTarget = (value: unknown): SshHomeTarget => {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Object.keys(value).some((key) => !['target', 'profile', 'launcher', 'configFile', 'port'].includes(key))
    )
      throw unsafe()
    const parsed = Schema.decodeUnknownSync(target)(value)
    sshArguments(parsed)
    return parsed
  } catch {
    throw new Error('Use an SSH host or alias and absolute paths for optional connection settings.')
  }
}
export const savedHome = (value: unknown): RemoteHome => {
  if (typeof value !== 'object' || value === null || 'ssh' in value === 'https' in value) throw unsafe()
  const parsed = Schema.decodeUnknownSync(home)(value)
  homeName(parsed.name)
  if ('ssh' in parsed) homeTarget(parsed.ssh)
  else if (httpsOrigin(parsed.https.origin) !== parsed.https.origin || parsed.https.homeId !== parsed.homeId) throw unsafe()
  return parsed
}

export const forgottenHome = () => new Error('This saved home was forgotten. Check its host to connect again.')
const savedOf = (homes: ReadonlyArray<RemoteHome>, id: string): RemoteHome => {
  const found = homes.find((one) => one.id === id)
  if (found === undefined) throw forgottenHome()
  return found
}

/** Serialized atomic writes; no database, tokens or private device keys belong in this file. */
export const homeStore = (profile: string) => {
  const path = join(profile, 'homes.json')
  let tail: Promise<unknown> = Promise.resolve()
  let queued = 0
  const directory = async () => {
    await fs.mkdir(profile, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(profile)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid !== undefined && stat.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (stat.mode & 0o022) !== 0)
    )
      throw unsafe()
  }
  const read = async (): Promise<ReadonlyArray<RemoteHome>> => {
    await directory()
    let handle
    try {
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
      throw unsafe()
    }
    try {
      const stat = await handle.stat()
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > MAX_BYTES ||
        (process.getuid !== undefined && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        throw unsafe()
      const bytes = Buffer.alloc(MAX_BYTES + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > MAX_BYTES) throw unsafe()
      const parsed = Schema.decodeUnknownSync(file)(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))),
      )
      const ids = new Set<string>()
      for (const one of parsed.homes) {
        savedHome(one)
        if (ids.has(one.id)) throw unsafe()
        ids.add(one.id)
      }
      return parsed.homes
    } catch {
      throw unsafe()
    } finally {
      await handle.close()
    }
  }
  /**
   * A read waits its turn behind the writes before it, and they behind it: Windows won't
   * replace a file another handle has open, so a read beside a write fails its rename.
   */
  const list = (): Promise<ReadonlyArray<RemoteHome>> => {
    const next = tail.then(read)
    tail = next.catch(() => undefined)
    return next
  }
  const change = <A>(update: (homes: ReadonlyArray<RemoteHome>) => { homes: ReadonlyArray<RemoteHome>; result: A }): Promise<A> => {
    if (queued >= 16) return Promise.reject(new Error('Home connection settings are busy. Try again.'))
    queued++
    const next = tail
      .then(async () => {
        const updated = update(await read())
        const contents = Buffer.from(JSON.stringify({ version: 2, homes: updated.homes }))
        if (updated.homes.length > MAX_HOMES || contents.length > MAX_BYTES)
          throw new Error('Forget an unused home before saving another connection.')
        const temporary = join(profile, `homes-${randomUUID()}.tmp`)
        try {
          const handle = await fs.open(temporary, 'wx', 0o600)
          try {
            await handle.writeFile(contents)
            await handle.sync()
          } finally {
            await handle.close()
          }
          await fs.rename(temporary, path)
        } finally {
          await fs.rm(temporary, { force: true })
        }
        return updated.result
      })
      .finally(() => {
        queued--
      })
    tail = next.catch(() => undefined)
    return next
  }
  return {
    list,
    save: (given: RemoteHome) =>
      change((homes) => {
        const parsed = savedHome(given)
        const existing = homes.find(
          (one) =>
            one.homeId === parsed.homeId &&
            JSON.stringify({ ssh: one.ssh, https: one.https }) === JSON.stringify({ ssh: parsed.ssh, https: parsed.https }),
        )
        if (existing !== undefined) return { homes, result: existing }
        const previous = homes.find((one) => one.id === parsed.id)
        if (previous !== undefined && previous.homeId !== parsed.homeId) throw unsafe()
        return {
          homes: previous === undefined ? [...homes, parsed] : homes.map((one) => (one.id === parsed.id ? parsed : one)),
          result: parsed,
        }
      }),
    forget: (id: string) => change((homes) => ({ homes: homes.filter((one) => one.id !== id), result: undefined })),
    rename: (id: string, name: string) =>
      change((homes) => {
        const label = homeName(name)
        const found = savedOf(homes, id)
        const renamed = { ...found, name: label }
        return { homes: homes.map((one) => (one.id === id ? renamed : one)), result: renamed }
      }),
    /** A saved home reached another way: its identity stays, only how SSH reaches it changes. */
    change: (id: string, ssh: SshHomeTarget) =>
      change((homes) => {
        const target = homeTarget(ssh)
        const found = savedOf(homes, id)
        if (found.ssh === undefined) throw new Error('Use a new pairing code to change a secure connection.')
        const changed = { ...found, ssh: target }
        return { homes: homes.map((one) => (one.id === id ? changed : one)), result: changed }
      }),
    /** A home forgotten a moment ago, back where it was, unless it is saved again already. */
    restore: (given: RemoteHome, index: number) =>
      change((homes) => {
        const parsed = savedHome(given)
        if (homes.some((one) => one.id === parsed.id)) return { homes, result: undefined }
        const at = Math.max(0, Math.min(homes.length, Math.trunc(index)))
        return { homes: [...homes.slice(0, at), parsed, ...homes.slice(at)], result: undefined }
      }),
  }
}
