import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Scope, Stream } from 'effect'

import { connect } from '../src/AgentConnection'
import { AgentExited, AgentStartFailed } from '../src/errors'
import { spawnOwned } from '../src/process'
import { fakeAgentMain, scenarios } from '../src/testing'
import { text } from './contract'

const fakeProcess = { _tag: 'Process' as const, spec: { command: 'bun', args: [fakeAgentMain] }, cwd: '/tmp' }
const reject = () => Effect.succeed('reject' as const)

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('the process transport', () => {
  it.live('runs a turn with the agent as a process it owns', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* connect({ transport: fakeProcess, onPermission: reject })
        assert.isAbove(connection.pid ?? 0, 0)
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
      }),
    ),
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

  it.live('stops the whole process group when the scope closes', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const connection = yield* Scope.provide(scope)(connect({ transport: fakeProcess, onPermission: reject }))
      const pid = connection.pid ?? 0
      assert.isTrue(isAlive(pid))
      yield* Scope.close(scope, Exit.void)
      assert.isFalse(isAlive(pid))
    }),
  )

  it.live('fails to start a command that does not exist', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const error = yield* Effect.flip(spawnOwned({ command: 'charrette-no-such-agent', args: [] }, '/tmp'))
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
      assert.strictEqual(owned.stderrTail(), '')
    }),
  )
})
