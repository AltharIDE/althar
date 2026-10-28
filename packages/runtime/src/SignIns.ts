import {
  adapterNode,
  agentVersion,
  planPairOf,
  type SignInCheck,
  signInCheck,
  type SignInStatus,
  unsupportedAt,
} from '@althar/provider-adapters'
import { Context, Duration, Effect, Layer, PubSub, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { type AgentEntry, Agents } from './Config'

/*
 * Whether each account is signed in, and how that is paid for, from its
 * agent's own status command run in the account's home, which the runtime
 * never reads around (docs/architecture/03, ADR-012). An agent whose status
 * can't say how it is paid, and whose plan is told by its sign-in for it
 * being there (`token`, as Kimi Code's), is on a plan once its usage read
 * found that sign-in and read the plan's windows (PlanUsage keeps them). A
 * check starts that command, so an answer is taken as it was for a minute
 * unless someone asks again. An agent is signed in when any of its accounts
 * is. As checks come in, it says when an agent is signed in, for usage data
 * (UsageData.ts): found so the first time this launch, or an account signed
 * in that was signed out. Its version is asked of its copy before any status
 * command, once for all the checks of one refresh, and Settings reads that
 * same answer (`version`), so the two say the same.
 */

/** How long an account's sign-in is taken as it was last checked. */
const TTL = Duration.minutes(1)

/** How long one reading of an agent's version serves the checks that start meanwhile: one refresh's. */
const ROUND = Duration.seconds(5)

const UNKNOWN: SignInCheck = { status: 'unknown', paidBy: 'unknown' }

/** An agent signed in: found so the first time this launch, or an account of its that was signed out signed in. */
export interface SignedIn {
  readonly agentId: string
  readonly how: 'found' | 'signed_in'
}

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
    /** The agent's version as its copy says it, read again if older than a minute, or now with `recheck`; null where it doesn't say. */
    version(agentId: string, recheck?: boolean): Effect.Effect<string | null>
    /** Each agent as it is found signed in, or signed in, from now on. */
    readonly signedIn: Stream.Stream<SignedIn>
  }
>()('@althar/runtime/SignIns') {
  static readonly layer: Layer.Layer<SignIns, never, Agents | Accounts | SqlClient.SqlClient> = Layer.effect(
    SignIns,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const accounts = yield* Accounts
      const known = new Map<string, { readonly check: SignInCheck; readonly at: number }>()
      /* Agents found signed in this launch, and what is said as they are. */
      const found = new Set<string>()
      const arrived = yield* PubSub.unbounded<SignedIn>()
      /* Each agent's last reading of its version, from when it began: those that start while it runs share it. */
      const versions = new Map<string, { readonly at: number; readonly read: Promise<string | null> }>()
      const versionOf = (entry: AgentEntry, within: Duration.Duration) =>
        Effect.suspend(() => {
          const last = versions.get(entry.definition.id)
          if (last !== undefined && Date.now() - last.at < Duration.toMillis(within)) return Effect.promise(() => last.read)
          const read = Effect.runPromise(agentVersion(entry.definition, adapterNode()))
          versions.set(entry.definition.id, { at: Date.now(), read })
          return Effect.promise(() => read)
        })
      /** Paid by a plan where its status can't say, its plan is told by its sign-in, and a usage read found it and read the plan. */
      const paid = (of: Account, check: SignInCheck) =>
        Effect.gen(function* () {
          if (check.paidBy !== 'unknown' || check.status === 'signed_out' || planPairOf(of.agentId)?.classification !== 'token')
            return check
          const [read] = yield* sql<{ accountId: string }>`SELECT account_id FROM plan_usage_readings WHERE account_id = ${of.id}`.pipe(
            Effect.orElseSucceed(() => []),
          )
          return read === undefined ? check : { ...check, paidBy: 'plan' as const }
        })
      const account = (of: Account, recheck = false) =>
        Effect.gen(function* () {
          const last = known.get(of.id)
          if (!recheck && last !== undefined && Date.now() - last.at < Duration.toMillis(TTL)) return yield* paid(of, last.check)
          const entry = agents.list.find((candidate) => candidate.definition.id === of.agentId)
          if (entry === undefined) return UNKNOWN
          // An agent at a version no session starts on isn't asked either: OpenCode 2's status goes through a service the
          // whole user shares, which answers for whichever account started it and keeps running after.
          // Asked now, as the person may have changed it, but once for the accounts checked together.
          if (entry.definition.supported !== undefined && unsupportedAt(entry.definition, yield* versionOf(entry, ROUND)) !== null) {
            known.set(of.id, { check: UNKNOWN, at: Date.now() })
            return UNKNOWN
          }
          yield* accounts.prepare(of)
          const checked = yield* signInCheck(entry.definition, adapterNode(), accounts.env(of))
          // As it stands now, not as it stood when this check began: another may have finished meanwhile and said it.
          const before = known.get(of.id)?.check.status
          known.set(of.id, { check: checked, at: Date.now() })
          if (checked.status === 'signed_in') {
            const how: SignedIn['how'] | null = before === 'signed_out' ? 'signed_in' : found.has(of.agentId) ? null : 'found'
            found.add(of.agentId)
            if (how !== null) yield* PubSub.publish(arrived, { agentId: of.agentId, how })
          }
          return yield* paid(of, checked)
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
        version: (agentId, recheck = false) => {
          const entry = agents.list.find((candidate) => candidate.definition.id === agentId)
          return entry === undefined ? Effect.succeed(null) : versionOf(entry, recheck ? Duration.zero : TTL)
        },
        signedIn: Stream.fromPubSub(arrived),
      })
    }),
  )
}
