import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { Database } from '@althar/persistence-sqlite'
import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { configuredHome } from '../configuration'
import type { HostOptions } from '../options'
import { readPrivate } from '../privateFiles'
import { VaultMetadata } from '../vault'
import { type ReleaseInfo } from './info'
import { compatible, loadInstallation, readRelease, updateError } from './store'
import { databasePermit } from './reservation'

export const assertManagedProgram = async (root: string, entry: string, info: ReleaseInfo, purpose: 'serve' | 'prepare') => {
  const installation = await loadInstallation(root)
  const transaction = installation.state.transaction
  if (transaction?.phase === 'recovery-required')
    throw updateError(
      'UpdateRecoveryRequired',
      'The managed home requires update recovery. Install a corrected release before starting it.',
    )
  if (purpose === 'prepare' ? transaction?.phase !== 'migrating' : transaction !== undefined && transaction.phase !== 'starting')
    throw updateError('UpdateBusy', 'The update journal has not authorized this program to open the home.')
  const release = await readRelease(installation, purpose === 'prepare' ? (transaction?.to ?? '') : installation.state.active)
  if (
    (await fs.realpath(entry)) !== (await fs.realpath(join(release.folder, 'dist/althar-host.js'))) ||
    release.info.version !== info.version ||
    !compatible(release.info, info)
  )
    throw updateError('UpdateRecoveryRequired', 'Start this home through its managed service and selected release.')
  return installation
}

/** Migrates only storage. No runtime, agents, connector work or API is started during this recoverable phase. */
export const prepareCandidate = (options: HostOptions, entry: string, info: ReleaseInfo) =>
  Effect.scoped(
    Effect.gen(function* () {
      const installation = yield* Effect.tryPromise({
        try: () => assertManagedProgram(options.updateRoot, entry, info, 'prepare'),
        catch: (error) => (error instanceof Error ? error : updateError('UpdateFailed', 'The candidate could not be validated.')),
      })
      const configured = yield* configuredHome({
        ...options,
        profile: installation.config.profile,
        worktrees: installation.config.worktrees,
        worktreesExplicit: true,
      })
      yield* Effect.tryPromise({
        try: async () => {
          const metadata = await readPrivate(join(configured.profile, 'host-vault.json'), 4096)
          if (metadata === null) throw updateError('UpdateRecoveryRequired', 'The existing vault metadata is missing.')
          Schema.decodeUnknownSync(VaultMetadata)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)))
        },
        catch: () =>
          updateError('UpdateRecoveryRequired', 'The existing host vault format is invalid or unsupported; it will not be replaced.'),
      })
      const maintenanceToken = yield* Effect.tryPromise({
        try: () => databasePermit(installation),
        catch: () => updateError('UpdateRecoveryRequired', 'The candidate does not own the database update reservation.'),
      })
      const context = yield* Layer.build(
        Database.layer({
          filename: join(configured.profile, 'althar.sqlite'),
          backups: join(configured.profile, 'backups'),
          ...(maintenanceToken === undefined ? {} : { maintenanceToken }),
        }),
      )
      const sql = Context.get(context, SqlClient.SqlClient)
      const [home] = yield* sql<{ id: string }>`SELECT id FROM runtime_homes WHERE singleton = 1`
      if (home?.id !== installation.config.homeId)
        return yield* updateError('UpdateRecoveryRequired', 'The migrated database is not the expected home.')
      return { homeId: home.id }
    }),
  )
