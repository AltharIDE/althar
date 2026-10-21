import { modelName } from '@althar/contracts'
import { type ConfigOption, leftOf, tightestWindow, type UsageWindow, type WindowKind } from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { Clock, Context, Duration, Effect, Layer, Option, type Schema } from 'effect'
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
 * then the next free agent; wait for the reset; or ask the person, with who
 * could take it over.
 *
 * Before a limit is reached, the plan's windows as last read (PlanUsage) say
 * how much room each account has: work starts on the account with the most,
 * and an agent whose accounts are all nearly out (under NEARLY_OUT percent of
 * their tightest window) is treated by the same rule for new steps. A step
 * already running is never stopped for it.
 */

/** How long an agent whose limit gave no reset time counts as out. */
const UNKNOWN_RESET = Duration.hours(1)

/** Under this share of its tightest window left, an account is nearly out: new steps go elsewhere, as the project's rule says. */
export const NEARLY_OUT = 5

/** How much room an account's plan has: its tightest window as last read. */
export interface Room {
  readonly agentId: string
  readonly accountId: string
  /** 0 to 100. */
  readonly leftPercent: number
  readonly resetsAt: string | null
  readonly kind: WindowKind
  /** The agent's name for the window, where it gave one: a model's. */
  readonly label: string | null
}

/** A window as a sentence names it: "five-hour limit", "weekly Opus limit". */
export const windowWords = (room: Pick<Room, 'kind' | 'label'>): string => {
  const length = { five_hour: 'five-hour', weekly: 'weekly', monthly: 'monthly', other: '' }[room.kind]
  const named = [length, room.label ?? ''].filter((word) => word !== '').join(' ')
  return /\blimit$/i.test(named) ? named : `${named} limit`.trim()
}

/** How much an account has left, as a thread says it: "3% of its five-hour limit left, until 14:00", or without the reset. */
export const roomWords = (room: Room, reset = true): string =>
  `${Math.floor(room.leftPercent)}% of its ${windowWords(room)} left${!reset || room.resetsAt === null ? '' : `, until ${whenWords(room.resetsAt)}`}`

/**
 * What a thread says when a new step steers clear of an agent that is nearly
 * out: who has how little left, until when, and what Althar does: who takes
 * the step instead, or that it waits for the reset.
 */
