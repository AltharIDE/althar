import { assert, describe, it } from '@effect/vitest'
import { join } from 'node:path'

import { Cause, Effect, Fiber, Layer } from 'effect'
import { Agents } from '@althar/runtime'
import { until } from '@althar/testing/effect'

import { clearServiceEnvironment, failureMessage, runCommand } from '../src/commands'
import { HostError } from '../src/errors'
import { HOST_VERSION } from '../src/home'
import { parseOptions } from '../src/options'
import { temporary } from './support'

describe('host command execution', () => {
  it.live('prints help and version without opening a profile and reports unsupported service platforms', () =>
    Effect.gen(function* () {
      const output: string[] = []
      const io = {
        out: (text: string) => {
          output.push(text)
        },
        node: '/usr/bin/node',
        entry: '/opt/host.js',
        path: '/usr/bin',
        platform: 'win32' as const,
      }
      yield* runCommand(parseOptions(['--help'], {}, '/unused'), io)
      assert.include(output.join(''), 'Usage: althar-host')
      output.length = 0
      yield* runCommand(parseOptions(['--version'], {}, '/unused'), io)
      assert.strictEqual(output.join(''), `${HOST_VERSION}\n`)
      const error = yield* Effect.flip(runCommand(parseOptions(['serve'], {}, '/unused'), io))
      assert.strictEqual(error._tag, 'HostError')
    }),
  )

  it('keeps service credentials and supervisor controls out of child-process inheritance', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/bin',
      CREDENTIALS_DIRECTORY: '/private/credentials',
      NOTIFY_SOCKET: '/run/notify',
      WATCHDOG_USEC: '100',
      WATCHDOG_PID: '123',
      ALTHAR_HOST_RELEASE_SIGNING_KEY: 'secret signing material',
      ALTHAR_HOST_UPDATE_LOCKED: '/program',
    }
    assert.strictEqual(clearServiceEnvironment(env).notifySocket, '/run/notify')
    assert.deepStrictEqual(env, { PATH: '/bin' })
  })

  it('reports actionable failures without exposing unknown exception data', () => {
    assert.strictEqual(failureMessage(Cause.fail(new HostError({ code: 'WrongKey', message: 'Restore the original key.' }))).exitCode, 78)
    assert.strictEqual(failureMessage(Cause.fail(new HostError({ code: 'InvalidConfig', message: 'Read the help.' }))).exitCode, 64)
    assert.strictEqual(failureMessage(Cause.fail({ _tag: 'DatabaseInUse' })).exitCode, 75)
    assert.strictEqual(failureMessage(Cause.fail({ _tag: 'MigrationFailed' })).exitCode, 78)
    assert.strictEqual(failureMessage(Cause.fail({ _tag: 'DatabaseInMaintenance' })).exitCode, 75)
    assert.strictEqual(failureMessage(Cause.fail({ _tag: 'DatabaseSchemaTooNew' })).exitCode, 78)
    assert.strictEqual(failureMessage(Cause.fail(new HostError({ code: 'HostUnavailable', message: 'Unavailable.' }))).exitCode, 75)
    assert.notInclude(failureMessage(Cause.die(new Error('private token goes here'))).message, 'private token')
  })

  it.live('runs provisioning, supervisor readiness, status and managed service installation through the same command interface', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = temporary()
        const args = ['--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master')]
        const env = { XDG_CONFIG_HOME: join(root, 'config') }
        const output: string[] = []
        const calls: Array<{ command: string; args: ReadonlyArray<string>; notify: string | undefined }> = []
        const io = {
          out: (text: string) => {
            output.push(text)
          },
          node: '/usr/bin/node',
          entry: '/opt/host.js',
          path: '/bin',
          notifySocket: '/run/private-notify',
          run: async (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) => {
            calls.push({ command, args, notify: env?.NOTIFY_SOCKET })
          },
        }
        const dependencies = {
          agents: Layer.succeed(Agents, Agents.from([])),
          agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
        }
        yield* runCommand(parseOptions(['init', ...args], env, root), io, dependencies)
        assert.include(output.join(''), 'Home initialized:')
        output.length = 0
        const host = yield* Effect.forkScoped(runCommand(parseOptions(['serve', ...args, '--json'], env, root), io, dependencies))
        yield* until(
          Effect.sync(() => output.some((line) => line.includes('"state":"ready"'))),
          Boolean,
        )
        assert.deepStrictEqual(calls[0], {
          command: 'systemd-notify',
          args: ['--ready', `--pid=${process.pid}`],
          notify: '/run/private-notify',
        })
        yield* runCommand(parseOptions(['status', ...args], env, root), io, dependencies)
        assert.include(output.join(''), 'Home ready:')
        yield* Fiber.interrupt(host)
        yield* runCommand(parseOptions(['install-service', ...args], env, root), io, dependencies)
        assert.include(output.join(''), 'Start with systemctl --user')
        yield* runCommand(parseOptions(['install-service', ...args, '--start', '--json'], env, root), io, dependencies)
        assert.include(output.join(''), '"started":true')
      }),
    ),
  )
})
