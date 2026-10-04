import { modelName } from '@althar/contracts'
import type { ConfigOption } from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { Context, Duration, Effect, Layer, Option, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents } from './Config'
import { NotFound } from './errors'
import { accountsOf, Policies } from './Policies'
import { timestamp } from './records'
import { SignIns } from './SignIns'

/*
 * Usage limits (docs/architecture/03 and 05, ADR-012): which accounts are
 * out, until when, and which account a session runs on. An account is out
 * from the turn that reached its limit until the reset its error gave, or,
 * without one, for an hour, when it is tried again; an agent is out when all
 * its accounts are. What the work does meanwhile is one of the project's
 * rules (Policies): move on (the default), to the agent's next account and
 * then the next free agent, or wait for the reset.
 */

/** How long an agent whose limit gave no reset time counts as out. */
const UNKNOWN_RESET = Duration.hours(1)

/** An account that is out: until its reset, if it said, and when it is tried again either way. */
export interface Out {
  readonly agentId: string
  readonly accountId: string
  readonly resetsAt: string | null
  readonly until: string
}

/** When an agent is back, in the words a thread says it: the time, and the day where it isn't today. */
export const whenWords = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
  if (at.toDateString() === now.toDateString()) return time
  const day = new Intl.DateTimeFormat(
    undefined,
    Duration.toMillis(Duration.days(6)) > at.getTime() - now.getTime() ? { weekday: 'long' } : { day: 'numeric', month: 'long' },
  ).format(at)
  return `${day}, ${time}`
}

