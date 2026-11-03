import { adapterNode, planPairOf, type SignInCheck, signInCheck, type SignInStatus } from '@althar/provider-adapters'
import { Clock, Context, Duration, Effect, Layer, PubSub, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents } from './Config'

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
 * in that was signed out.
 */

/** How long an account's sign-in is taken as it was last checked. */
const TTL = Duration.minutes(1)

const UNKNOWN: SignInCheck = { status: 'unknown', paidBy: 'unknown' }

/** An agent signed in: found so the first time this launch, or an account of its that was signed out signed in. */
export interface SignedIn {
  readonly agentId: string
  readonly how: 'found' | 'signed_in'
}

/** One status for several: signed in where any is, else unknown where any can't tell, else signed out. */
export const anyOf = (statuses: ReadonlyArray<SignInStatus>): SignInStatus =>
  statuses.includes('signed_in') ? 'signed_in' : statuses.includes('unknown') || statuses.length === 0 ? 'unknown' : 'signed_out'

/**
 * For each provider a model goes through, when its latest turn that said whether its sign-in works was refused, or null where it went
 * through. `turns` are newest first; one cancelled or failed another way says nothing, and isn't among them.
 */
export const latestRefusals = (
  turns: ReadonlyArray<{ readonly model: string; readonly endedAt: string; readonly errorClass: string | null }>,
  providerOf: (model: string) => string | undefined,
): ReadonlyMap<string, string | null> => {
  const latest = new Map<string, string | null>()
  for (const turn of turns) {
    const id = providerOf(turn.model)
    if (id !== undefined && !latest.has(id)) latest.set(id, turn.errorClass === 'auth_required' ? turn.endedAt : null)
  }
  return latest
}

export class SignIns extends Context.Service<
  SignIns,
  {
    /** The agent's sign-in, over its accounts; checked again if older than a minute, or when `recheck`. */
    of(agentId: string, recheck?: boolean): Effect.Effect<SignInStatus>
    /** An account's sign-in, and how it is paid for. */
    account(account: Account, recheck?: boolean): Effect.Effect<SignInCheck>
    /**
     * For an agent whose providers each have a sign-in (OpenCode): the ones its listing has as signed in, and any whose last turn
     * was refused, when. A refusal is let go when a later turn on the provider went through, or its sign-in changed since.
     */
    providers(
      account: Account,
      check: SignInCheck,
    ): Effect.Effect<ReadonlyArray<{ readonly id: string; readonly name: string; readonly refusedAt: string | null }> | undefined>
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
          if (!recheck && last !== undefined && (yield* Clock.currentTimeMillis) - last.at < Duration.toMillis(TTL))
            return yield* paid(of, last.check)
          const entry = agents.list.find((candidate) => candidate.definition.id === of.agentId)
          if (entry === undefined) return UNKNOWN
          yield* accounts.prepare(of)
          const checked = yield* signInCheck(entry.definition, adapterNode(), accounts.env(of))
          // As it stands now, not as it stood when this check began: another may have finished meanwhile and said it.
          const before = known.get(of.id)?.check.status
          known.set(of.id, { check: checked, at: yield* Clock.currentTimeMillis })
          if (checked.status === 'signed_in') {
            const how: SignedIn['how'] | null = before === 'signed_out' ? 'signed_in' : found.has(of.agentId) ? null : 'found'
            found.add(of.agentId)
            if (how !== null) yield* PubSub.publish(arrived, { agentId: of.agentId, how })
          }
          return yield* paid(of, checked)
        })
      /** What an account's sign-in looked like when a refusal was first seen in Settings: another since means it was put right. */
      const refusals = new Map<string, { readonly at: string; readonly connections: string }>()
      const providers = (of: Account, check: SignInCheck) =>
        Effect.gen(function* () {
          const spec = agents.list.find((candidate) => candidate.definition.id === of.agentId)?.definition.signIn.providers
          if (spec === undefined) return undefined
          // The latest turn of each provider that said whether its sign-in works; a cancelled or failed-otherwise one says nothing.
          const turns = yield* sql<{ model: string; endedAt: string; errorClass: string | null }>`
            SELECT t.model, t.ended_at, t.error_class FROM turn_deliveries t
            JOIN provider_sessions s ON s.id = t.provider_session_id
            WHERE s.account_id = ${of.id} AND t.model IS NOT NULL AND t.ended_at IS NOT NULL
              AND (t.error_class = 'auth_required' OR (t.error_class IS NULL AND t.state = 'completed'))
            ORDER BY t.ended_at DESC LIMIT 300`.pipe(Effect.orElseSucceed(() => []))
          const latest = latestRefusals(turns, spec.of)
          const listed = check.providers ?? []
          const refusedAt = (id: string): string | null => {
            const at = latest.get(id) ?? null
            const key = `${of.id}\u0000${id}`
            if (at === null) {
              refusals.delete(key)
              return null
            }
            const connections = listed.find((each) => each.id === id)?.connections ?? ''
            const seen = refusals.get(key)
            if (seen === undefined || seen.at !== at) {
              refusals.set(key, { at, connections })
              return at
            }
            return seen.connections === connections ? at : null
          }
          const rows = listed.map((each) => ({ id: each.id, name: each.name, refusedAt: refusedAt(each.id) }))
          // One refused whose sign-in is gone from the listing is still one to sign in to.
          const gone = [...latest.keys()].filter((id) => !listed.some((each) => each.id === id))
          return [...rows, ...gone.flatMap((id) => (refusedAt(id) === null ? [] : [{ id, name: id, refusedAt: latest.get(id) ?? null }]))]
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
        providers,
        signedIn: Stream.fromPubSub(arrived),
      })
    }),
  )
}
