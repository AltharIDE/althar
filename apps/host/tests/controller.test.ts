import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyStaged, commitReadyRelease, recoverBeforeStart, requestUpdate, runUpdateQueue, updateStatus } from '../src/updates/controller'
import {
  loadInstallation,
  processStamp,
  readReceipt,
  readState,
  receipt,
  saveState,
  snapshotDatabase,
  writeJSON,
  type Transaction,
} from '../src/updates/store'
import { HOME_ID, NOW, updateFixture } from './updateFixture'
import { reserveDatabase } from '../src/updates/reservation'

const dead = { pid: 0, boot: 'previous boot', started: '1' }

describe('controlled host activation and recovery', () => {
  it('preserves the home and data through an explicit verified activation', async () => {
    const at = await updateFixture()
    expect(await applyStaged(at.root, false, at.dependencies)).toBe('0.1.1')
    expect(at.calls).toEqual(['stop', `start:${at.nextId}`])
    expect(at.notes()).toEqual(['before update'])
    const state = await readState(at.root)
    expect(state.current).toBe(at.nextId)
    expect(state.transaction).toBeUndefined()
    expect(state.staged).toBeUndefined()
    expect((await updateStatus(at.root)).version).toBe('0.1.1')
  })

  it('restores a failed migration before any candidate runtime has started', async () => {
    const at = await updateFixture({ storage: 'c'.repeat(64) })
    at.failPreparation()
    await expect(applyStaged(at.root, true, at.dependencies)).rejects.toThrow()
    expect(at.notes()).toEqual(['before update'])
    expect((await readState(at.root)).current).toBe(at.oldId)
    expect(at.calls).toEqual(['stop', `start:${at.oldId}`])
  })

  it('rolls compatible code back without erasing writes made after the candidate started', async () => {
    const at = await updateFixture()
    at.failStartup(true)
    await expect(applyStaged(at.root, false, at.dependencies)).rejects.toThrow()
    expect(at.notes()).toEqual(['before update', 'after candidate started'])
    const state = await readState(at.root)
    expect(state.current).toBe(at.oldId)
    expect(state.failed).toBe(at.nextId)
    expect(at.calls).toEqual(['stop', `start:${at.nextId}`, 'stop', `start:${at.oldId}`])
  })

  it('requires approval for incompatible changes and never restarts old code after a failed incompatible startup', async () => {
    const at = await updateFixture({ apiVersion: 2, storage: 'c'.repeat(64) })
    await expect(applyStaged(at.root, false, at.dependencies)).rejects.toMatchObject({ code: 'UpdateIncompatible' })
    expect(at.calls).toEqual([])
    at.failStartup(true)
    await expect(applyStaged(at.root, true, at.dependencies)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    expect(at.notes()).toEqual(['before update', 'after candidate started'])
    expect((await readState(at.root)).transaction?.phase).toBe('recovery-required')
    expect(at.calls).not.toContain(`start:${at.oldId}`)
    expect((await updateStatus(at.root)).recoveryRequired).toBe(true)
  })

  it('recovers abandoned phases and restores a snapshot only before the candidate runtime could have acted', async () => {
    for (const phase of ['prepared', 'stopped', 'migrating', 'starting'] as const) {
      const at = await updateFixture()
      const transaction: Transaction = {
        id: '1'.repeat(32),
        from: at.oldId,
        to: at.nextId,
        phase,
        compatible: true,
        recoverable: true,
        controller: dead,
      }
      await snapshotDatabase(await loadInstallation(at.root), transaction.id)
      await reserveDatabase(await loadInstallation(at.root), transaction)
      at.append('later data')
      await saveState(at.root, { ...(await readState(at.root)), active: at.nextId, transaction })
      await recoverBeforeStart(at.root, at.dependencies)
      expect((await readState(at.root)).active).toBe(at.oldId)
      expect(at.notes()).toEqual(phase === 'migrating' ? ['before update'] : ['before update', 'later data'])
    }
  })

  it('leaves a live controller in charge and refuses premature service starts', async () => {
    const at = await updateFixture()
    const controller = await processStamp(process.pid)
    if (controller === null) throw new Error('No process stamp')
    const transaction: Transaction = {
      id: '2'.repeat(32),
      from: at.oldId,
      to: at.nextId,
      phase: 'prepared',
      compatible: true,
      recoverable: true,
      controller,
    }
    await saveState(at.root, { ...(await readState(at.root)), transaction })
    await expect(recoverBeforeStart(at.root, at.dependencies)).rejects.toMatchObject({ code: 'UpdateBusy' })
    await expect(applyStaged(at.root, false, at.dependencies)).rejects.toMatchObject({ code: 'UpdateBusy' })
    await saveState(at.root, { ...(await readState(at.root)), transaction: { ...transaction, phase: 'starting' } })
    await recoverBeforeStart(at.root, at.dependencies)
    expect((await readState(at.root)).transaction?.id).toBe(transaction.id)
    await runUpdateQueue(at.root, at.dependencies)
    expect(at.calls).toEqual([])
  })

  it('optionally activates compatible releases on service startup, and skips incompatible, expired or quarantined ones', async () => {
    const at = await updateFixture()
    await writeJSON(join(at.root, 'updates.json'), { ...at.config, automatic: true })
    const owner = await processStamp(process.pid)
    if (owner === null) throw new Error('No process stamp')
    await recoverBeforeStart(at.root, at.dependencies, owner)
    expect((await readState(at.root)).transaction?.phase).toBe('starting')
    expect(at.calls).toEqual([])
    await commitReadyRelease(at.root, HOME_ID, at.nextInfo)
    expect((await readState(at.root)).current).toBe(at.nextId)
    for (const mode of ['incompatible', 'expired', 'failed'] as const) {
      const other = await updateFixture(mode === 'incompatible' ? { apiVersion: 2 } : {})
      await writeJSON(join(other.root, 'updates.json'), { ...other.config, automatic: true })
      if (mode === 'failed') await saveState(other.root, { ...(await readState(other.root)), failed: other.nextId })
      await recoverBeforeStart(other.root, { ...other.dependencies, now: () => (mode === 'expired' ? NOW + 200 * 86_400_000 : NOW) }, owner)
      expect((await readState(other.root)).transaction).toBeUndefined()
    }
  })

  it('stages by default, applies only an explicit request, and never replays a completed request', async () => {
    const at = await updateFixture()
    const staged = await requestUpdate(at.root, false, false, at.services)
    await runUpdateQueue(at.root, at.dependencies)
    expect((await readReceipt(at.root, staged)).state).toBe('staged')
    expect(at.calls).toEqual(['kick'])
    const applied = await requestUpdate(at.root, true, false, at.services)
    const intent = readFileSync(join(at.root, 'requests', `${applied}.json`))
    await runUpdateQueue(at.root, at.dependencies)
    expect((await readReceipt(at.root, applied)).state).toBe('applied')
    const count = at.calls.length
    writeFileSync(join(at.root, 'requests', `${applied}.json`), intent)
    await runUpdateQueue(at.root, at.dependencies)
    expect(at.calls).toHaveLength(count)
    expect(existsSync(join(at.root, 'requests', `${applied}.json`))).toBe(false)
  })

  it('recognizes a committed startup even if its controller died before recording the request result', async () => {
    const at = await updateFixture()
    const request = await requestUpdate(at.root, true, false, at.services)
    await receipt(at.root, { id: request, state: 'checking', release: at.nextId })
    await saveState(at.root, { format: 1, current: at.nextId, active: at.nextId, sequence: 2, seen: at.nextId })
    await runUpdateQueue(at.root, at.dependencies)
    expect((await readReceipt(at.root, request)).state).toBe('applied')
    expect(at.calls).toEqual(['kick'])
  })
})
