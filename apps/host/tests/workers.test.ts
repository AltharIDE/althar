import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Agents } from '@althar/runtime'
import { until } from '@althar/testing/effect'
import { DiagnosticOutcome } from '@althar/worker-protocol'
import { Effect, Fiber, Layer } from 'effect'

import { workerCertificates } from '../../../packages/worker-protocol/integration/worker-certificates'
import { runCommand } from '../src/commands'
import { parseOptions } from '../src/options'
import { openWorkerStore } from '../src/workerStore'
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
      const last = <T = Record<string, string>>() => JSON.parse(output.at(-1) ?? '{}') as T
      const checkout = join(root, 'checkout')
      yield* Effect.sync(() => execFileSync('git', ['init', '--quiet', checkout]))
      yield* command('init', '--project', checkout, '--json')
      const {
        homeId,
        projects: [projectId],
      } = last<{ homeId: string; projects: [string] }>()
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
      const privateCopy = join(profile, 'unsafe-worker.key')
      copyFileSync(certificates('home.key'), privateCopy)
      for (const bad of [
        [...credentials, '--tls-key', privateCopy],
        [...credentials, '--tls-key', certificates('home.key'), '--listen-address', 'not-an-ip'],
        ['--worker-ca', certificates('missing.pem'), '--tls-certificate', certificates('home.pem'), '--tls-key', certificates('home.key')],
      ]) {
        const error = yield* Effect.flip(command('configure-workers', ...bad))
        assert.strictEqual(error._tag, 'HostError')
      }
      yield* command('configure-workers', ...credentials, '--tls-key', certificates('home.key'), '--listen-port', '0')
      const invalidEnrollment = yield* Effect.flip(command('enroll-worker', '--worker-certificate', certificates('home-ca.pem')))
      assert.strictEqual(invalidEnrollment._tag, 'HostError')
      yield* command('enroll-worker', '--worker-certificate', certificates('enrolled.pem'), '--json')
      const workerId = last().workerId ?? ''
      const projectRun = (id = projectId) =>
        command('worker-project-run', '--worker-id', workerId, '--project-id', id, '--command-name', 'check', '--json')
      const offline = yield* Effect.flip(projectRun())
      assert.strictEqual(offline._tag, 'HostError')
      if (offline._tag === 'HostError') assert.strictEqual(offline.code, 'HostUnavailable')

      const start = () => Effect.forkScoped(command('serve', '--json'))
      const listener = yield* start()
      yield* until(
        Effect.sync(() => output.some((line) => line.includes('"workerPort":'))),
        Boolean,
      )
      const assign = (id: string) =>
        command('enroll-worker', '--worker-certificate', certificates('enrolled.pem'), '--project-id', id, '--json')
      const unknownProject = yield* Effect.flip(assign(`proj_${'f'.repeat(32)}`))
      assert.strictEqual(unknownProject._tag, 'HostError')
      yield* assign(projectId)
      assert.deepStrictEqual(last(), { projectId, workerId })
      assert.throws(() => parseOptions(['revoke-worker', '--worker-id', workerId, '--project-id', 'invalid'], {}, root))
      yield* command('revoke-worker', '--worker-id', workerId, '--project-id', projectId, '--json')
      assert.deepStrictEqual(last<{ projectId: string; workerId: string; revoked: boolean }>(), { projectId, workerId, revoked: true })
      const revoked = yield* Effect.promise(() => openWorkerStore(profile, homeId))
      try {
        assert.isFalse(revoked.agents.permits(workerId, projectId))
      } finally {
        revoked.close()
      }
      yield* assign(projectId)
      const foreign = yield* Effect.flip(projectRun(`proj_${'f'.repeat(32)}`))
      assert.strictEqual(foreign._tag, 'HostError')
      if (foreign._tag === 'HostError') assert.include(foreign.message, 'registered on this home')
      yield* projectRun()
      const queuedProject = last().attemptId ?? ''
      yield* command('worker-cancel', '--attempt-id', queuedProject)
      assert.include(output.at(-1) ?? '', 'cancelled')
      yield* command('worker-result', '--attempt-id', queuedProject)
      assert.include(output.at(-1) ?? '', 'cancelled')
      yield* command('worker-run', '--worker-id', workerId, '--json')
      const attemptId = last().attemptId ?? ''
      yield* command('worker-result', '--attempt-id', attemptId)
      assert.include(output.at(-1) ?? '', 'queued')
      const store = yield* Effect.promise(() => openWorkerStore(profile, homeId))
      try {
        assert.isTrue(store.agents.permits(workerId, projectId))
        const offer = store.next(workerId)
        assert.isDefined(offer)
        if (!offer) throw new Error('The diagnostic was not offered')
        assert.isAbove(store.claim(workerId, attemptId, offer.fence), 0)
        const stdout = Buffer.from('partial\n\u009b2J\u202e')
        assert.isTrue(
          store.appendLog(workerId, {
            $typeName: 'althar.worker.v1.DiagnosticLog',
            attemptId,
            fence: offer.fence,
            offset: 0,
            output: stdout,
          }),
        )
        yield* command('worker-log', '--attempt-id', attemptId)
        assert.include(output.at(-1) ?? '', '"partial\\n\\u{9b}2J\\u{202e}"')
        yield* command('worker-log', '--attempt-id', attemptId, '--offset', '8', '--json')
        assert.strictEqual(last().bytesBase64, stdout.subarray(8).toString('base64'))
        assert.isTrue(
          store.complete(workerId, {
            $typeName: 'althar.worker.v1.DiagnosticResult',
            attemptId,
            fence: offer.fence,
            outcome: DiagnosticOutcome.FAILED,
            output: Buffer.from('diagnostic unavailable\n'),
          }),
        )
        yield* projectRun()
        const claimedProject = last().attemptId ?? ''
        const projectOffer = store.next(workerId, true)
        if (!projectOffer) throw new Error('The project command was not offered')
        assert.strictEqual(projectOffer.attemptId, claimedProject)
        assert.isAbove(store.claim(workerId, claimedProject, projectOffer.fence), 0)
        assert.isTrue(
          store.appendLog(workerId, {
            $typeName: 'althar.worker.v1.DiagnosticLog',
            attemptId: claimedProject,
            fence: projectOffer.fence,
            offset: 0,
            output: stdout,
          }),
        )
        yield* command('worker-log', '--attempt-id', claimedProject, '--json')
        assert.strictEqual(last().bytesBase64, stdout.toString('base64'))
        yield* command('worker-cancel', '--attempt-id', claimedProject)
        assert.include(output.at(-1) ?? '', 'cancellation requested')
        assert.isTrue(
          store.complete(workerId, {
            $typeName: 'althar.worker.v1.DiagnosticResult',
            attemptId: claimedProject,
            fence: projectOffer.fence,
            outcome: DiagnosticOutcome.CANCELLED,
            output: new Uint8Array(),
          }),
        )
      } finally {
        store.close()
      }
      yield* command('worker-result', '--attempt-id', attemptId)
      assert.include(output.at(-1) ?? '', '"diagnostic unavailable\\n"')
      yield* command('worker-run', '--worker-id', workerId, '--json')
      const revokedAttempt = last().attemptId ?? ''
      yield* command('revoke-worker', '--worker-id', workerId)
      yield* command('worker-result', '--attempt-id', revokedAttempt)
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

      const reserved = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const socket = createServer()
          const ready = once(socket, 'listening')
          socket.listen(0, '127.0.0.1')
          await ready
          return socket
        }),
        (socket) => Effect.promise(() => new Promise<void>((resolve) => socket.close(() => resolve()))),
      )
      const busy = reserved.address()
      if (busy === null || typeof busy === 'string') throw new Error('Expected a reserved worker port')
      yield* command('configure-workers', ...credentials, '--tls-key', certificates('home.key'), '--listen-port', String(busy.port))
      const conflict = yield* Effect.flip(command('serve'))
      assert.strictEqual(conflict._tag, 'HostError')
      if (conflict._tag === 'HostError') assert.strictEqual(conflict.code, 'HostUnavailable')

      writeFileSync(join(profile, 'workers.json'), 'invalid configuration', { mode: 0o600 })
      const malformed = yield* Effect.flip(command('serve'))
      assert.strictEqual(malformed._tag, 'HostError')
    }),
  ),
)

