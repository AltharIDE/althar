import { type SignInCheck, signInCheck, type SignInStatus } from '@charrette/provider-adapters'
import { Context, Duration, Effect, Layer } from 'effect'

import { Agents } from './Config'

/*
 * Whether each agent is signed in, and how that is paid for, from its own
 * status command, which the runtime never reads around (docs/architecture/03).
 * A check starts that command, so an answer is taken as it was for a minute
 * unless someone asks again.
 */

/** How long an agent's sign-in is taken as it was last checked. */
const TTL = Duration.minutes(1)

export class SignIns extends Context.Service<
  SignIns,
  {
    /** The agent's sign-in; checked again if the last check is older than a minute, or when `recheck`. */
    of(agentId: string, recheck?: boolean): Effect.Effect<SignInStatus>
    /** How the agent's sign-in is paid for: its plan, per use on a key, or unknown. */
    paidBy(agentId: string): Effect.Effect<SignInCheck['paidBy']>
  }
>()('@charrette/runtime/SignIns') {
  static readonly layer: Layer.Layer<SignIns, never, Agents> = Layer.effect(
    SignIns,
    Effect.gen(function* () {
      const agents = yield* Agents
      const known = new Map<string, { readonly check: SignInCheck; readonly at: number }>()
      const check = (agentId: string, recheck = false) =>
        Effect.gen(function* () {
          const last = known.get(agentId)
          if (!recheck && last !== undefined && Date.now() - last.at < Duration.toMillis(TTL)) return last.check
          const entry = agents.list.find((candidate) => candidate.definition.id === agentId)
          if (entry === undefined) return { status: 'unknown', paidBy: 'unknown' } satisfies SignInCheck
          const checked = yield* signInCheck(entry.definition)
          known.set(agentId, { check: checked, at: Date.now() })
          return checked
        })
      return SignIns.of({
        of: (agentId, recheck = false) => Effect.map(check(agentId, recheck), (checked) => checked.status),
        paidBy: (agentId) => Effect.map(check(agentId), (checked) => checked.paidBy),
      })
    }),
  )
}
