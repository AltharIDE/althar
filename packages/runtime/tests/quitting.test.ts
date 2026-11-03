import { connect } from 'node:net'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { ToolServer } from '../src/ToolServer'
import { runtime, until } from './support'

/*
 * Quitting the runtime while an agent is still on a call to its tools. Node's
 * server, closing, lets idle connections go but waits for one with a request
 * on it, and the agent's client then keeps it for its next call: for seconds,
 * in every test whose agents called a tool. Quitting cuts it instead.
 */

describe('quitting', () => {
  it.live('quits at once while an agent is still on a call to its tools', () =>
    Effect.gen(function* () {
      // What the call heard back, and whether its connection is gone.
      const call = { answered: '', cut: false }
      yield* Effect.gen(function* () {
        const granted = yield* (yield* ToolServer).grant({
          role: 'coordinator',
          projectId: 'p',
          threadId: 't',
          sessionId: 's',
          taskId: null,
        })
        assert.strictEqual(granted.server.type, 'http')
        const { port } = new URL(granted.server.type === 'http' ? granted.server.url : '')
        // A call under way: its request begun and not yet whole, as the runtime quits.
        yield* Effect.callback<void>((resume) => {
          const socket = connect(Number(port), '127.0.0.1', () => {
            socket.write('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n')
            setTimeout(() => resume(Effect.void), 100)
          })
          socket.on('data', (data) => void (call.answered += data.toString()))
          socket.on('close', () => void (call.cut = true))
          socket.on('error', () => undefined)
        })
      }).pipe(Effect.provide(runtime()))
      // Cut as it quit, and never answered: waited for, it would have held quitting up until the request timed out, a
      // minute, and been answered then.
      yield* until(
        Effect.sync(() => call.cut),
        Boolean,
      )
      assert.strictEqual(call.answered, '')
    }),
  )
})
