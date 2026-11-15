import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

import { Schema } from 'effect'

import { HostError } from '../errors'
import { privateDirectory, readPrivate, writePrivate } from '../privateFiles'
import { ReleaseInfo, type ReleaseInfo as Info } from './info'
import { authenticateRelease, digest, httpsURL, releaseIdentity, type VerifiedRelease } from './release'

export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const Identifier = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
const absolute = Schema.String.check(Schema.isPattern(/^\//))
export const UpdateConfig = Schema.Struct({
  format: Schema.Literal(1),
  profile: absolute,
  worktrees: absolute,
  homeId: Schema.String.check(Schema.isPattern(/^home_[a-f0-9]{32}$/)),
  serviceName: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)),
  keys: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  feed: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('github'), repository: Schema.String }),
    Schema.Struct({ kind: Schema.Literal('manifest'), url: Schema.String }),
  ]),
  automatic: Schema.Boolean,
  bootstrap: Hash,
})
export type UpdateConfig = typeof UpdateConfig.Type
export const ProcessStamp = Schema.Struct({ pid: Schema.Int, boot: Schema.String, started: Schema.String })
export type ProcessStamp = typeof ProcessStamp.Type
export const Transaction = Schema.Struct({
  id: Identifier,
  from: Hash,
  to: Hash,
  phase: Schema.Literals(['prepared', 'stopped', 'migrating', 'starting', 'recovery-required']),
  compatible: Schema.Boolean,
  recoverable: Schema.Boolean,
  controller: ProcessStamp,
})
export type Transaction = typeof Transaction.Type
export const UpdateState = Schema.Struct({
  format: Schema.Literal(1),
  current: Hash,
  active: Hash,
  staged: Schema.optional(Hash),
  failed: Schema.optional(Hash),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  seen: Schema.optional(Hash),
  transaction: Schema.optional(Transaction),
})
export type UpdateState = typeof UpdateState.Type
export const UpdateReceipt = Schema.Struct({
  id: Identifier,
  state: Schema.Literals(['checking', 'staged', 'current', 'applied', 'failed', 'recovery-required']),
  version: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  release: Schema.optional(Hash),
})
export type UpdateReceipt = typeof UpdateReceipt.Type
const UpdateCheck = Schema.Struct({
  state: Schema.Literals(['current', 'staged', 'failed']),
  at: Schema.String,
  version: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})
export const UpdateRequest = Schema.Struct({
  id: Identifier,
  apply: Schema.Boolean,
  allowIncompatible: Schema.Boolean,
  createdAt: Schema.String,
})
export type UpdateRequest = typeof UpdateRequest.Type
const Bootstrap = Schema.Struct({ kind: Schema.Literal('bootstrap'), info: ReleaseInfo, entryDigest: Hash })
const SignedRecord = Schema.Struct({ kind: Schema.Literal('signed'), envelope: Schema.String })
export interface Installation {
  readonly root: string
  readonly config: UpdateConfig
  readonly state: UpdateState
}
export interface InstalledRelease {
  readonly id: string
  readonly folder: string
  readonly info: Info
  readonly signed?: VerifiedRelease
}

export const updateError = (code: HostError['code'], message: string) => new HostError({ code, message })
const corrupt = () =>
  updateError(
    'UpdateRecoveryRequired',
    'The private update configuration or journal is invalid. Keep the service stopped and restore its update metadata before proceeding.',
  )
export const newUpdateId = () => randomBytes(16).toString('hex')
const read = async <A>(path: string, schema: Schema.Codec<A>, maximum = 131_072): Promise<A> => {
  try {
    const bytes = await readPrivate(path, maximum)
    if (bytes === null) throw corrupt()
    return Schema.decodeUnknownSync(schema)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    throw corrupt()
  }
}
export const writeJSON = (path: string, value: unknown) => writePrivate(path, JSON.stringify(value), true)
export const saveState = (root: string, state: UpdateState) => writeJSON(join(root, 'state.json'), state)
export const readState = (root: string) => read(join(root, 'state.json'), UpdateState)
export const loadInstallation = async (root: string): Promise<Installation> => {
  const canonical = await privateDirectory(root).catch((error: unknown) => {
    if (error instanceof HostError && error.code === 'NotInitialized')
      throw updateError(
        'UpdateNotConfigured',
        'Configure a managed installation with configure-updates before checking or applying releases.',
      )
    throw error
  })
  const config = await read(join(canonical, 'updates.json'), UpdateConfig)
  for (const key of config.keys) releaseIdentity(key)
  if (config.feed.kind === 'manifest') httpsURL(config.feed.url)
  else if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.feed.repository) ||
    config.feed.repository.split('/').some((part) => part === '.' || part === '..')
  )
    throw corrupt()
  if (
    canonical !== resolve(root) ||
    contains(canonical, config.profile) ||
    contains(config.profile, canonical) ||
    contains(canonical, config.worktrees) ||
    contains(config.worktrees, canonical)
  )
    throw corrupt()
  return { root: canonical, config, state: await readState(canonical) }
}
export const contains = (root: string, path: string) => {
  const part = relative(root, path)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !part.startsWith(sep))
}
export const createInstallationFolders = async (root: string) => {
  const canonical = await privateDirectory(root, true)
  for (const name of ['releases', 'records', 'snapshots', 'requests', 'receipts']) await privateDirectory(join(canonical, name), true)
  await writePrivate(join(canonical, 'update.lock'), '', false)
  return canonical
}
const releaseFolder = (root: string, id: string) => {
  try {
    Schema.decodeUnknownSync(Hash)(id)
  } catch {
    throw corrupt()
  }
  return join(root, 'releases', id)
}
export const readRelease = async (installation: Pick<Installation, 'root' | 'config'>, id: string): Promise<InstalledRelease> => {
  const folder = releaseFolder(installation.root, id)
  await privateDirectory(folder)
  const value = await read(join(installation.root, 'records', `${id}.json`), Schema.Union([Bootstrap, SignedRecord]))
  if (value.kind === 'bootstrap') {
    if (id !== installation.config.bootstrap || digest(await fs.readFile(join(folder, 'dist/althar-host.js'))) !== value.entryDigest)
      throw corrupt()
    return { id, folder, info: value.info }
  }
  const bytes = Buffer.from(value.envelope, 'base64url')
  const signed = authenticateRelease(bytes, installation.config.keys, process.arch === 'arm64' ? 'arm64' : 'x64')
  if (signed.id !== id || bytes.toString('base64url') !== value.envelope) throw corrupt()
  const manifest = signed.manifest
  return {
    id,
    folder,
    signed,
    info: {
      version: manifest.version,
      updaterProtocol: manifest.updaterProtocol,
      platform: manifest.platform,
      arch: manifest.arch,
      apiVersion: manifest.apiVersion,
      storage: manifest.storage,
    },
  }
}
export const storeBootstrap = async (root: string, id: string, info: Info) => {
  const entryDigest = digest(await fs.readFile(join(releaseFolder(root, id), 'dist/althar-host.js')))
  await writePrivate(join(root, 'records', `${id}.json`), JSON.stringify({ kind: 'bootstrap', info, entryDigest }), false)
}
export const storeSigned = (root: string, release: VerifiedRelease) =>
  writePrivate(
    join(root, 'records', `${release.id}.json`),
    JSON.stringify({ kind: 'signed', envelope: Buffer.from(release.envelope).toString('base64url') }),
    false,
  )
