import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import type { StallOptions } from '../src/Config'
import type { Reading } from '../src/machine'
import { MachineLoad } from '../src/MachineLoad'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, runtime, task, until } from './support'

/*
 * An agent run as a process of its own, as real agents are (the fake agent
 * under the id `process`): what Althar reads of its CPU on this machine, to
 * tell a stall from work and an idle server from one at work, and how hard
 * the machine works when a reading can't tell.
 */

const MB = 1024 * 1024

const pidOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* until(
      sql<{ pid: number }>`
        SELECT p.pid FROM processes p JOIN provider_sessions s ON s.id = p.provider_session_id
        WHERE s.thread_id = ${threadId} AND p.state = 'running' AND p.pid IS NOT NULL`,
      (rows) => rows.length === 1,
    )
    return row?.pid ?? 0
  })

const tell = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

/** Stalls told in a moment rather than minutes. */
const FAST: StallOptions = {
  every: Duration.millis(100),
  quiet: Duration.millis(600),
  quietInTool: Duration.millis(600),
  cancelGrace: Duration.seconds(2),
}

describe('an agent run as its own process', () => {
  it.live('is read for the CPU its processes use while a tool runs, and told to carry on when they sit idle', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Serve it')
      yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
      assert.isAbove(yield* pidOf(created.threadId), 0)
      yield* tell(created.threadId, 'Serve it. [lead:hang-once]')
      const [told] = yield* until(
        Effect.map(notices(created.threadId), (said) => said.filter((notice) => notice.about === 'stall')),
        (said) => said.length > 0,
      )
      assert.match(
        told?.title ?? '',
        /^process showed no sign of work for a minute while running `npm run dev`, so Althar stopped its turn/,
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { stalls: FAST }))),
  )

  // Not on Windows, where the machine is read with no listing of its processes (machine.ts reads `ps`), so what an agent
  // left running counts until it ends.
  it.live.skipIf(process.platform === 'win32')(
    'takes no place with a server it left running that sits idle, its CPU read from the machine',
    () =>
      Effect.gen(function* () {
        const busy = yield* Busy
        const sessions = yield* Sessions
        const { task: created } = yield* task('Leave it running')
        yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
        yield* tell(created.threadId, 'Start the server. [lead:serve]')
        // What it left running counts while it is new, then not once it has sat idle.
        yield* until(
          Effect.map(sessions.running(created.threadId), (running) =>
            running._tag === 'Some' && running.value.background.length > 0 && !running.value.turnRunning ? [running] : [],
          ),
          (rows) => rows.length === 1,
        )
        const [idle] = yield* until(
          Effect.map(busy.now, (now) => (now.busy === 0 ? [now] : [])),
          (rows) => rows.length === 1,
        )
        assert.strictEqual(idle?.busy, 0)
      }).pipe(Effect.provide(runtime(':memory:', {}, { busy: { sample: Duration.millis(100), quiet: Duration.millis(500) } }))),
  )
})

describe("this computer's load, where a reading can't tell", () => {
  it.live('says no CPU is used where the readings show no time passing, and leaves out an agent the listing misses', () => {
    let reads = 0
    const read = Effect.sync((): Reading => {
      reads += 1
      return {
        at: reads * 3_000,
        // The same every time: no ticks between two readings.
        cores: { busy: 3_000, total: 12_000, count: 4 },
        memory: { used: 8_000 * MB, total: 16_000 * MB },
        pressure: 'normal',
        processes: new Map([[1, { parent: 0, cpu: reads * 9_000, memory: 10 * MB }]]),
      }
    })
    return Effect.gen(function* () {
      const machineLoad = yield* MachineLoad
      const { task: created } = yield* task()
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'process' })
      yield* pidOf(created.threadId)
      yield* machineLoad.now
      yield* Effect.sleep(Duration.millis(60))
      const load = yield* machineLoad.now
      assert.strictEqual(load.cpu, 0)
      // Its process isn't in what the machine listed: it has no part to show.
      assert.deepStrictEqual(load.shares, [])
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read, every: Duration.millis(50), settle: Duration.millis(1) } })))
  })
})

describe('a project’s line', () => {
  it.live('moves nothing for a task Althar has no record of', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      assert.isFalse(yield* busy.move('tsk_missing', 0))
    }).pipe(Effect.provide(runtime())),
  )
})
