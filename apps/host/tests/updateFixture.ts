import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { releaseInfo, type ReleaseInfo } from '../src/updates/info'
import { digest, releaseIdentity, type ReleaseManifest } from '../src/updates/release'
import { commitReadyRelease } from '../src/updates/controller'
import { createInstallationFolders, pointRelease, readState, saveState, storeBootstrap, storeSigned, writeJSON } from '../src/updates/store'
import type { UpdateExecutor, UpdateServices } from '../src/updates/execute'
import { temporary } from './support'

export const NOW = Date.parse('2026-11-15T12:00:00Z')
export const HOME_ID = `home_${'1'.repeat(32)}`
export const fixtureFiles = (folder: string, text = 'fixture') => {
  mkdirSync(join(folder, 'node/bin'), { recursive: true, mode: 0o700 })
  mkdirSync(join(folder, 'dist'), { recursive: true, mode: 0o700 })
  writeFileSync(join(folder, 'dist/althar-host.js'), text, { mode: 0o600 })
  writeFileSync(join(folder, 'node/bin/node'), text, { mode: 0o700 })
  writeFileSync(join(folder, 'node/LICENSE'), 'Fixture license', { mode: 0o600 })
  writeFileSync(join(folder, 'package.json'), '{"type":"module"}', { mode: 0o600 })
}
export const updateFixture = async (changes: Partial<ReleaseInfo> = {}) => {
  const directory = temporary()
  const root = await createInstallationFolders(join(directory, 'program'))
  const profile = join(directory, 'profile')
  mkdirSync(profile, { mode: 0o700 })
  const worktrees = join(directory, 'worktrees')
  mkdirSync(worktrees, { mode: 0o700 })
  const database = join(profile, 'althar.sqlite')
  const db = new DatabaseSync(database)
  db.exec(
    `CREATE TABLE runtime_homes(singleton INTEGER PRIMARY KEY, id TEXT NOT NULL); INSERT INTO runtime_homes VALUES(1,'${HOME_ID}'); CREATE TABLE notes(value TEXT); INSERT INTO notes VALUES('before update')`,
  )
  db.close()
  const oldInfo = releaseInfo()
  const nextInfo: ReleaseInfo = { ...oldInfo, version: '0.1.1', ...changes }
  const oldId = 'a'.repeat(64)
  fixtureFiles(join(root, 'releases', oldId), 'initial code')
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const manifest: ReleaseManifest = {
    format: 1,
    version: nextInfo.version,
    sequence: 2,
    publishedAt: new Date(NOW - 1000).toISOString(),
    expiresAt: new Date(NOW + 180 * 86_400_000).toISOString(),
    platform: 'linux',
    arch: nextInfo.arch,
    updaterProtocol: 1,
    apiVersion: nextInfo.apiVersion,
    storage: nextInfo.storage,
    archive: { url: 'https://updates.example/release.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
    files: 4,
    unpackedBytes: 100,
  }
  const seal = (value: ReleaseManifest) => {
    const payload = Buffer.from(JSON.stringify(value))
    return Buffer.from(
      JSON.stringify({
        format: 1,
        keyId: releaseIdentity(publicKey),
        payload: payload.toString('base64url'),
        signature: sign(null, payload, pair.privateKey).toString('base64url'),
      }),
    )
  }
  const envelope = seal(manifest)
  const nextId = digest(envelope)
  const config = {
    format: 1 as const,
    profile,
    worktrees,
    homeId: HOME_ID,
    serviceName: 'fixture-home',
    keys: [publicKey],
    bootstrap: oldId,
    automatic: false,
    feed: { kind: 'manifest' as const, url: 'https://updates.example/feed' },
  }
  await storeBootstrap(root, oldId, oldInfo)
  fixtureFiles(join(root, 'releases', nextId), 'next code')
  await storeSigned(root, { id: nextId, envelope, manifest })
  await writeJSON(join(root, 'updates.json'), config)
  await saveState(root, { format: 1, current: oldId, active: oldId, staged: nextId, seen: nextId, sequence: 2 })
  await pointRelease(root, 'current', oldId)
  await pointRelease(root, 'active', oldId)
  const calls: string[] = []
  let preparationFailure = false
  let startupFailure = false
  let postStartWrite = false
  const notes = () => {
    const connection = new DatabaseSync(database)
    try {
      return connection
        .prepare('SELECT value FROM notes')
        .all()
        .map((row) => row.value)
    } finally {
      connection.close()
    }
  }
  const append = (value: string) => {
    const connection = new DatabaseSync(database)
    try {
      connection.prepare('INSERT INTO notes VALUES(?)').run(value)
    } finally {
      connection.close()
    }
  }
  const services: UpdateServices = {
    active: async () => false,
    stop: async () => {
      calls.push('stop')
    },
    start: async () => {
      const state = await readState(root)
      calls.push(`start:${state.active}`)
      if (state.active === nextId) {
        if (postStartWrite) append('after candidate started')
        if (startupFailure) throw new Error('startup failed')
        await commitReadyRelease(root, HOME_ID, nextInfo)
      }
    },
    kick: async () => {
      calls.push('kick')
    },
  }
  const execute: UpdateExecutor = async (_program, args) => {
    if (args.includes('release-info') || args.includes('verify-release')) return JSON.stringify(nextInfo)
    if (args.includes('prepare-update')) {
      if (preparationFailure) {
        append('partial migration')
        throw new Error('migration failed')
      }
      return JSON.stringify({ homeId: HOME_ID })
    }
    if (args.includes('status')) return JSON.stringify({ state: 'ready', homeId: HOME_ID, version: nextInfo.version })
    throw new Error('Unexpected fixture command')
  }
  const dependencies = { services, execute, now: () => NOW, fetch: async () => new Response(envelope) }
  return {
    directory,
    root,
    profile,
    worktrees,
    database,
    config,
    oldId,
    nextId,
    oldInfo,
    nextInfo,
    envelope,
    manifest,
    seal,
    calls,
    services,
    dependencies,
    notes,
    append,
    failPreparation: () => {
      preparationFailure = true
    },
    failStartup: (write = false) => {
      startupFailure = true
      postStartWrite = write
    },
  }
}