export const compatible = (from: Info, to: Info) => from.apiVersion === to.apiVersion && from.storage === to.storage
export const pointRelease = async (root: string, name: 'current' | 'active', id: string) => {
  releaseFolder(root, id)
  const temporary = join(root, `.${name}-${newUpdateId()}`)
  try {
    await fs.symlink(`releases/${id}`, temporary)
    await fs.rename(temporary, join(root, name))
    await syncFolder(root)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}
export const syncFolder = async (folder: string) => {
  const file = await fs.open(folder, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    await file.sync()
  } finally {
    await file.close()
  }
}
export const processStamp = async (pid: number): Promise<ProcessStamp | null> => {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
    const started = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
    if (started === undefined || !/^\d+$/.test(started)) return null
    return { pid, boot: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), started }
  } catch {
    return null
  }
}
export const controllerAlive = async (stamp: ProcessStamp) => {
  const current = await processStamp(stamp.pid)
  return current !== null && current.boot === stamp.boot && current.started === stamp.started
}
export const readHomeId = (database: string): string => {
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const row = db.prepare('SELECT id FROM runtime_homes WHERE singleton = 1').get()
    if (typeof row?.id !== 'string' || !/^home_[a-f0-9]{32}$/.test(row.id)) throw corrupt()
    return row.id
  } finally {
    db.close()
  }
}
export const snapshotDatabase = async (installation: Pick<Installation, 'root' | 'config'>, id: string) => {
  Schema.decodeUnknownSync(Identifier)(id)
  const path = join(installation.root, 'snapshots', `${id}.sqlite`)
  const db = new DatabaseSync(join(installation.config.profile, 'althar.sqlite'), { readOnly: true })
  try {
    if (readHomeId(join(installation.config.profile, 'althar.sqlite')) !== installation.config.homeId) throw corrupt()
    await backup(db, path)
  } finally {
    db.close()
  }
  await fs.chmod(path, 0o600)
  const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await file.sync()
  } finally {
    await file.close()
  }
  await syncFolder(join(installation.root, 'snapshots'))
}
/** Used only before the candidate runtime has ever started; never erase data after serving clients. */
export const restoreSnapshot = async (installation: Pick<Installation, 'root' | 'config'>, transaction: Transaction) => {
  if (!['stopped', 'migrating'].includes(transaction.phase)) throw corrupt()
  const source = join(installation.root, 'snapshots', `${transaction.id}.sqlite`)
  if (readHomeId(source) !== installation.config.homeId) throw corrupt()
  const database = join(installation.config.profile, 'althar.sqlite')
  const temporary = `${database}.${newUpdateId()}.restore`
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL)
    await fs.chmod(temporary, 0o600)
    const file = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    await fs.rename(temporary, database)
    await fs.rm(`${database}-wal`, { force: true })
    await fs.rm(`${database}-shm`, { force: true })
    await syncFolder(installation.config.profile)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}
export const receipt = async (root: string, value: UpdateReceipt) => {
  await writeJSON(join(root, 'receipts', `${Schema.decodeUnknownSync(Identifier)(value.id)}.json`), value)
  if (value.state !== 'checking') await writeJSON(join(root, 'last-result.json'), value)
}
export const readReceipt = (root: string, id: string) =>
  read(join(root, 'receipts', `${Schema.decodeUnknownSync(Identifier)(id)}.json`), UpdateReceipt)
export const readRequest = (root: string, name: string) =>
  read(join(root, 'requests', `${Schema.decodeUnknownSync(Identifier)(name)}.json`), UpdateRequest)
export const lastUpdateResults = async (root: string) => {
  const optional = async <A>(name: string, schema: Schema.Codec<A>) =>
    (await readPrivate(join(root, name), 131_072)) === null ? null : read(join(root, name), schema)
  return { lastResult: await optional('last-result.json', UpdateReceipt), lastCheck: await optional('last-check.json', UpdateCheck) }
}
