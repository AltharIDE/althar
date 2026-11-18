import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Agents } from '@althar/runtime'
import { until } from '@althar/testing/effect'
import { Effect, Fiber, Layer } from 'effect'

import { workerCertificates } from '../../../packages/worker-protocol/integration/worker-certificates'
import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { temporary } from './support'

it.live('provisions a scoped listener and durable worker enrollment through local operator commands', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = temporary()
      const certificates = workerCertificates(root)
      const profile = join(root, 'profile')
      const args = ['--profile', profile, '--key-file', join(root, 'keys/master')]
      const output: string[] = []
      const io = { out: (line: string) => output.push(line), node: process.execPath, entry: '/unused.js', path: '/usr/bin' }
      const dependencies = {
        agents: Layer.succeed(Agents, Agents.from([])),
        agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
      }
      const command = (...tokens: string[]) => runCommand(parseOptions([...tokens, ...args], {}, root), io, dependencies)
      const last = () => JSON.parse(output.at(-1) ?? '{}') as Record<string, string>
      yield* command('init', '--json')
      const credentials = ['--worker-ca', certificates('home-ca.pem'), '--tls-certificate', certificates('home.pem')]
      const wrongKey = yield* Effect.flip(command('configure-workers', ...credentials, '--tls-key', certificates('enrolled.key')))
      assert.strictEqual(wrongKey._tag, 'HostError')
      const invalidAuthority = yield* Effect.flip(
        command(
          'configure-workers',
          '--worker-ca',
          certificates('enrolled.pem'),
          '--tls-certificate',
          certificates('home.pem'),
          '--tls-key',
          certificates('home.key'),
        ),
      )
      assert.strictEqual(invalidAuthority._tag, 'HostError')
      yield* command('configure-workers', ...credentials, '--tls-key', certificates('home.key'), '--listen-port', '0')
      const invalidEnrollment = yield* Effect.flip(command('enroll-worker', '--worker-certificate', certificates('home-ca.pem')))
      assert.strictEqual(invalidEnrollment._tag, 'HostError')
      yield* command('enroll-worker', '--worker-certificate', certificates('enrolled.pem'), '--json')
      const workerId = last().workerId ?? ''

      const start = () => Effect.forkScoped(command('serve', '--json'))
      const listener = yield* start()
      yield* until(
        Effect.sync(() => output.some((line) => line.includes('"workerPort":'))),
        Boolean,
      )
      yield* command('worker-run', '--worker-id', workerId, '--json')
      const attemptId = last().attemptId ?? ''
      yield* command('worker-result', '--attempt-id', attemptId)
      assert.include(output.at(-1) ?? '', 'queued')
      yield* command('revoke-worker', '--worker-id', workerId)
      yield* command('worker-result', '--attempt-id', attemptId)
      assert.include(output.at(-1) ?? '', 'unknown')
      yield* Fiber.interrupt(listener)
      yield* command('disable-workers')
      output.length = 0
      const disabled = yield* start()
      yield* until(
        Effect.sync(() => output.some((line) => line.includes('"state":"ready"'))),
        Boolean,
      )
      assert.notInclude(output.join(''), 'workerPort')
      yield* Fiber.interrupt(disabled)

      writeFileSync(join(profile, 'workers.json'), 'invalid configuration', { mode: 0o600 })
      const malformed = yield* Effect.flip(command('serve'))
      assert.strictEqual(malformed._tag, 'HostError')
    }),
  ),
)
