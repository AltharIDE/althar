import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Scope, Stream } from 'effect'

import { connect } from '../src/AgentConnection'
import { AgentExited, AgentStartFailed } from '../src/errors'
import { asNode, type CapturedFrame, childEnvironment, environmentDigest, spawnOwned } from '../src/process'
import { fakeAgentMain, scenarios } from '../src/testing'
import { text } from './contract'

const fakeProcess = { _tag: 'Process' as const, spec: { command: 'bun', args: [fakeAgentMain] }, cwd: '/tmp' }
const reject = () => Effect.succeed({ decision: 'reject' as const })

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether a process is gone within a second: one Althar did not start is reaped by the OS, in its own time. */
const goneSoon = (pid: number) =>
  Effect.gen(function* () {
    for (let waited = 0; isAlive(pid) && waited < 1_000; waited += 25) yield* Effect.sleep('25 millis')
    return !isAlive(pid)
  })

describe('the process transport', () => {
  it.live('runs a turn with the agent as a process it owns, and records what it started', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect({ transport: fakeProcess, onPermission: reject })
        assert.isAbove(connection.process?.pid ?? 0, 0)
        assert.match(connection.process?.environmentDigest ?? '', /^[0-9a-f]{64}$/)
        assert.isFalse(Number.isNaN(Date.parse(connection.process?.osStartedAt ?? '')))
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
      }),
    ),
  )

  it.live('captures the raw protocol in both directions, in order', () =>
    Effect.gen(function* () {
      const frames: Array<CapturedFrame> = []
      yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connect({ transport: { ...fakeProcess, capture: (frame) => frames.push(frame) }, onPermission: reject })
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          yield* Stream.runCollect(session.prompt(scenarios.hello))
        }),
      )
      assert.deepStrictEqual(
        frames.map((frame) => frame.sequence),
        frames.map((_, index) => index + 1),
      )
      const decoded = frames.map((frame) => [frame.direction, new TextDecoder().decode(frame.bytes)] as const)
      assert.isTrue(decoded[0]?.[0] === 'to_agent' && decoded[0][1].includes('"initialize"'))
      assert.isTrue(decoded.some(([direction, body]) => direction === 'from_agent' && body.includes('agent_message_chunk')))
    }),
  )

  it.live('says the agent has gone when its process exits mid-turn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect({ transport: fakeProcess, onPermission: reject })
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        const error = yield* Effect.flip(Stream.runCollect(session.prompt(scenarios.exit)))
        assert.instanceOf(error, AgentExited)
        assert.strictEqual((error as AgentExited).code, 3)
        assert.deepStrictEqual(yield* connection.closed, { code: 3, signal: null })
      }),
    ),
  )

  it.live('stops the whole process group when the scope closes, and says how', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const connection = yield* Scope.provide(scope)(connect({ transport: fakeProcess, onPermission: reject }))
      const pid = connection.process?.pid ?? 0
      assert.isTrue(isAlive(pid))
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(pid))
      assert.deepStrictEqual(yield* connection.process?.stopped ?? Effect.die('no process'), { signal: 'SIGTERM', survivors: false })
    }),
  )

  it.live('fails to start a command that does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const error = yield* Effect.flip(spawnOwned({ command: 'althar-no-such-agent', args: [] }, '/tmp'))
        assert.instanceOf(error, AgentStartFailed)
      }),
    ),
  )

  it.live('kills a process that ignores TERM once the grace period ends', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(
        spawnOwned({ command: 'bun', args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"] }, '/tmp', {
          grace: '200 millis',
        }),
      )
      yield* Effect.sleep('300 millis')
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(owned.pid))
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGKILL', survivors: false })
      assert.strictEqual(owned.stderrTail(), '')
    }),
  )

  it.live('stops what an agent left running after it exited', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned({ command: '/bin/sh', args: ['-c', 'sleep 30 & echo $! >&2'] }, '/tmp'))
      yield* Deferred.await(owned.exited)
      yield* Effect.sleep('50 millis')
      const orphan = Number(owned.stderrTail().trim())
      assert.isTrue(isAlive(orphan))
      yield* Scope.close(scope, Exit.void)
      assert.isTrue(yield* goneSoon(orphan))
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'SIGTERM', survivors: false })
    }),
  )

  it.live('has nothing to stop when the group has already gone', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned({ command: '/usr/bin/true', args: [] }, '/tmp'))
      yield* Deferred.await(owned.exited)
      yield* Effect.sleep('50 millis')
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(yield* Deferred.await(owned.stopped), { signal: 'none', survivors: false })
    }),
  )

  it.live('runs a spec where it says it lives, with the cwd and environment it assembled', () =>
    Effect.gen(function* () {
      const said: Array<{ cwd?: string; env: Readonly<Record<string, string | undefined>> }> = []
      const spec = {
        command: 'nowhere',
        args: [] as ReadonlyArray<string>,
        onDevice: (at: { cwd?: string; env: Readonly<Record<string, string | undefined>> }) => {
          said.push(at)
          return {
            command: '/bin/sh',
            args: ['-c', 'sleep 0.1; printf %s "$PWD|$SMOKE"'],
            env: { SMOKE: 'yes' },
            inheritEnv: ['DBUS_SESSION_BUS_ADDRESS'],
          }
        },
      }
      const scope = yield* Scope.make()
      const owned = yield* Scope.provide(scope)(spawnOwned(spec, '/tmp'))
      const reader = owned.stdout.getReader()
      let text = ''
      for (;;) {
        const { done, value } = yield* Effect.promise(() => reader.read())
        if (done) break
        text += new TextDecoder().decode(value)
      }
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(text, '/tmp|yes')
      assert.strictEqual(said[0]?.cwd, '/tmp')
      assert.strictEqual(said[0]?.env.SMOKE, undefined)
    }),
  )
})