it.live('validates operator relay links and keeps the home ready when the gateway is away', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = temporary()
      const certificates = workerCertificates(root)
      const profile = join(root, 'profile')
      const args = ['--profile', profile, '--key-file', join(root, 'keys/master'), '--json']
      const output: string[] = []
      const io = { out: (line: string) => output.push(line), node: process.execPath, entry: '/unused.js', path: '/usr/bin' }
      const dependencies = {
        agents: Layer.succeed(Agents, Agents.from([])),
        agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
      }
      const command = (...tokens: string[]) => runCommand(parseOptions([...tokens, ...args], {}, root), io, dependencies)
      yield* command('init')
      const caFile = certificates('home-ca.pem')
      const tokenFile = certificates('relay-token')
      writeFileSync(tokenFile, 'a'.repeat(43), { mode: 0o600 })
      const url = `wss://localhost:1/v1/worker-relay/wrl_${'a'.repeat(32)}/home`
      const link = { url, caFile, tokenFile }
      const file = certificates('relay-link.json')
      const configure = (path: string) =>
        command(
          'configure-workers',
          '--listen-port',
          '0',
          '--listen-address',
          '0.0.0.0',
          '--worker-ca',
          caFile,
          '--tls-certificate',
          certificates('home.pem'),
          '--tls-key',
          certificates('home.key'),
          '--worker-relay',
          path,
        )
      const worktreeFile = join(profile, 'worktrees', 'relay.json')
      writeFileSync(worktreeFile, JSON.stringify(link), { mode: 0o600 })
      const inProject = yield* Effect.flip(configure(worktreeFile))
      assert.strictEqual(inProject._tag, 'HostError')
      for (const invalid of [
        { ...link, caFile: 'relative-ca' },
        { ...link, tokenFile: worktreeFile },
        { ...link, url: url.replace(/home$/, 'worker') },
      ]) {
        writeFileSync(file, JSON.stringify(invalid), { mode: 0o600 })
        const error = yield* Effect.flip(configure(file))
        assert.strictEqual(error._tag, 'HostError')
      }
      writeFileSync(file, JSON.stringify(link), { mode: 0o600 })
      yield* configure(file)
      const serve = yield* Effect.forkScoped(command('serve'))
      yield* until(
        Effect.sync(() => output.some((line) => line.includes('"workerPort":'))),
        Boolean,
      )
      yield* Fiber.interrupt(serve)
    }),
  ),
)
