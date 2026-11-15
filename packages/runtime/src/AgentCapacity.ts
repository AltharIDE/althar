import { cpus, totalmem } from 'node:os'

import { Context, Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnce, atOnceFor, clamp } from './atOnce'
import { RuntimeConfig } from './Config'

/** The person's agent cap; absent means the default for this machine. */
export const AT_ONCE_KEY = 'agents_at_once'

/** Shared by admission and session startup, so a lead's test budget uses the cap that admits its work. */
export class AgentCapacity extends Context.Service<AgentCapacity, { readonly atOnce: Effect.Effect<AtOnce, SqlError.SqlError> }>()(
  '@althar/runtime/AgentCapacity',
) {
  static readonly layer = Layer.effect(
    AgentCapacity,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const options = yield* RuntimeConfig
      // One hardware snapshot per launch; the person's setting is read again for each new session.
      const machine = atOnceFor(options.busy?.machine ?? { cores: cpus().length, memory: totalmem() })
      const atOnce = Effect.gen(function* () {
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${AT_ONCE_KEY}`
        const own = kept === undefined || !/^\d+$/.test(kept.value) ? null : clamp(Number(kept.value))
        return { count: own ?? machine.count, own, machine } satisfies AtOnce
      })
      return AgentCapacity.of({ atOnce })
    }),
  )
}
