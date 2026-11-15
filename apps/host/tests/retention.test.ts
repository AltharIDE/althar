import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { pruneInstallation } from '../src/updates/retention'
import { readState, receipt, saveState, writeJSON } from '../src/updates/store'
import { updateFixture } from './updateFixture'

describe('bounded updater retention', () => {
  it('retains a pending recovery snapshot and removes only abandoned staging directories', async () => {
    const at = await updateFixture()
    const id = 'f'.repeat(32)
    await saveState(at.root, {
      ...(await readState(at.root)),
      transaction: {
        id,
        from: at.oldId,
        to: at.nextId,
        phase: 'recovery-required',
        compatible: false,
        recoverable: false,
        controller: { pid: 0, boot: '', started: '' },
      },
    })
    const snapshot = join(at.root, 'snapshots', `${id}.sqlite`)
    writeFileSync(snapshot, 'pending recovery')
    utimesSync(snapshot, 0, 0)
    for (let i = 0; i < 5; i++) writeFileSync(join(at.root, 'snapshots', `${i.toString(16).padStart(32, '0')}.sqlite`), 'history')
    const staging = join(at.root, `.staging-${id}`)
    mkdirSync(staging)
    mkdirSync(join(at.root, 'operator-notes'))
    await pruneInstallation(at.root)
    expect(existsSync(snapshot)).toBe(true)
    expect(readdirSync(join(at.root, 'snapshots'))).toHaveLength(4)
    expect(existsSync(staging)).toBe(false)
    expect(existsSync(join(at.root, 'operator-notes'))).toBe(true)
  })
  it('keeps active, trusted, quarantined, staged and interrupted request references while bounding historical data', async () => {
    const at = await updateFixture()
    const ids = Array.from({ length: 8 }, (_, i) => (i + 16).toString(16).padStart(64, '0'))
    for (const [i, id] of ids.entries()) {
      const directory = join(at.root, 'releases', id)
      mkdirSync(directory)
      writeFileSync(join(at.root, 'records', `${id}.json`), '{}')
      utimesSync(directory, i, i)
    }
    await saveState(at.root, { ...(await readState(at.root)), failed: ids[0], seen: ids[1] })
    const intent = 'e'.repeat(32)
    await receipt(at.root, { id: intent, state: 'checking', release: ids[2] })
    await writeJSON(join(at.root, 'requests', `${intent}.json`), {
      id: intent,
      apply: true,
      allowIncompatible: false,
      createdAt: '2026-11-15T12:00:00Z',
    })
    for (let i = 0; i < 105; i++) {
      const id = i.toString(16).padStart(32, '0')
      writeFileSync(join(at.root, 'receipts', `${id}.json`), '{}')
    }
    for (let i = 0; i < 6; i++) writeFileSync(join(at.root, 'snapshots', `${i.toString(16).padStart(32, '0')}.sqlite`), 'snapshot')
    await pruneInstallation(at.root)
    const releases = readdirSync(join(at.root, 'releases'))
    expect(releases).toContain(at.oldId)
    expect(releases).toContain(at.nextId)
    for (const id of ids.slice(0, 3)) expect(releases).toContain(id)
    expect(releases).toHaveLength(8)
    expect(existsSync(join(at.root, 'records', `${ids[3]}.json`))).toBe(false)
    expect(readdirSync(join(at.root, 'snapshots'))).toHaveLength(3)
    expect(readdirSync(join(at.root, 'receipts'))).toHaveLength(101)
    expect(existsSync(join(at.root, 'requests', `${intent}.json`))).toBe(true)
    expect(at.notes()).toEqual(['before update'])
  })
})
