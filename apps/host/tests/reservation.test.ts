import { existsSync, linkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyStaged, commitReadyRelease, recoverBeforeStart } from '../src/updates/controller'
import { assertReservation, databasePermit, releaseReservation, reserveDatabase } from '../src/updates/reservation'
import { loadInstallation, readState, saveState, snapshotDatabase, type Transaction } from '../src/updates/store'
import { HOME_ID, updateFixture } from './updateFixture'

const transactionFor = async (root: string, phase: Transaction['phase']): Promise<Transaction> => {
  const state = await readState(root)
  if (state.staged === undefined) throw new Error('No fixture candidate')
  return {
    id: '1'.repeat(32),
    from: state.current,
    to: state.staged,
    phase,
    compatible: true,
    recoverable: true,
    controller: { pid: 0, boot: 'past', started: '0' },
  }
}
describe('database update reservation', () => {
  it('hands a permit only to its own installation and releases only its own transaction', async () => {
    const at = await updateFixture()
    const installation = await loadInstallation(at.root)
    const transaction = await transactionFor(at.root, 'prepared')
    expect(await databasePermit(installation)).toBeUndefined()
    await reserveDatabase(installation, transaction)
    await assertReservation(installation, transaction)
    expect(await databasePermit(installation)).toBe(transaction.id)
    await expect(releaseReservation(installation, '2'.repeat(32))).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await releaseReservation(installation, transaction.id)
    await releaseReservation(installation, transaction.id)
    await expect(assertReservation(installation, transaction)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await saveState(at.root, { ...installation.state, transaction })
    await expect(databasePermit(await loadInstallation(at.root))).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
  })

  it('refuses linked databases and foreign or corrupt reservations before stopping any service', async () => {
    const at = await updateFixture()
    const installation = await loadInstallation(at.root)
    const transaction = await transactionFor(at.root, 'prepared')
    linkSync(at.database, join(at.profile, 'alias.sqlite'))
    await expect(reserveDatabase(installation, transaction)).rejects.toMatchObject({ code: 'UpdateFailed' })
    rmSync(join(at.profile, 'alias.sqlite'))
    const marker = join(at.profile, 'althar.sqlite.maintenance')
    writeFileSync(marker, JSON.stringify({ format: 1, token: transaction.id, owner: '/another-installation' }), { mode: 0o600 })
    await expect(reserveDatabase(installation, transaction)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(databasePermit(installation)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(releaseReservation(installation)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    writeFileSync(marker, 'corrupt')
    await expect(applyStaged(at.root, false, at.dependencies)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    expect(at.calls).toEqual([])
  })

  it('never restores a snapshot when the stopped transaction has lost its database reservation', async () => {
    const at = await updateFixture()
    const transaction = await transactionFor(at.root, 'migrating')
    await snapshotDatabase(await loadInstallation(at.root), transaction.id)
    at.append('a different writer retained this')
    await saveState(at.root, { ...(await readState(at.root)), transaction })
    await expect(recoverBeforeStart(at.root, at.dependencies)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    expect(at.notes()).toEqual(['before update', 'a different writer retained this'])
    expect((await readState(at.root)).transaction?.phase).toBe('recovery-required')
  })

  it('does not revert incompatible recovery when a corrected release also fails preparation', async () => {
    const at = await updateFixture({ storage: 'c'.repeat(64) })
    at.failStartup(true)
    await expect(applyStaged(at.root, true, at.dependencies)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    at.failPreparation()
    await expect(applyStaged(at.root, true, at.dependencies)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    expect(at.notes()).toEqual(['before update', 'after candidate started'])
    expect(at.calls).not.toContain(`start:${at.oldId}`)
    expect(existsSync(join(at.profile, 'althar.sqlite.maintenance'))).toBe(true)
    await expect(commitReadyRelease(at.root, 'home_wrong', at.nextInfo)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(commitReadyRelease(at.root, HOME_ID, at.nextInfo)).rejects.toMatchObject({ code: 'UpdateBusy' })
  })
})