export const lowWords = (input: {
  readonly from: string
  readonly room: Room
  readonly step?: keyof typeof outStep
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const work = step?.work ?? 'the step'
  if (input.to !== undefined)
    return `${input.from} has ${roomWords(input.room)}, so ${input.to.agent} takes ${work} instead${
      input.to.model === null ? '' : `, on ${input.to.model}`
    }${input.to.ownWork === true ? ', and reviews its own work' : ''}.`
  const back = input.room.resetsAt === null ? `until ${input.from} has room again` : `until ${whenWords(input.room.resetsAt)}`
  return `${input.from} has ${roomWords(input.room, false)}, so ${work} ${step?.waits ?? 'waits'} ${back}. To carry on now, pick another model on the task.`
}

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

/** A step a usage limit stopped, as a thread says it: while it was at it, and the work that waits or moves. */
export const outStep = {
  implement: { during: 'while working on the task', work: 'the work', waits: 'waits' },
  settle: { during: 'while fixing what the review found', work: 'the fixes', waits: 'wait' },
  review: { during: 'during the review', work: 'the review', waits: 'waits' },
} as const

/**
 * What a thread says when an agent is out of usage: who, on which step, until
 * when, and what Althar does about it: who takes the work over, or that it
 * waits, and, for a step, that the person can pick another model meanwhile.
 */
export const outWords = (input: {
  readonly from: string
  readonly resetsAt: string | null
  /** The step it was on; none outside one. */
  readonly step?: keyof typeof outStep
  /** Who takes over, on which model; `ownWork` where it is the other step's agent, so it reviews what it wrote. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
  readonly waits?: 'step' | 'message'
  /** The project moves work on, but no other model was free to take it. */
  readonly nothingFree?: boolean
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const out = `${input.from} ran out of usage${step === undefined ? '' : ` ${step.during}`}`
  const back = input.resetsAt === null ? null : whenWords(input.resetsAt)
  if (input.to !== undefined)
    return `${out}${back === null ? '' : `, until ${back}`}. ${input.to.agent} takes ${step === undefined ? '' : `${step.work} `}over${
      input.to.model === null ? '' : `, on ${input.to.model}`
    }${input.to.ownWork === true ? ', and reviews its own work' : ''}.`
  if (input.waits === undefined) return `${out}${back === null ? '' : `, until ${back}`}.`
  const until = back === null ? `until ${input.from} is back` : `until ${back}, when ${input.from} is back`
  if (input.waits === 'message') return `${out}. Your message waits ${until}.`
  const waits = `${step?.work ?? 'the step'} ${step?.waits ?? 'waits'}`
  return input.nothingFree === true
    ? `${out}. No other model was free, so ${waits} ${until}. Pick one on the task to carry on now.`
    : `${out}. ${capitalized(waits)} ${until}. To carry on now, pick another model on the task.`
}

/** Words that open a sentence. */
export const capitalized = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

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
    /** How much room an account's plan has, for a model where named: its tightest window as last read; none where nothing is read. */
    room(accountId: string, model?: string): Effect.Effect<Option.Option<Room>, SqlError.SqlError>
    /**
     * Whether a new step on the agent should steer clear of it: every
     * account work could run on here is out or nearly out, and one is only
     * nearly out (one that is all out is `out`'s). The one with the most
     * room left, to say how little; none where any has room, or isn't read.
     */
    nearlyOut(agentId: string, projectId?: string, model?: string): Effect.Effect<Option.Option<Room>, Failure>
    /**
     * The account a session on the agent runs on, of those the project
     * allows: the one given; else the thread's own, while it can and isn't
     * nearly out; else, where the project rotates, the one with the most
     * room that isn't signed out or out of usage (the person's order where
     * none is read); where it doesn't, the first not signed out; else the
     * first. Room is for the model where named, so a model's own window
     * (Opus's week) counts. Where it doesn't
     * rotate, an account out of usage is still the one work runs on: its
     * limit is handled as the project says (move to another agent, or wait).
     */
    pick(input: {
      readonly agentId: string
      readonly projectId?: string
      readonly threadId?: string
      readonly accountId?: string
      readonly model?: string
    }): Effect.Effect<Account, Failure | NotFound>
    /**
     * The first agent free to take work over, besides those given: signed in
     * on a plan, not out, in the agents' order; one the work would rather not
     * go to (the other step's) only if none else is free. One with room comes
     * before one nearly out, which is taken only where `withRoom` isn't asked.
     * An agent paid per use, on a key, is never moved to unasked: that spends
     * the person's money.
     */
    free(
      besides: ReadonlyArray<string>,
      rather?: ReadonlyArray<string>,
      projectId?: string,
      withRoom?: boolean,
    ): Effect.Effect<string | undefined, Failure>
    /**
     * Who could take over work a usage limit stopped, as the person picks
     * (the project's rule asks): every account of every agent the project
     * allows but the one out, in the agents' order and the person's, those
     * the work would rather not go to (the other step's) last, each with the
     * model it would run. Signed out, out of usage or paid per use, an
     * account is still listed, as it stood: the window says which are free
     * when it asks, and the person's choice may spend their money.
     */
    choices(input: {
      readonly accountId: string | null
      readonly projectId: string
      readonly rather?: ReadonlyArray<string>
      readonly planned?: { readonly agentId: string; readonly model: string | null }
    }): Effect.Effect<ReadonlyArray<{ readonly agentId: string; readonly accountId: string; readonly model: string | null }>, Failure>
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

      /** An account's room, from the windows PlanUsage last kept for it: a window past its reset has started again. */
      const roomOf = (account: Pick<Account, 'id' | 'agentId'>, model?: string) =>
        Effect.gen(function* () {
          const [reading] = yield* sql<{ windows: string }>`SELECT windows FROM plan_usage_readings WHERE account_id = ${account.id}`
          if (reading === undefined) return Option.none<Room>()
          const tightest = tightestWindow(JSON.parse(reading.windows) as ReadonlyArray<UsageWindow>, yield* Clock.currentTimeMillis, model)
          return tightest === undefined
            ? Option.none<Room>()
            : Option.some<Room>({
                agentId: account.agentId,
                accountId: account.id,
                leftPercent: leftOf(tightest),
                resetsAt: tightest.resetsAt ?? null,
                kind: tightest.kind,
                label: tightest.label ?? null,
              })
        })

      const nearly = (room: Option.Option<Room>) => Option.isSome(room) && room.value.leftPercent < NEARLY_OUT

      /** Accounts with the most room first, for the model where named; one not read goes just above one nearly out, and the person's order breaks ties. */
      const byRoom = (list: ReadonlyArray<Account>, model?: string) =>
        Effect.gen(function* () {
          const rooms = new Map<string, number>()
          for (const account of list)
            rooms.set(
              account.id,
              Option.match(yield* roomOf(account, model), { onNone: () => NEARLY_OUT, onSome: (room) => room.leftPercent }),
            )
          return list.toSorted((a, b) => (rooms.get(b.id) ?? 0) - (rooms.get(a.id) ?? 0))
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

      const modelFor = (input: {
        readonly agentId: string
        readonly projectId: string
        readonly planned?: { readonly agentId: string; readonly model: string | null }
      }) =>
        Effect.gen(function* () {
          if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
          const [last] = yield* sql<{ model: string }>`
            SELECT model FROM provider_sessions WHERE project_id = ${input.projectId} AND agent_id = ${input.agentId} AND model IS NOT NULL
            ORDER BY started_at DESC LIMIT 1`
          return last?.model ?? null
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

      const nearlyOut = (agentId: string, projectId?: string, model?: string) =>
        Effect.gen(function* () {
          const low: Array<Room> = []
          for (const account of yield* runnable(agentId, projectId)) {
            if (Option.isSome(yield* outOf(account))) continue
            const room = yield* roomOf(account, model)
            if (!nearly(room)) return Option.none<Room>()
            low.push(Option.getOrThrow(room))
          }
          return Option.fromUndefinedOr(low.toSorted((a, b) => b.leftPercent - a.leftPercent)[0])
        })

      return Limits.of({
        out,
        nearlyOut,
        room: (accountId, model) =>
          accounts.get(accountId).pipe(
            Effect.flatMap((account) => roomOf(account, model)),
            Effect.catchTag('NotFound', () => Effect.succeed(Option.none<Room>())),
          ),
        rotates: (projectId) => Effect.map(policies.current(projectId as ProjectId), ({ rules }) => accountsOf(rules).rotate),
        outAccount: (accountId) =>
          accounts.get(accountId).pipe(
            Effect.flatMap(outOf),
            Effect.catchTag('NotFound', () => Effect.succeed(Option.none<Out>())),
          ),
        pick: (input) =>
          Effect.gen(function* () {
            // One given is the agent's own: another agent's would sign it in as someone else.
            if (input.accountId !== undefined) {
              const given = yield* accounts.get(input.accountId)
              return given.agentId === input.agentId ? given : yield* new NotFound({ kind: 'account', id: input.accountId })
            }
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
              if (own !== undefined && (yield* runs(own)) && !nearly(yield* roomOf(own, input.model))) return own
            }
            // Where it rotates, the one with the most room; where it doesn't, the first, in the person's order.
            for (const account of rotate ? yield* byRoom(list, input.model) : list) if (yield* runs(account)) return account
            const [first] = list
            return first ?? (yield* new NotFound({ kind: 'account', id: input.agentId }))
          }),
        free: (besides, rather = [], projectId, withRoom = false) =>
          Effect.gen(function* () {
            const candidates = agents.list.map((entry) => entry.definition.id).filter((agentId) => !besides.includes(agentId))
            // The first nearly out, taken only where none has room.
            let low: string | undefined
            // Those the work would rather not go to come last.
            for (const agentId of [...candidates.filter((id) => !rather.includes(id)), ...candidates.filter((id) => rather.includes(id))]) {
              // Another agent takes work over unasked only on an account its plan pays for.
              for (const account of yield* runnable(agentId, projectId)) {
                if ((yield* signIns.account(account)).paidBy !== 'plan') continue
                if (Option.isSome(yield* outOf(account))) continue
                if (!nearly(yield* roomOf(account))) return agentId
                low ??= agentId
              }
            }
            return withRoom ? undefined : low
          }),
        choices: (input) =>
          Effect.gen(function* () {
            const ids = agents.list.map((entry) => entry.definition.id)
            const rather = input.rather ?? []
            const found: Array<{ readonly agentId: string; readonly accountId: string; readonly model: string | null }> = []
            for (const agentId of [...ids.filter((id) => !rather.includes(id)), ...ids.filter((id) => rather.includes(id))]) {
              const model = yield* modelFor({
                agentId,
                projectId: input.projectId,
                ...(input.planned === undefined ? {} : { planned: input.planned }),
              })
              for (const account of yield* allowed(agentId, input.projectId))
                if (account.id !== input.accountId) found.push({ agentId, accountId: account.id, model })
            }
            return found
          }),
        modelFor,
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
