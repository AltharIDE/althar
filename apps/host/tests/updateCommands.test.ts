import { join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { recoverBeforeStart, runUpdateQueue } from '../src/updates/controller'
import { loadInstallation, processStamp, readState, saveState, type Transaction } from '../src/updates/store'
import { updateFixture } from './updateFixture'

const ioFor = (root: string) => {
  const output: string[] = []
  return {
    output,
    io: {
      out: (text: string) => {
        output.push(text)
      },
      node: process.execPath,
      entry: join(root, 'entry.js'),
      path: '/usr/bin:/bin',
    },
  }
}
describe('operator update commands', () => {
  it('queues/stages/applies explicitly and exposes durable results as JSON', async () => {
    const at = await updateFixture()
    const { io, output } = ioFor(at.root)
    const services = { ...at.services, kick: async () => runUpdateQueue(at.root, at.dependencies) }
    const commands = { ...io, updates: { ...at.dependencies, services } }
    const parse = (args: string[]) => parseOptions([...args, '--installation', at.root, '--json'], {}, at.directory)
    await Effect.runPromise(runCommand(parse(['update', '--wait']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ state: 'staged', version: '0.1.1' })
    expect(at.calls).toEqual([])
    await Effect.runPromise(runCommand(parse(['update', '--apply', '--wait']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ state: 'applied', version: '0.1.1' })
    await Effect.runPromise(runCommand(parse(['update-status']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ version: '0.1.1', automatic: 'manual', lastResult: { state: 'applied' } })
    await Effect.runPromise(runCommand(parse(['update']), { ...commands, updates: { ...at.dependencies, services: at.services } }))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ state: 'queued' })
  })

  it('reports refusals and rejects running the queue outside its service lock', async () => {
    const at = await updateFixture({ apiVersion: 2 })
    const { io } = ioFor(at.root)
    const parse = (args: string[]) => parseOptions([...args, '--installation', at.root], {}, at.directory)
    const services = { ...at.services, kick: async () => runUpdateQueue(at.root, at.dependencies) }
    const commands = { ...io, updates: { ...at.dependencies, services } }
    const refused = await Effect.runPromise(Effect.flip(runCommand(parse(['update', '--apply', '--wait']), commands)))
    expect(refused).toMatchObject({ code: 'UpdateFailed' })
    const unlocked = await Effect.runPromise(Effect.flip(runCommand(parse(['update-worker']), commands)))
    expect(unlocked).toMatchObject({ code: 'UpdateBusy' })
    await Effect.runPromise(runCommand(parse(['update-worker']), { ...commands, updateLocked: at.root }))
    await Effect.runPromise(runCommand(parse(['release-info']), commands))
    const missingSigner = await Effect.runPromise(Effect.flip(runCommand(parse(['package-release']), commands)))
    expect(missingSigner).toMatchObject({ code: 'UpdateNotConfigured' })
  })

  it('recovers startup under the lock, defers to live preparation and fails closed on incompatible recovery', async () => {
    const at = await updateFixture()
    const { io } = ioFor(at.root)
    const parse = (args: string[]) => parseOptions([...args, '--installation', at.root], {}, at.directory)
    const execute = async (_program: string, args: ReadonlyArray<string>) => {
      expect(args).toContain('--nonblock')
      await recoverBeforeStart(at.root, at.dependencies)
      return ''
    }
    await Effect.runPromise(runCommand(parse(['recover-update']), { ...io, updates: { ...at.dependencies, execute } }))
    await Effect.runPromise(
      runCommand(parse(['recover-locked', '--controller-pid', String(process.pid)]), { ...io, updates: at.dependencies }),
    )
    const controller = await processStamp(process.pid)
    if (controller === null) throw new Error('Missing controller')
    const installation = await loadInstallation(at.root)
    const transaction: Transaction = {
      id: '1'.repeat(32),
      from: at.oldId,
      to: at.nextId,
      phase: 'prepared',
      compatible: true,
      recoverable: true,
      controller,
    }
    await saveState(at.root, { ...installation.state, transaction })
    expect(await Effect.runPromise(Effect.flip(runCommand(parse(['recover-update']), io)))).toMatchObject({ code: 'UpdateBusy' })
    await saveState(at.root, { ...(await readState(at.root)), transaction: { ...transaction, phase: 'starting' } })
    await Effect.runPromise(runCommand(parse(['recover-update']), io))
    await saveState(at.root, { ...(await readState(at.root)), transaction: { ...transaction, phase: 'recovery-required' } })
    expect(await Effect.runPromise(Effect.flip(runCommand(parse(['recover-update']), io)))).toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
  })
})