/** What a thread says when an agent is out of usage: who, until when, and who takes the work over, or that it waits. */
export const outWords = (input: {
  readonly from: string
  readonly resetsAt: string | null
  /** Who takes over, on which model; `ownWork` where it is the other step's agent, so it reviews what it wrote. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
  readonly waits?: 'step' | 'message'
}): string => {
  const out = `${input.from} reached its usage limit${input.resetsAt === null ? '' : `, until ${whenWords(input.resetsAt)}`}.`
  if (input.to !== undefined)
    return `${out} ${input.to.agent} takes over${input.to.model === null ? '' : `, on ${input.to.model}`}${
      input.to.ownWork === true ? ', and reviews its own work' : ''
    }.`
  if (input.waits === undefined) return out
  return `${out} ${input.waits === 'step' ? 'The step' : 'Your message'} waits until ${input.resetsAt === null ? 'it is back' : 'then'}.`
}

type Failure = SqlError.SqlError | Schema.SchemaError

export class Limits extends Context.Service<
  Limits,
  {
    /**
     * Whether the agent is out now, and until when: every account work could
     * run on (in the project, where given: its first, unless it rotates),
     * the soonest back.
     */
    out(agentId: string, projectId?: string): Effect.Effect<Option.Option<Out>, Failure>
    /** Whether the project moves work on to the agent's next account when one runs out: the person's to turn on (ADR-012). */
    rotates(projectId: string): Effect.Effect<boolean, Failure>
    /** Whether an account is out now, and until when. */
    outAccount(accountId: string): Effect.Effect<Option.Option<Out>, SqlError.SqlError>
    /**
     * The account a session on the agent runs on, of those the project
     * allows: the one given; else the thread's own, while it can; else the
     * first, in the person's order, that isn't signed out and, where the
     * project rotates, isn't out of usage; else the first. Where it doesn't
     * rotate, an account out of usage is still the one work runs on: its
     * limit is handled as the project says (move to another agent, or wait).
     */
    pick(input: {
      readonly agentId: string
      readonly projectId?: string
      readonly threadId?: string
      readonly accountId?: string
    }): Effect.Effect<Account, Failure | NotFound>
    /**
     * The first agent free to take work over, besides those given: signed in
     * on a plan, not out, in the agents' order; one the work would rather not
     * go to (the other step's) only if none else is free. An agent paid per
     * use, on a key, is never moved to unasked: that spends the person's money.
     */
    free(besides: ReadonlyArray<string>, rather?: ReadonlyArray<string>, projectId?: string): Effect.Effect<string | undefined, Failure>
    /**
     * The model an agent takes work over on: the one the plan named for it on
     * the step, else the last it ran in the project, else its own default.
     */
    modelFor(input: {
      readonly agentId: string
      readonly projectId: string
      readonly planned?: { readonly agentId: string; readonly model: string | null }
    }): Effect.Effect<string | null, SqlError.SqlError>
    /**
     * An agent's name, with the account's where it has more than one, and a
     * model's as a list of every agent's models names it, from the agent's
     * latest settings.
     */
    named(
      agentId: string,
      model: string | null,
      accountId?: string | null,
    ): Effect.Effect<{ readonly agent: string; readonly model: string | null }, SqlError.SqlError>
  }
>()('@althar/runtime/Limits') {
  static readonly layer: Layer.Layer<Limits, never, SqlClient.SqlClient | Agents | SignIns | Accounts | Policies> = Layer.effect(
    Limits,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const signIns = yield* SignIns
      const accounts = yield* Accounts
      const policies = yield* Policies

      /** The agent's accounts the project allows, in the person's order: every one, unless its rules name some. */
      const allowed = (agentId: string, projectId?: string) =>
        Effect.gen(function* () {
          const list = yield* accounts.of(agentId)
          if (projectId === undefined) return list
          const only = accountsOf((yield* policies.current(projectId as ProjectId)).rules).only?.[agentId]
          const kept = only === undefined ? list : list.filter((account) => only.includes(account.id))
          // A project left with none of an agent's accounts, as when the one it named was removed, has all of them back.
          return kept.length === 0 ? list : kept
        })

      const outOf = (account: Account) =>
        Effect.gen(function* () {
          const [latest] = yield* sql<{ state: string; windows: string; observedAt: string }>`
            SELECT s.state, s.windows, s.observed_at FROM account_statuses s JOIN principals p ON p.id = s.principal_id
            WHERE p.account_id = ${account.id} ORDER BY s.observed_at DESC LIMIT 1`
          if (latest === undefined || latest.state !== 'limited') return Option.none<Out>()
          const windows = JSON.parse(latest.windows) as ReadonlyArray<{ readonly resetsAt?: string }>
          const resetsAt = windows.find((window) => window.resetsAt !== undefined)?.resetsAt ?? null
          const until = resetsAt ?? new Date(Date.parse(latest.observedAt) + Duration.toMillis(UNKNOWN_RESET)).toISOString()
          return until > (yield* timestamp)
            ? Option.some<Out>({ agentId: account.agentId, accountId: account.id, resetsAt, until })
            : Option.none<Out>()
        })

      /** Whether the project moves work through an agent's accounts (ADR-012); without a project, as if it did. */
      const rotating = (projectId?: string) =>
        projectId === undefined
          ? Effect.succeed(true)
          : Effect.map(policies.current(projectId as ProjectId), ({ rules }) => accountsOf(rules).rotate)

      /**
       * The accounts work on the agent can run on here: those the project
       * allows that aren't signed out. Where the project doesn't rotate, only
       * the first of them, whose being out of usage puts the agent out.
       */
      const runnable = (agentId: string, projectId?: string) =>
        Effect.gen(function* () {
          const rotate = yield* rotating(projectId)
          const found: Array<Account> = []
          for (const account of yield* allowed(agentId, projectId)) {
            if ((yield* signIns.account(account)).status === 'signed_out') continue
            found.push(account)
            if (!rotate) break
          }
          return found
        })

      const out = (agentId: string, projectId?: string) =>
        Effect.gen(function* () {
          const outs: Array<Out> = []
          for (const account of yield* runnable(agentId, projectId)) {
            const found = yield* outOf(account)
            if (Option.isNone(found)) return Option.none<Out>()
            outs.push(found.value)
          }
          return Option.fromUndefinedOr(outs.toSorted((a, b) => a.until.localeCompare(b.until))[0])
        })

      return Limits.of({
        out,
        rotates: (projectId) => Effect.map(policies.current(projectId as ProjectId), ({ rules }) => accountsOf(rules).rotate),
        outAccount: (accountId) =>
          accounts.get(accountId).pipe(
            Effect.flatMap(outOf),
            Effect.catchTag('NotFound', () => Effect.succeed(Option.none<Out>())),
          ),
        pick: (input) =>
          Effect.gen(function* () {
            if (input.accountId !== undefined) return yield* accounts.get(input.accountId)
            const list = yield* allowed(input.agentId, input.projectId)
            const rotate = yield* rotating(input.projectId)
            // One it can run on: not signed out, and, where the project rotates, not out of usage.
            const runs = (account: Account) =>
              Effect.gen(function* () {
                if ((yield* signIns.account(account)).status === 'signed_out') return false
                return !rotate || Option.isNone(yield* outOf(account))
              })
            // A conversation stays on its account only where the project rotates; otherwise work runs on the first, as `out` reads it.
            if (rotate && input.threadId !== undefined) {
              const [last] = yield* sql<{ accountId: string | null }>`
                SELECT account_id FROM provider_sessions WHERE thread_id = ${input.threadId} AND agent_id = ${input.agentId}
                ORDER BY started_at DESC LIMIT 1`
              const own = list.find((account) => account.id === last?.accountId)
              if (own !== undefined && (yield* runs(own))) return own
            }
            for (const account of list) if (yield* runs(account)) return account
            const [first] = list
            return first ?? (yield* new NotFound({ kind: 'account', id: input.agentId }))
          }),
        free: (besides, rather = [], projectId) =>
          Effect.gen(function* () {
            const candidates = agents.list.map((entry) => entry.definition.id).filter((agentId) => !besides.includes(agentId))
            // Those the work would rather not go to come last.
            for (const agentId of [...candidates.filter((id) => !rather.includes(id)), ...candidates.filter((id) => rather.includes(id))]) {
              // Another agent takes work over unasked only on an account its plan pays for.
              for (const account of yield* runnable(agentId, projectId)) {
                if ((yield* signIns.account(account)).paidBy !== 'plan') continue
                if (Option.isNone(yield* outOf(account))) return agentId
              }
            }
            return undefined
          }),
        modelFor: (input) =>
          Effect.gen(function* () {
            if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
            const [last] = yield* sql<{ model: string }>`
              SELECT model FROM provider_sessions WHERE project_id = ${input.projectId} AND agent_id = ${input.agentId} AND model IS NOT NULL
              ORDER BY started_at DESC LIMIT 1`
            return last?.model ?? null
          }),
        named: (agentId, model, accountId = null) =>
          Effect.gen(function* () {
            const name = agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId
            const list = yield* accounts.of(agentId)
            const account = list.find((each) => each.id === accountId)
            const agent = account === undefined || list.length < 2 ? name : `${name} (${account.name})`
            if (model === null) return { agent, model: null }
            const [latest] = yield* sql<{ config: string }>`
              SELECT config FROM provider_sessions WHERE agent_id = ${agentId} ORDER BY started_at DESC LIMIT 1`
            const options =
              latest === undefined ? [] : ((JSON.parse(latest.config) as { options?: ReadonlyArray<ConfigOption> }).options ?? [])
            const offered = options.flatMap((option) => option.choices ?? []).find((choice) => choice.value === model)
            return { agent, model: offered === undefined ? model : modelName(agent, { id: model, name: offered.name }).name }
          }),
      })
    }),
  )
}
