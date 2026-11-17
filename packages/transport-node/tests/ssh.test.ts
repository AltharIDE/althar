import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { API_VERSION, encodeWire } from '@althar/contracts'
import { until } from '@althar/testing/effect'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import { inspectSshHost, openSshConnection } from '../src/ssh'
import { socketReady } from '../src/bridgeProtocol'
import type { SshRuntime, SshSpawn } from '../src/sshProcess'

const homeId = `home_${'1'.repeat(32)}`
const identity = { homeId, actorId: `act_${'2'.repeat(32)}`, deviceId: `dev_${'3'.repeat(32)}`, role: 'socket' as const }
const frame = (value: unknown) => {
  const body = Buffer.from(encodeWire(value))
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body]).toString('hex')
}
const fixture = (script: string) => {
  const children: ChildProcessWithoutNullStreams[] = []
  const calls: Array<{ program: string; args: ReadonlyArray<string>; env: NodeJS.ProcessEnv | undefined }> = []
  const start: SshSpawn = (program, args, options) => {
    calls.push({ program, args, env: options.env })
    const child = spawn(process.execPath, ['-e', script], { ...options, stdio: 'pipe' })
    children.push(child)
    return child
  }
  const runtime: SshRuntime = {
    spawn: start,
    environment: { PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'must-not-inherit', NODE_OPTIONS: '--invalid-node-option' },
  }
  return { runtime, children, calls }
}
describe('owned SSH API connections', () => {
  it('accepts only a pinned socket identity, sanitizes inheritance and releases its child with the scope', async () => {
    const at = fixture(`process.stdout.write(Buffer.from(${JSON.stringify(frame(socketReady(identity)))}, 'hex'));process.stdin.resume()`)
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* openSshConnection({ target: 'fixture-host', homeId }, at.runtime)
          expect(connection.identity).toEqual(identity)
          expect(at.calls[0]?.args).toContain('-oStrictHostKeyChecking=yes')
          expect(at.calls[0]?.env?.ANTHROPIC_API_KEY).toBeUndefined()
          expect(at.calls[0]?.env?.NODE_OPTIONS).toBeUndefined()
        }),
      ),
    )
    expect(at.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true)
  })
  it('does read-only bounded status discovery and refuses malformed or excessive output', async () => {
    const status = { state: 'ready', homeId, hostDeviceId: identity.deviceId, apiVersion: API_VERSION, version: '0.1.0' }
    const at = fixture(`process.stdout.write(${JSON.stringify(JSON.stringify(status))})`)
    expect(await Effect.runPromise(inspectSshHost({ target: 'fixture-host' }, at.runtime))).toEqual(status)
    expect(at.calls[0]?.args.at(-1)).toContain('status --json')
    for (const script of ['process.stdout.write("invalid private content")', 'process.stdout.write("x".repeat(20000))']) {
      const bad = fixture(script)
      const error = await Effect.runPromise(Effect.flip(inspectSshHost({ target: 'fixture-host' }, bad.runtime)))
      expect(JSON.stringify(error)).not.toContain('private content')
      expect(bad.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true)
    }
  })
  it('classifies SSH authentication and host-key refusal without exposing stderr contents', async () => {
    for (const [diagnostic, reason] of [
      ['Permission denied (publickey). private token', 'SshAuthenticationFailed'],
      ['Host key verification failed. private token', 'SshHostKeyRejected'],
    ] as const) {
      const at = fixture(`process.stderr.write(${JSON.stringify(diagnostic)});process.exit(255)`)
      const error = await Effect.runPromise(Effect.scoped(Effect.flip(openSshConnection({ target: 'fixture-host', homeId }, at.runtime))))
      expect(error.reason).toBe(reason)
      expect(JSON.stringify(error)).not.toContain('private token')
    }
  })
  it('refuses a different home and stops an unresponsive handshake when cancelled', async () => {
    const wrong = fixture(
      `process.stdout.write(Buffer.from(${JSON.stringify(frame(socketReady({ ...identity, homeId: `home_${'4'.repeat(32)}` })))}, 'hex'));process.stdin.resume()`,
    )
    expect(
      await Effect.runPromise(Effect.scoped(Effect.flip(openSshConnection({ target: 'fixture-host', homeId }, wrong.runtime)))),
    ).toMatchObject({ reason: 'HomeMismatch' })
    const held = fixture('process.stdin.resume()')
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connecting = yield* Effect.forkScoped(Effect.scoped(openSshConnection({ target: 'fixture-host', homeId }, held.runtime)))
          yield* until(
            Effect.sync(() => held.children.length),
            (count) => count === 1,
          )
          yield* Fiber.interrupt(connecting)
          expect(held.children[0]?.exitCode !== null || held.children[0]?.signalCode !== null).toBe(true)
        }),
      ),
    )
  })
  it('reports unavailable executables and invalid arguments without starting a process', async () => {
    const at = fixture('process.exit(1)')
    const error = await Effect.runPromise(Effect.scoped(Effect.flip(openSshConnection({ target: '-bad', homeId }, at.runtime))))
    expect(error).toMatchObject({ reason: 'InvalidConnection' })
    expect(at.children).toHaveLength(0)
    expect(
      await Effect.runPromise(Effect.scoped(Effect.flip(openSshConnection({ target: 'host', homeId }, { executable: 'relative' })))),
    ).toMatchObject({ reason: 'SshUnavailable' })
  })
})
