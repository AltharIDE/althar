import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'

import { Effect, Fiber, Layer } from 'effect'
import { Agents } from '@althar/runtime'
import { until } from '@althar/testing/effect'
import { existsSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { initializeHome } from '../src/home'
import { reserveDatabase } from '../src/updates/reservation'
import { recoverBeforeStart, runUpdateQueue } from '../src/updates/controller'
import { loadInstallation, processStamp, readState, saveState, writeJSON, type Transaction } from '../src/updates/store'
import { fixtureFiles, updateFixture, NEXT_VERSION } from './updateFixture'

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
  it('produces signed release output through the operator command and redacts unexpected packaging failures', async () => {
    const at = await updateFixture()
    const { io, output } = ioFor(at.root)
    const options = parseOptions(
      [
        'package-release',
        '--release-base-url',
        'https://updates.example/host/',
        '--release-sequence',
        '3',
        '--output',
        join(at.directory, 'published'),
        '--json',
      ],
      {},
      at.directory,
    )
    const commands = {
      ...io,
      releaseSigningKey: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      updates: {
        source: { entry: io.entry, node: io.node, version: at.oldInfo.version },
        assemble: async (_: unknown, folder: string) => {
          fixtureFiles(folder)
        },
        execute: async () => JSON.stringify(at.oldInfo),
      },
    }
    await Effect.runPromise(runCommand(options, commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ version: at.oldInfo.version, archive: expect.stringContaining('.tar.gz') })
    const failed = await Effect.runPromise(
      Effect.flip(
        runCommand(
          { ...options, releaseOutput: join(at.directory, 'failed') },
          {
            ...commands,
            updates: {
              ...commands.updates,
              assemble: async () => {
                throw new Error('private material')
              },
            },
          },
        ),
      ),
    )
    expect(failed).toMatchObject({ code: 'UpdateFailed' })
    expect(String(failed)).not.toContain('private material')
  })
  it('configures a real home and repairs a leftover committed reservation on managed service startup', async () => {
    const at = await updateFixture()
    rmSync(at.database)
    const args = [
      '--profile',
      at.profile,
      '--worktrees',
      at.worktrees,
      '--key-file',
      join(at.directory, 'keys/master'),
      '--installation',
      at.root,
      '--service-name',
      at.config.serviceName,
    ]
    const env = { XDG_CONFIG_HOME: join(at.directory, 'config') }
    const parse = (command: string[]) =>
      parseOptions(
        [
          ...command,
          ...args.slice(0, -2),
          ...(['configure-updates', 'install-service'].includes(command[0] ?? '') ? ['--service-name', at.config.serviceName] : []),
        ],
        env,
        at.directory,
      )
    const dependencies = {
      agents: Layer.succeed(Agents, Agents.from([])),
      agentConfigs: { homeDir: at.directory, folder: join(at.directory, 'agent-sync') },
    }
    const home = await Effect.runPromise(initializeHome(parse(['init']), dependencies))
    await writeJSON(join(at.root, 'updates.json'), { ...at.config, homeId: home.homeId })
    const { io, output } = ioFor(at.root)
    const commands = {
      ...io,
      entry: join(at.root, 'releases', at.oldId, 'dist/althar-host.js'),
      run: async () => undefined,
      updates: at.dependencies,
    }
    await Effect.runPromise(runCommand(parse(['configure-updates']), commands, dependencies))
    expect(output.join('')).toContain('explicit apply')
    await Effect.runPromise(runCommand(parse(['install-service']), commands, dependencies))
    expect(
      await Effect.runPromise(
        Effect.flip(runCommand({ ...parse(['install-service']), serviceName: 'another-service' }, commands, dependencies)),
      ),
    ).toMatchObject({ code: 'UpdateFailed' })
    const preparation = {
      id: '2'.repeat(32),
      from: at.oldId,
      to: at.oldId,
      phase: 'migrating' as const,
      compatible: true,
      recoverable: true,
      controller: { pid: 0, boot: '', started: '' },
    }
    const settled = await readState(at.root)
    await saveState(at.root, { ...settled, transaction: preparation })
    await reserveDatabase(await loadInstallation(at.root), preparation)
    await Effect.runPromise(runCommand(parse(['prepare-update', '--json']), commands, dependencies))
    expect(JSON.parse(output.pop() ?? '')).toEqual({ homeId: home.homeId })
    expect(
      await Effect.runPromise(
        Effect.flip(runCommand(parse(['prepare-update']), { ...commands, entry: join(at.directory, 'missing-entry') }, dependencies)),
      ),
    ).toMatchObject({ code: 'UpdateFailed' })
    await saveState(at.root, settled)
    // A crash after healthy-state commit can leave this marker behind; only
    // the selected managed executable can open storage and clear it after ready.
    await reserveDatabase(await loadInstallation(at.root), {
      id: '1'.repeat(32),
      from: at.oldId,
      to: at.oldId,
      phase: 'starting',
      compatible: true,
      recoverable: true,
      controller: { pid: 0, boot: '', started: '' },
    })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Effect.forkScoped(runCommand(parse(['serve', '--json']), commands, dependencies))
          yield* until(
            Effect.sync(() => output.some((line) => line.includes('"state":"ready"'))),
            Boolean,
          )
          expect(existsSync(join(at.profile, 'althar.sqlite.maintenance'))).toBe(false)
          yield* Fiber.interrupt(service)
        }),
      ),
    )
  })
  it('queues/stages/applies explicitly and exposes durable results as JSON', async () => {
    const at = await updateFixture()
    const { io, output } = ioFor(at.root)
    const services = { ...at.services, kick: async () => runUpdateQueue(at.root, at.dependencies) }
    const commands = { ...io, updates: { ...at.dependencies, services } }
    const parse = (args: string[]) => parseOptions([...args, '--installation', at.root, '--json'], {}, at.directory)
    await Effect.runPromise(runCommand(parse(['update', '--wait']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ state: 'staged', version: NEXT_VERSION })
    expect(at.calls).toEqual([])
    await Effect.runPromise(runCommand(parse(['update', '--apply', '--wait']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ state: 'applied', version: NEXT_VERSION })
    await Effect.runPromise(runCommand(parse(['update-status']), commands))
    expect(JSON.parse(output.pop() ?? '')).toMatchObject({ version: NEXT_VERSION, automatic: 'manual', lastResult: { state: 'applied' } })
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
    // With the worker it carries, or an empty one as none: still the signer it lacks.
    for (const workerBinary of ['', join(at.root, 'althar-worker')])
      expect(await Effect.runPromise(Effect.flip(runCommand(parse(['package-release']), { ...commands, workerBinary })))).toMatchObject({
        code: 'UpdateNotConfigured',
      })
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
    expect(await Effect.runPromise(Effect.flip(runCommand(parse(['recover-locked', '--controller-pid', '2147483647']), io)))).toMatchObject(
      { code: 'UpdateFailed' },
    )
    const { transaction: _, ...settled } = await readState(at.root)
    await saveState(at.root, settled)
    const unavailableLock = {
      ...io,
      updates: {
        ...at.dependencies,
        execute: async () => {
          await saveState(at.root, { ...settled, transaction: { ...transaction, controller: { pid: 0, boot: '', started: '' } } })
          return ''
        },
      },
    }
    expect(await Effect.runPromise(Effect.flip(runCommand(parse(['recover-update']), unavailableLock)))).toMatchObject({
      code: 'UpdateRecoveryRequired',
    })
  })
})
