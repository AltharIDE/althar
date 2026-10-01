import { signInStatus, type SignInStatus } from '@charrette/provider-adapters'
import { Context, Duration, Effect, Layer } from 'effect'

import { Agents } from './Config'

/*
 * Whether each agent is signed in, from its own status command, which the
 * runtime never reads around (docs/architecture/03). A check starts that
 * command, so an answer is taken as it was for a minute unless someone asks
 * again.
 */

/** How long an agent's sign-in is taken as it was last checked. */
const TTL = Duration.minutes(1)

export class SignIns extends Context.Service<
  SignIns,
  {
    /** The agent's sign-in; checked again if the last check is older than a minute, or when `recheck`. */
    of(agentId: string, recheck?: boolean): Effect.Effect<SignInStatus>
  }
>()('@charrette/runtime/SignIns') {
  static readonly layer: Layer.Layer<SignIns, never, Agents> = Layer.effect(
    SignIns,
    Effect.gen(function* () {
      const agents = yield* Agents
      const known = new Map<string, { readonly status: SignInStatus; readonly at: number }>()
      return SignIns.of({
        of: (agentId, recheck = false) =>
          Effect.gen(function* () {
            const last = known.get(agentId)
            if (!recheck && last !== undefined && Date.now() - last.at < Duration.toMillis(TTL)) return last.status
            const entry = agents.list.find((candidate) => candidate.definition.id === agentId)
            if (entry === undefined) return 'unknown'
            const status = yield* signInStatus(entry.definition)
            known.set(agentId, { status, at: Date.now() })
            return status
          }),
      })
    }),
  )
}
