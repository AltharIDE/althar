import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { listTools, runtime } from './support'

/*
 * Quitting the runtime once an agent has called its tools. The agent's MCP
 * client keeps its connection open for its next call, as fetch does; quitting
 * doesn't wait for that to time out, as Node's server would by itself.
 */

describe('quitting', () => {
  it.live('quits at once after an agent called its tools, though its connection was kept open', () =>
    Effect.gen(function* () {
      const listedAt = yield* Effect.gen(function* () {
        const tools = yield* listTools({ role: 'coordinator', projectId: 'p', threadId: 't', sessionId: 's', taskId: null })
        assert.isNotEmpty(tools)
        return Date.now()
      }).pipe(Effect.provide(runtime()))
      // Kept open, it would hold quitting up for the server's five seconds of keep-alive.
      assert.isBelow(Date.now() - listedAt, 2_000)
    }),
  )
})
