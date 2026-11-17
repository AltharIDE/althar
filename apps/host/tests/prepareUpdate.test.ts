import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Agents } from '@althar/runtime'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { initializeHome } from '../src/home'
import { parseOptions } from '../src/options'
import { assertManagedProgram, prepareCandidate } from '../src/updates/prepare'
import { reserveDatabase } from '../src/updates/reservation'
import { loadInstallation, readState, saveState, writeJSON, type Transaction } from '../src/updates/store'
import { updateFixture } from './updateFixture'

describe('candidate storage-only preparation', () => {
  it('opens reserved real storage, validates the existing home and vault, and never starts the runtime or API', async () => {
    const at = await updateFixture()
    rmSync(at.database)
    const options = parseOptions(
      [
        'init',
        '--profile',
        at.profile,
        '--worktrees',
        at.worktrees,
        '--key-file',
        join(at.directory, 'keys/master'),
        '--installation',
        at.root,
      ],
      {},
      at.directory,
    )
    const dependencies = {
      agents: Layer.succeed(Agents, Agents.from([])),
      agentConfigs: { homeDir: at.directory, folder: join(at.directory, 'agent-sync') },
    }
    const home = await Effect.runPromise(initializeHome(options, dependencies))
    await writeJSON(join(at.root, 'updates.json'), { ...at.config, homeId: home.homeId })
    const transaction: Transaction = {
      id: '1'.repeat(32),
      from: at.oldId,
      to: at.nextId,
      phase: 'migrating',
      compatible: true,
      recoverable: true,
      controller: { pid: 0, boot: 'past', started: '0' },
    }
    await saveState(at.root, { ...(await readState(at.root)), transaction })
    await reserveDatabase(await loadInstallation(at.root), transaction)
    const entry = join(at.root, 'releases', at.nextId, 'dist/althar-host.js')
    const prepared = await Effect.runPromise(prepareCandidate(options, entry, at.nextInfo))
    expect(prepared).toEqual({ homeId: home.homeId })
    expect(existsSync(join(at.profile, 'api/endpoint.json'))).toBe(false)
    const refused = await Effect.runPromise(Effect.flip(initializeHome(options, dependencies)))
    expect(refused).toMatchObject({ _tag: 'DatabaseInMaintenance' })
    await writeJSON(join(at.root, 'updates.json'), at.config)
    expect(await Effect.runPromise(Effect.flip(prepareCandidate(options, entry, at.nextInfo)))).toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
    rmSync(join(at.profile, 'host-vault.json'))
    expect(await Effect.runPromise(Effect.flip(prepareCandidate(options, entry, at.nextInfo)))).toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
    writeFileSync(join(at.profile, 'host-vault.json'), '{}', { mode: 0o600 })
    expect(await Effect.runPromise(Effect.flip(prepareCandidate(options, entry, at.nextInfo)))).toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
  })

  it('refuses unselected executables, changed compatibility and unauthorized transaction phases', async () => {
    const at = await updateFixture()
    const selected = join(at.root, 'releases', at.oldId, 'dist/althar-host.js')
    await assertManagedProgram(at.root, selected, at.oldInfo, 'serve')
    await expect(assertManagedProgram(at.root, selected, at.nextInfo, 'serve')).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
    await expect(assertManagedProgram(at.root, selected, at.oldInfo, 'prepare')).rejects.toMatchObject({ code: 'UpdateBusy' })
    await expect(assertManagedProgram(at.root, selected, { ...at.oldInfo, storage: 'c'.repeat(64) }, 'serve')).rejects.toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
    const transaction: Transaction = {
      id: '1'.repeat(32),
      from: at.oldId,
      to: at.nextId,
      phase: 'stopped',
      compatible: true,
      recoverable: true,
      controller: { pid: 0, boot: '', started: '' },
    }
    await saveState(at.root, { ...(await readState(at.root)), transaction })
    await expect(assertManagedProgram(at.root, selected, at.oldInfo, 'serve')).rejects.toMatchObject({ code: 'UpdateBusy' })
    await saveState(at.root, { ...(await readState(at.root)), transaction: { ...transaction, phase: 'recovery-required' } })
    await expect(assertManagedProgram(at.root, selected, at.oldInfo, 'serve')).rejects.toMatchObject({ code: 'UpdateRecoveryRequired' })
  })
})
