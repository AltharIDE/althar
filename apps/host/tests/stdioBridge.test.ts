import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'

import { Agents } from '@althar/runtime'
import { apiClient, receiveBridgeIdentity, streamPort } from '@althar/transport-node'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect'

import { initializeHome, serveHome, type HomeReady } from '../src/home'
import { parseOptions } from '../src/options'
import { serveStdio } from '../src/stdioBridge'
import { hostStatus } from '../src/status'
import { runCommand } from '../src/commands'
import { temporary } from './support'

const fixture = () =>
  Effect.gen(function* () {
    const root = temporary()
    const options = parseOptions(['init', '--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master')], {}, root)
    const dependencies = {
      agents: Layer.succeed(Agents, Agents.from([])),
      agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
    }
    const initialized = yield* initializeHome(options, dependencies)
    const ready = yield* Deferred.make<HomeReady>()
    yield* Effect.forkScoped(serveHome(options, (info) => Effect.asVoid(Deferred.succeed(ready, info)), dependencies))
    yield* Deferred.await(ready)
    return { root, options, initialized }
  })
const bridge = (profile: string, homeId: string, apiVersion = 1) =>
  Effect.gen(function* () {
    const input = new PassThrough()
    const output = new PassThrough()
    const port = streamPort({ readable: output, writable: input })
    yield* Effect.addFinalizer(() => Effect.sync(() => port.close()))
    const options = parseOptions(
      ['connect-stdio', '--profile', profile, '--home-id', homeId, '--client-api-version', String(apiVersion)],
      {},
      profile,
    )
    const serving = yield* Effect.forkScoped(
      Effect.exit(
        runCommand(options, {
          stdio: { input, output },
          out: () => {
            throw new Error('Binary data must use only the protocol stream')
          },
          node: process.execPath,
          entry: '/unused',
          path: '/usr/bin:/bin',
        }),
      ),
    )
    return { port, serving }
  })
describe('host SSH stdio bridge', () => {
  it.live('forwards authenticated RPC with socket authority and disconnects without stopping the home', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = yield* fixture()
        const peer = yield* bridge(at.options.profile, at.initialized.homeId)
        const identity = yield* receiveBridgeIdentity(peer.port, at.initialized.homeId)
        const { api, info } = yield* apiClient({ port: peer.port, identity })
        assert.strictEqual(info.identity.role, 'socket')
        assert.strictEqual(info.identity.homeId, at.initialized.homeId)
        assert.deepStrictEqual((yield* api.ListProjects()).projects, [])
        const refused = yield* Effect.flip(api.Answer({ commandId: `cmd_${'1'.repeat(32)}`, attentionId: 'untrusted', decision: 'allow' }))
        assert.strictEqual(refused.reason, 'PersonRequired')
        peer.port.close()
        assert.isTrue(Exit.isSuccess(yield* Fiber.join(peer.serving)))
        assert.strictEqual((yield* hostStatus(at.options.profile)).state, 'ready')
      }),
    ),
  )

  it.live('refuses the wrong home, incompatible clients and an unavailable host with a bounded public rejection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = yield* fixture()
        for (const [profile, homeId, version, reason] of [
          [at.options.profile, `home_${'2'.repeat(32)}`, 1, 'HomeMismatch'],
          [at.options.profile, at.initialized.homeId, 2, 'ApiVersionMismatch'],
          [join(at.root, 'missing'), at.initialized.homeId, 1, 'UnsafeEndpoint'],
        ] as const) {
          const peer = yield* bridge(profile, homeId, version)
          const error = yield* Effect.flip(receiveBridgeIdentity(peer.port, homeId))
          assert.strictEqual(error.reason, reason)
          assert.isTrue(Exit.isFailure(yield* Fiber.join(peer.serving)))
        }
        assert.strictEqual((yield* hostStatus(at.options.profile)).state, 'ready')
      }),
    ),
  )

  it.live('does not emit binary protocol data to a terminal and requires explicit identity flags', () =>
    Effect.gen(function* () {
      const input = Object.assign(new PassThrough(), { isTTY: true })
      const output = new PassThrough()
      let wrote = false
      output.on('data', () => {
        wrote = true
      })
      const error = yield* Effect.flip(serveStdio('/unused', `home_${'1'.repeat(32)}`, 1, { input, output }))
      assert.strictEqual(error.code, 'InvalidConfig')
      assert.isFalse(wrote)
      assert.throws(() => parseOptions(['connect-stdio'], {}, '/tmp'))
      assert.throws(() =>
        parseOptions(['connect-stdio', '--home-id', `home_${'1'.repeat(32)}`, '--client-api-version', '1', '--json'], {}, '/tmp'),
      )
      assert.throws(() => parseOptions(['status', '--home-id', `home_${'1'.repeat(32)}`], {}, '/tmp'))
      assert.throws(() => parseOptions(['status', '--client-api-version', '1'], {}, '/tmp'))
      for (const version of ['invalid', '0', '-1', '1.5', '9007199254740992'])
        assert.throws(() =>
          parseOptions(['connect-stdio', '--home-id', `home_${'1'.repeat(32)}`, '--client-api-version', version], {}, '/tmp'),
        )
      input.destroy()
      output.destroy()
    }),
  )
  it.live('refuses a terminal output and handles a broken protocol writer without leaking errors', () =>
    Effect.gen(function* () {
      const input = new PassThrough()
      const terminal = Object.assign(new PassThrough(), { isTTY: true })
      assert.strictEqual(
        (yield* Effect.flip(serveStdio('/unused', `home_${'1'.repeat(32)}`, 1, { input, output: terminal }))).code,
        'InvalidConfig',
      )
      terminal.destroy()
      const output = new Writable({ write: (_bytes, _encoding, done) => done(new Error('private output failure')) })
      const failure = yield* Effect.flip(serveStdio('/unused', `home_${'1'.repeat(32)}`, 2, { input, output }))
      assert.strictEqual(failure.code, 'HostUnavailable')
      assert.notInclude(failure.message, 'private')
    }),
  )
})