describe('childEnvironment', () => {
  const parent = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    LC_ALL: 'C',
    HTTPS_PROXY: 'http://proxy',
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: 'test-key',
    CLAUDE_CONFIG_DIR: '/tmp/claude',
    ALTHAR_DATABASE: '/tmp/althar.db',
  }

  it('passes on only the allowlist, what the agent names, and its own variables', () => {
    assert.deepStrictEqual(
      childEnvironment(
        { command: 'agent', args: [], inheritEnv: ['CLAUDE_CONFIG_DIR'], env: { MODE: 'x', PATH: '/opt/bin' } },
        parent,
        false,
      ),
      {
        PATH: '/opt/bin',
        HOME: '/Users/someone',
        LC_ALL: 'C',
        HTTPS_PROXY: 'http://proxy',
        CLAUDE_CONFIG_DIR: '/tmp/claude',
        MODE: 'x',
      },
    )
  })

  it("runs Electron's own binary as Node", () => {
    assert.strictEqual(childEnvironment({ command: process.execPath, args: [] }, {}, true).ELECTRON_RUN_AS_NODE, '1')
    assert.isUndefined(childEnvironment({ command: 'opencode', args: [] }, {}, true).ELECTRON_RUN_AS_NODE)
    assert.isUndefined(childEnvironment({ command: process.execPath, args: [] }, {}, false).ELECTRON_RUN_AS_NODE)
    // The sign-in check runs the same binary, with the same flag.
    assert.deepStrictEqual(asNode({ command: process.execPath, args: [] }, true), { ELECTRON_RUN_AS_NODE: '1' })
    assert.deepStrictEqual(asNode({ command: 'claude', args: [] }, true), {})
  })

  it('digests an environment whatever order it is in', () => {
    assert.strictEqual(environmentDigest({ A: '1', B: '2' }), environmentDigest({ B: '2', A: '1' }))
    assert.notStrictEqual(environmentDigest({ A: '1' }), environmentDigest({ A: '2' }))
  })
})
