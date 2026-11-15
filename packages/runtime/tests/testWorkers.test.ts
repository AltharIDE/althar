import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Busy } from '../src/Busy'
import { Sessions } from '../src/Sessions'
import { launches, runtime, task, turns, until } from './support'

const GB = 1024 ** 3

describe('a session’s share of test workers', () => {
  it.live('uses the admission cap, rereads changes for new sessions, and briefs the lead with its inherited budget', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      // Ten cores / the default four agents rounds down to two workers.
      for (const [cap, workers] of [
        [null, 2],
        [3, 3],
        [16, 1],
        [null, 2],
      ] as const) {
        yield* busy.set(cap)
        assert.strictEqual((yield* busy.atOnce).count, cap ?? 4)
        const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        assert.strictEqual(launches.at(-1)?.env.VITEST_MAX_WORKERS, String(workers))
        const delivered = yield* until(turns(created.threadId), (rows) =>
          rows.some((row) => row.providerSessionId === sessionId && row.state === 'completed'),
        )
        const brief = delivered.find((row) => row.providerSessionId === sessionId)?.prompt ?? ''
        assert.include(brief, `VITEST_MAX_WORKERS=${workers}`)
        assert.include(brief, 'Do not unset it or raise it')
        assert.include(brief, 'workspace packages sequentially')
        yield* sessions.stop(created.threadId)
      }
    }).pipe(Effect.provide(runtime(':memory:', {}, { busy: { machine: { cores: 10, memory: 16 * GB } } }))),
  )
})
