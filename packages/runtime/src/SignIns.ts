import { type SignInCheck, signInCheck, type SignInStatus } from '@charrette/provider-adapters'
import { Context, Duration, Effect, Layer } from 'effect'
import type { SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents } from './Config'

/*
 * Whether each account is signed in, and how that is paid for, from its
 * agent's own status command run in the account's home, which the runtime
 * never reads around (docs/architecture/03, ADR-012). A check starts that
 * command, so an answer is taken as it was for a minute unless someone asks
 * again. An agent is signed in when any of its accounts is.
 */

/** How long an account's sign-in is taken as it was last checked. */
const TTL = Duration.minutes(1)

const UNKNOWN: SignInCheck = { status: 'unknown', paidBy: 'unknown' }

/** One status for several: signed in where any is, else unknown where any can't tell, else signed out. */
export const anyOf = (statuses: ReadonlyArray<SignInStatus>): SignInStatus =>
  statuses.includes('signed_in') ? 'signed_in' : statuses.includes('unknown') || statuses.length === 0 ? 'unknown' : 'signed_out'

export class SignIns extends Context.Service<
  SignIns,
  {
    /** The agent's sign-in, over its accounts; checked again if older than a minute, or when `recheck`. */
    of(agentId: string, recheck?: boolean): Effect.Effect<SignInStatus>
    /** An account's sign-in, and how it is paid for. */
    account(account: Account, recheck?: boolean): Effect.Effect<SignInCheck>
  }
>()('@charrette/runtime/SignIns') {
  static readonly layer: Layer.Layer<SignIns, never, Agents | Accounts> = Layer.effect(
    SignIns,
    Effect.gen(function* () {
      const agents = yield* Agents
      const accounts = yield* Accounts
      const known = new Map<string, { readonly check: SignInCheck; readonly at: number }>()
      const account = (of: Account, recheck = false) =>
        Effect.gen(function* () {
          const last = known.get(of.id)
          if (!recheck && last !== undefined && Date.now() - last.at < Duration.toMillis(TTL)) return last.check
          const entry = agents.list.find((candidate) => candidate.definition.id === of.agentId)
          if (entry === undefined) return UNKNOWN
          const checked = yield* signInCheck(entry.definition, process.execPath, accounts.env(of))
          known.set(of.id, { check: checked, at: Date.now() })
          return checked
        })
      /** Each of the agent's accounts, checked; none where its accounts can't be read. */
      const checks = (agentId: string, recheck = false) =>
        accounts.of(agentId).pipe(
          Effect.flatMap((list) => Effect.forEach(list, (each) => account(each, recheck), { concurrency: 'unbounded' })),
          Effect.catch((_: SqlError.SqlError) => Effect.succeed<ReadonlyArray<SignInCheck>>([])),
        )
      return SignIns.of({
        of: (agentId, recheck = false) => Effect.map(checks(agentId, recheck), (all) => anyOf(all.map((check) => check.status))),
        account,
      })
    }),
  )
}
