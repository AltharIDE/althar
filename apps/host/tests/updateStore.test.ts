import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  controllerAlive,
  loadInstallation,
  processStamp,
  readHomeId,
  readReceipt,
  readRelease,
  readRequest,
  restoreSnapshot,
  snapshotDatabase,
  writeJSON,
} from '../src/updates/store'
import { updateFixture } from './updateFixture'

describe('private update metadata', () => {
  it('rejects corrupt configuration, substituted release records and unsafe identifiers', async () => {
    const at = await updateFixture()
    const installation = await loadInstallation(at.root)
    expect((await readRelease(installation, at.nextId)).info).toEqual(at.nextInfo)
    await expect(readRelease(installation, '../escape')).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    writeFileSync(join(at.root, 'releases', at.oldId, 'dist/althar-host.js'), 'changed bootstrap')
    await expect(readRelease(installation, at.oldId)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    writeFileSync(join(at.root, 'records', `${at.nextId}.json`), '{"kind":"signed","envelope":"invalid"}')
    await expect(readRelease(installation, at.nextId)).rejects.toThrow()
    await writeJSON(join(at.root, 'updates.json'), { ...at.config, feed: { kind: 'github', repository: '../unsafe' } })
    await expect(loadInstallation(at.root)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    writeFileSync(join(at.root, 'updates.json'), 'corrupt')
    await expect(loadInstallation(at.root)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(readReceipt(at.root, 'f'.repeat(32))).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(readRequest(at.root, 'f'.repeat(32))).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
  })

  it('pins a home before backup/restore and never restores once runtime startup is possible', async () => {
    const at = await updateFixture()
    const installation = await loadInstallation(at.root)
    const id = '1'.repeat(32)
    const transaction = {
      id,
      from: at.oldId,
      to: at.nextId,
      phase: 'starting' as const,
      compatible: true,
      recoverable: true,
      controller: { pid: 0, boot: '', started: '' },
    }
    await expect(restoreSnapshot(installation, transaction)).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(
      snapshotDatabase({ ...installation, config: { ...at.config, homeId: `home_${'2'.repeat(32)}` } }, id),
    ).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await snapshotDatabase(installation, id)
    await expect(
      restoreSnapshot(
        { ...installation, config: { ...at.config, homeId: `home_${'2'.repeat(32)}` } },
        { ...transaction, phase: 'migrating' },
      ),
    ).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    rmSync(join(at.root, 'snapshots', `${id}.sqlite`))
    expect(readHomeId(at.database)).toBe(at.config.homeId)
  })

  it('uses boot and start identity as well as PID for controller ownership', async () => {
    const stamp = await processStamp(process.pid)
    expect(stamp).not.toBeNull()
    if (stamp === null) throw new Error('Missing current process identity')
    expect(await controllerAlive(stamp)).toBe(true)
    expect(await controllerAlive({ ...stamp, boot: 'another boot' })).toBe(false)
    expect(await controllerAlive({ ...stamp, started: '0' })).toBe(false)
    expect(await processStamp(-1)).toBeNull()
  })
})
