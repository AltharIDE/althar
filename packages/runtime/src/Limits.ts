import { isAgentDefault, modelName, standsFor } from '@althar/contracts'
import {
  type AgentDefinition,
  type ConfigOption,
  leftOf,
  tightestWindow,
  type UsageWindow,
  type WindowKind,
} from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { Clock, Context, Duration, Effect, Layer, Option, Random, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents } from './Config'
import { NotFound } from './errors'
import { accountsOf, accountStrategyOf, Policies, usageLimitOf } from './Policies'
import { timestamp } from './records'
import { SignIns } from './SignIns'
import { type AgentModels, Models } from './Models'
import { ModelFacts } from './ModelFacts'
import { makerOf, modelKey } from './modelMaker'
import { Installs, isInstalled } from './Installs'

/*
 * Usage limits (docs/architecture/03 and 05, ADR-012): which accounts are
 * out, until when, and which account a session runs on. An account is out
 * from the turn that reached its limit until the reset its error gave, or,
 * without one, until its exhausted plan windows reset (or for an hour if
 * unknown), when it is tried again; an agent is out when all its accounts
 * are. What the work does meanwhile is one of the project's rules (Policies):
 * move on (the default), to the agent's next account and
 * then the next free agent; wait for the reset; or ask the person, with who
 * could take it over.
 *
 * Before a limit is reached, the plan's windows as last read (PlanUsage) say
 * how much room each account has: new work follows the project’s account strategy,
 * and an agent whose accounts are all nearly out (under NEARLY_OUT percent of
 * their tightest window) is treated by the same rule for new steps. A step
 * already running is never stopped for it.
 *
 * An account marked out is back before its reset when it shows it works: a
 * reading of its plan taken after, with room in every window, or a turn that
 * completed on it after (`recovered`). That is the one rule every caller goes
 * by, through `outOf`.
 */

/** Why an agent can't take work now. */
export interface Unable {
  /** The agent's name. */
  readonly agent: string
  readonly why: 'signed_out' | 'out' | 'refused'
  /** For `out`: when it is tried again. */
  readonly until?: string
  /** For `refused`: the provider whose sign-in the agent was refused, as the person knows it. */
  readonly provider?: string
}

/**
 * Where work planned for an agent stands: it can run there, another agent on a plan takes it instead (and why the planned one
 * can't), or none can.
 */
export type Standing =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'instead'
      readonly agentId: string
      readonly model: string | null
      readonly accountId: string
      /** Another model than the one planned, as no other way to that one had room. */
      readonly otherModel?: boolean
      readonly because: Unable
    }
  | { readonly kind: 'unable'; readonly unable: Unable }

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
export const roomWords = (room: Room, now: number, reset = true): string =>
  `${Math.floor(room.leftPercent)}% of its ${windowWords(room)} left${!reset || room.resetsAt === null ? '' : `, until ${whenWords(room.resetsAt, now)}`}`

/** Who a thread names in a handover: the model, on its agent, where the model is known (both can change); else the agent. */
export const whoWords = (who: { readonly agent: string; readonly model: string | null }): string =>
  who.model === null ? who.agent : `${who.model} on ${who.agent}`

/** Who takes work over in a handover, and, where it is another model, that none of the ways to the one before had room. */
const takerWords = (to: { readonly agent: string; readonly model: string | null; readonly otherModel?: boolean }): string =>
  to.otherModel === true ? `No other agent has room on that model, so ${whoWords(to)}, a different model,` : whoWords(to)

/**
 * What a thread says when a new step steers clear of an agent that is nearly
 * out: who has how little left, until when, and what Althar does: who takes
 * the step instead, or that it waits for the reset.
 */
export const lowWords = (input: {
  readonly from: string
  readonly room: Room
  /** The time it is said at, which says whether the reset is today. */
  readonly now: number
  readonly step?: keyof typeof outStep
  /** Who takes the step, on which model; `otherModel` where no other way to the model before had room. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean; readonly otherModel?: boolean }
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const work = step?.work ?? 'the step'
  if (input.to !== undefined)
    return `${input.from} has ${roomWords(input.room, input.now)}. ${takerWords(input.to)} takes ${work} instead${
      input.to.ownWork === true && (input.step === 'implement' || input.step === 'review') ? ', with the review by the same maker' : ''
    }.`
  const back = input.room.resetsAt === null ? `until ${input.from} has room again` : `until ${whenWords(input.room.resetsAt, input.now)}`
  return `${input.from} has ${roomWords(input.room, input.now, false)}. ${capitalized(work)} ${step?.waits ?? 'waits'} ${back}.`
}

/** An account that is out: until its reset, if it said, and when it is tried again either way. */
export interface Out {
  readonly agentId: string
  readonly accountId: string
  readonly resetsAt: string | null
  readonly until: string
}

/** When an agent is back, in the words a thread says it at `now`: the time, and the day where it isn't today. */
export const whenWords = (iso: string, now: number): string => {
  const at = new Date(iso)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at)
  if (at.toDateString() === new Date(now).toDateString()) return time
  const day = new Intl.DateTimeFormat(
    undefined,
    Duration.toMillis(Duration.days(6)) > at.getTime() - now ? { weekday: 'long' } : { day: 'numeric', month: 'long' },
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
  /** The time it is said at, which says whether the reset is today. */
  readonly now: number
  /** The step it was on; none outside one. */
  readonly step?: keyof typeof outStep
  /**
   * Who takes over, on which model; `ownWork` where the review and implementation use the same maker; `standsIn` where it
   * leads only until the one out is back, which takes it back then; `otherModel` where no other way to the model before had room.
   */
  readonly to?: {
    readonly agent: string
    readonly model: string | null
    readonly ownWork?: boolean
    readonly standsIn?: boolean
    readonly otherModel?: boolean
  }
  readonly waits?: 'step' | 'message'
  /** The project moves work on, but no other model was free to take it. */
  readonly nothingFree?: boolean
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const out = `${input.from} ran out of usage${step === undefined ? '' : ` ${step.during}`}`
  const back = input.resetsAt === null ? null : whenWords(input.resetsAt, input.now)
  if (input.to !== undefined)
    return `${out}${back === null ? '' : `, until ${back}`}. ${takerWords(input.to)} takes ${step === undefined ? '' : `${step.work} `}over${
      input.to.standsIn === true ? (back === null ? ` until ${input.from} is back` : ' until then') : ''
    }${input.to.ownWork === true && (input.step === 'implement' || input.step === 'review') ? ', with the review by the same maker' : ''}.`
  if (input.waits === undefined) return `${out}${back === null ? '' : `, until ${back}`}.`
  const until = back === null ? `until ${input.from} is back` : `until ${back}`
  if (input.waits === 'message') return `${out}. Your message waits ${until}.`
  const waits = `${step?.work ?? 'the step'} ${step?.waits ?? 'waits'}`
  return input.nothingFree === true ? `${out}. No other model is free: ${waits} ${until}.` : `${out}. ${capitalized(waits)} ${until}.`
}

/**
 * What a thread says when the lead a task was given takes the thread back from the one that stood in for it: it has
 * usage again, or the step it ended without its report is over.
 */
export const backWords = (input: {
  readonly given: { readonly agent: string; readonly model: string | null }
  readonly standIn: { readonly agent: string; readonly model: string | null }
  readonly why?: 'limit' | 'low' | 'stall'
}): string =>
  input.why === 'stall'
    ? `The step ${whoWords(input.standIn)} took over is done: ${whoWords(input.given)} leads again.`
    : `${whoWords(input.given)} has usage again and takes over again from ${whoWords(input.standIn)}.`

/**
 * What a thread says when a step's agent ended twice without its report (once
 * after it was reminded), and Althar handed the step on: who failed, and who
 * takes the work over. Each named by its model where known; by its agent too
 * where the two are the same model, as through two of OpenCode's providers.
 */
export const noReportWords = (input: {
  readonly from: { readonly agent: string; readonly model: string | null }
  readonly to: { readonly agent: string; readonly model: string | null }
  readonly step?: keyof typeof outStep
}): string => {
  const same = input.from.model !== null && input.from.model === input.to.model
  const name = (who: { readonly agent: string; readonly model: string | null }) =>
    who.model === null ? who.agent : same ? `${who.model} on ${who.agent}` : who.model
  const work = input.step === undefined ? 'the step' : outStep[input.step].work
  return `${name(input.from)} ended twice without a report. ${name(input.to)} takes ${work} over.`
}

/**
 * What a thread says when the model work was given is turned off for its agent: it carries on through another agent that
 * has it, or, where none has, which model it goes on instead.
 */
export const routeWords = (input: {
  readonly from: { readonly agent: string; readonly model: string | null }
  /** Where it carries on: the same model through another agent, or (`otherModel`) another model where none has it. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly otherModel?: boolean }
}): string => {
  const off = `${input.from.model ?? 'Its model'} is turned off for ${input.from.agent}`
  if (input.to === undefined) return `${off}, and no other agent with room offers it.`
  if (input.to.otherModel !== true) return `${off}: it carries on through ${input.to.agent}.`
  return `${off}, and no other agent with room offers it, so ${whoWords(input.to)}, a different model, takes the work over.`
}

/** Words that open a sentence. */
export const capitalized = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

export interface ModelChoice {
  readonly agentId: string
  readonly model: string | null
}

export interface Takeover extends ModelChoice {
  readonly ownWork: boolean
  readonly accountId: string
  /** Another model than the one the work was on, as no other way to that one had room. */
  readonly otherModel?: boolean
}

type Failure = SqlError.SqlError | Schema.SchemaError

export class Limits extends Context.Service<
  Limits,
  {
    /**
     * Where work planned for the agent, on the model given (or its default), stands now: its accounts are signed out or
     * out of usage, or its model's provider refused the sign-in, and another agent on a plan can take it, as for any
     * step (`free`), or none can. `other` is the other step's, as `free` takes it.
     */
    standing(input: {
      readonly agentId: string
      readonly model: string | null
      readonly projectId: string
      readonly other?: ModelChoice
      /** The work is a review of `other`'s: never `other` itself, on its agent and model (a lead reviewing its own work). */
      readonly reviewing?: boolean
    }): Effect.Effect<Standing, Failure>
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
     * Whether a lead is spent, and until when: its account (or, with none, every account work could run on) out, as `out`
     * and `outAccount` say, or with no room left on its model by the plan's latest reading, though no limit was hit yet.
     */
    spent(
      lead: { readonly agentId: string; readonly accountId: string | null; readonly model: string | null },
      projectId?: string,
    ): Effect.Effect<Option.Option<Out>, Failure>
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
     * nearly out; else, where the project rotates, follow its account strategy
     * among those not signed out or out of usage; where it doesn't, the first not signed out; else the
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
      /** A sleeping session's account, if the project still allows it and it can run. */
      readonly preferAccountId?: string
      readonly model?: string
      /** Before lowering a model, prefer accounts above this remaining share; fixed-account mode still stays fixed. */
      readonly reserve?: number
    }): Effect.Effect<Account, Failure | NotFound>
    /**
     * The strongest free model on a plan, besides the agents given. Models
     * from the other step's maker come last, even on another agent. Room
     * comes before strength; within five points of the strongest, a known
     * different maker is preferred, then score and preferences. Never spends
     * on a key unasked. The chosen model travels with its agent.
     */
    free(input: {
      readonly besides: ReadonlyArray<string>
      readonly projectId?: string
      readonly withRoom?: boolean
      readonly planned?: ModelChoice
      readonly from?: ModelChoice
      readonly other?: ModelChoice
      /** As `standing`'s: a review never goes to the step it reviews. */
      readonly reviewing?: boolean
    }): Effect.Effect<Takeover | undefined, Failure>
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
     * Whether any of these, as `choices` lists them, could take the work over
     * now: signed in and not out of usage. Paid per use counts: the person may
     * choose to spend their money, so that is a call of theirs.
     */
    canTakeOver(choices: ReadonlyArray<{ readonly agentId: string; readonly accountId: string }>): Effect.Effect<boolean, Failure>
    /**
     * Where work on the agent's model can run: there, unless the person turned the model off for the agent; then the same
     * model through another agent with room (`elsewhere`), or, where none has it, `none`.
     */
    route(input: {
      readonly agentId: string
      readonly model: string | null
      readonly projectId: string
      /** The other step's, where the work is a review of it: the review never goes to it (`standing`'s `reviewing`). */
      readonly reviewing?: ModelChoice
    }): Effect.Effect<
      { readonly kind: 'here' } | { readonly kind: 'elsewhere'; readonly to: Takeover } | { readonly kind: 'none' },
      Failure
    >
    /**
     * Whether two choices run the same model, whichever agents offer it, as the takeover ranking reads it: by the id
     * without its provider, the name as people know it, the list's id, an agent's named default resolved. Read against
     * the agents' models as they are now.
     */
    readonly sameModel: Effect.Effect<(a: ModelChoice, b: ModelChoice) => boolean, SqlError.SqlError>
    /**
     * The strongest free model on the agent, using the takeover ranking.
     * Same-agent account rotation preserves the plan's selected model.
     */
    modelFor(input: {
      readonly agentId: string
      readonly projectId: string
      readonly planned?: { readonly agentId: string; readonly model: string | null }
      /** The step a review reviews: never its agent and model (`standing`'s `reviewing`). */
      readonly reviewing?: ModelChoice
    }): Effect.Effect<string | null, Failure>
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
  static readonly layer: Layer.Layer<
    Limits,
    never,
    SqlClient.SqlClient | Agents | SignIns | Accounts | Policies | Models | ModelFacts | Installs
  > = Layer.effect(
    Limits,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const agents = yield* Agents
      const signIns = yield* SignIns
      const accounts = yield* Accounts
      const policies = yield* Policies
      const models = yield* Models
      const facts = yield* ModelFacts
      const installs = yield* Installs

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
          const errorReset = windows.find((window) => window.resetsAt !== undefined)?.resetsAt
          // Some agents report only that usage ran out. PlanUsage already knows the windows; wait until every exhausted
          // plan-wide window has reset, rather than asking the person or retrying during an exhausted week. Keep expired resets in
          // this calculation so the same reading clears the limit after a restart, instead of inventing another hour.
          const [reading] =
            errorReset === undefined
              ? yield* sql<{ windows: string }>`SELECT windows FROM plan_usage_readings WHERE account_id = ${account.id}`
              : []
          const resets = (reading === undefined ? [] : (JSON.parse(reading.windows) as ReadonlyArray<UsageWindow>))
            .filter((window) => window.model === undefined && window.spend !== true && leftOf(window) <= 0)
            .flatMap((window) =>
              window.resetsAt !== undefined && Date.parse(window.resetsAt) > Date.parse(latest.observedAt) ? [window.resetsAt] : [],
            )
          const resetsAt = errorReset ?? resets.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
          const until = resetsAt ?? new Date(Date.parse(latest.observedAt) + Duration.toMillis(UNKNOWN_RESET)).toISOString()
          if (until <= (yield* timestamp)) return Option.none<Out>()
          // Marked out, and not yet back by its reset: unless the account has shown since that it works again.
          return (yield* recovered(account, latest.observedAt))
            ? Option.none<Out>()
            : Option.some<Out>({ agentId: account.agentId, accountId: account.id, resetsAt, until })
        })

      /**
       * Whether an account has shown that it works again since it was marked out at `since`, before its reset: the person reset
       * their usage, topped up or changed plan. Either a reading of its plan taken after, whose every window that counts (plan-wide
       * or a model's own, not past its reset) was read after and has room, or a turn that completed on it after.
       * The one rule `outOf` ends an out state by, so the model list, picking an account, the pickers and the cards agree.
       */
      const recovered = (account: Account, since: string) =>
        Effect.gen(function* () {
          const [turn] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
            WHERE s.account_id = ${account.id} AND d.state = 'completed' AND d.ended_at > ${since} LIMIT 1`
          if (turn !== undefined) return true
          const [reading] = yield* sql<{ windows: string; observedAt: string }>`
            SELECT windows, observed_at FROM plan_usage_readings WHERE account_id = ${account.id}`
          if (reading === undefined) return false
          const now = yield* Clock.currentTimeMillis
          const after = Date.parse(since)
          // Every window that limits anything counts, a model's own (Opus's week) too: one still full keeps the account out,
          // as the model it limits can't be offered. Money spent past the plan and a window past its reset count for nothing.
          const counted = (JSON.parse(reading.windows) as ReadonlyArray<UsageWindow & { observedAt?: string }>)
            .filter((window) => window.spend !== true)
            .filter((window) => window.resetsAt === undefined || Date.parse(window.resetsAt) > now)
            .map((window) => ({ window, readAt: Date.parse(window.observedAt ?? reading.observedAt) }))
          // A window read before the limit says nothing of whether it still holds; none read since says nothing at all.
          return counted.length > 0 && counted.every((one) => one.readAt > after && leftOf(one.window) > 0)
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

      /** New conversations follow the project's strategy; signed-out and exhausted accounts are skipped by the caller. */
      const byStrategy = (list: ReadonlyArray<Account>, model?: string, projectId?: string, reserve?: number) =>
        Effect.gen(function* () {
          const strategy =
            projectId === undefined ? 'most_room' : accountStrategyOf((yield* policies.current(projectId as ProjectId)).rules)
          const rooms = new Map<string, number>()
          for (const account of list) {
            const room = yield* roomOf(account, model)
            if (Option.isSome(room)) rooms.set(account.id, room.value.leftPercent)
          }
          const ordered = strategy === 'random' ? yield* Random.shuffle(list) : list
          const group = (account: Account) => {
            const left = rooms.get(account.id)
            if (left !== undefined && (reserve === undefined ? left < NEARLY_OUT : left <= reserve)) return 2
            return (strategy === 'least_room' || reserve !== undefined) && left === undefined ? 1 : 0
          }
          return ordered.toSorted((a, b) => {
            if (strategy === 'most_room' && reserve === undefined) return (rooms.get(b.id) ?? NEARLY_OUT) - (rooms.get(a.id) ?? NEARLY_OUT)
            const priority = group(a) - group(b)
            if (priority === 0 && strategy === 'most_room') return (rooms.get(b.id) ?? NEARLY_OUT) - (rooms.get(a.id) ?? NEARLY_OUT)
            if (priority !== 0 || strategy !== 'least_room') return priority
            // Unread accounts follow those with room; accounts already nearly out stay last.
            const difference = (rooms.get(a.id) ?? 0) - (rooms.get(b.id) ?? 0)
            return group(a) === 2 ? -difference : difference
          })
        })

      /**
       * For a model through a provider with a sign-in of its own (OpenCode Go): the accounts that list it working first, then
       * those that don't list it, then those it refused lately, each in the order given. A fresh Go key in a new account is
       * used before an old account's refused one, though the old has the room reading.
       */
      const byProvider = (agentId: string, list: ReadonlyArray<Account>, model?: string) =>
        Effect.gen(function* () {
          if (list.length < 2) return list
          const standing = new Map<string, number>()
          for (const account of list) standing.set(account.id, yield* providerStanding(account, model))
          return list.toSorted((a, b) => (standing.get(a.id) ?? 1) - (standing.get(b.id) ?? 1))
        })
      /** How the model's provider stands on the account: 0 listed and working, 1 not listed or no provider of its own, 2 refused lately. */
      const providerStanding = (account: Account, model?: string) =>
        Effect.gen(function* () {
          const through =
            model === undefined
              ? undefined
              : agents.list.find((entry) => entry.definition.id === account.agentId)?.definition.signIn.providers?.of(model)
          if (through === undefined) return 1
          const row = ((yield* signIns.providers(account, yield* signIns.account(account))) ?? []).find((one) => one.id === through)
          return row === undefined ? 1 : row.refusedAt === null ? 0 : 2
        })

      /** Whether the project moves work through an agent's accounts (ADR-012); without a project, as if it did. */
      const rotating = (projectId?: string) =>
        projectId === undefined
          ? Effect.succeed(true)
          : Effect.map(policies.current(projectId as ProjectId), ({ rules }) => accountsOf(rules).rotate)

      /** A subscription pays for this model, whether on the account or its model's provider. */
      const planPays = (account: Account, model?: string) =>
        Effect.gen(function* () {
          const status = yield* signIns.account(account)
          if (status.paidBy === 'plan') return true
          const providers = agents.list.find((entry) => entry.definition.id === account.agentId)?.definition.signIn.providers
          const through = model === undefined ? undefined : providers?.of(model)
          if (through === undefined || !providers?.plans?.includes(through)) return false
          return ((yield* signIns.providers(account, status)) ?? []).some((one) => one.id === through && one.refusedAt === null)
        })

      /**
       * The accounts work on the agent can run on here: those the project
       * allows that aren't signed out. Where the project doesn't rotate, only the first of them, whose
       * being out of usage puts the agent out.
       */
      const runnable = (agentId: string, projectId?: string) =>
        Effect.gen(function* () {
          const rotate = yield* rotating(projectId)
          const found: Array<Account> = []
          for (const account of yield* allowed(agentId, projectId)) {
            const check = yield* signIns.account(account)
            if (check.status === 'signed_out') continue
            found.push(account)
            if (!rotate) break
          }
          return found
        })

      const preferredModel = (input: {
        readonly agentId: string
        readonly projectId: string
        readonly planned?: { readonly agentId: string; readonly model: string | null }
      }) =>
        Effect.gen(function* () {
          if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
          const [last] = yield* sql<{ model: string }>`
            SELECT model FROM provider_sessions WHERE project_id = ${input.projectId} AND agent_id = ${input.agentId} AND model IS NOT NULL
              AND config IS NOT NULL AND state <> 'failed'
            ORDER BY started_at DESC, rowid DESC LIMIT 1`
          if (last === undefined) return null
          // History includes automatic picks too. Reuse one only while the agent still offers it; otherwise use its own default.
          const offered = (yield* models.catalog).find((one) => one.agentId === input.agentId)
          return offered?.models.some((one) => one.id === last.model && !isAgentDefault(one)) && !offered.blocked.includes(last.model)
            ? last.model
            : null
        })

      /** One ranking for both picking an agent and picking its model. */
      // Which model it is, whichever agent offers it: by the agent's id for it without its provider
      // (`opencode-go/gpt-6.2-sol` is Codex's `gpt-6.2-sol`), by its name as people know it, and by the list's id.
      const modelKeys = (definition: AgentDefinition, model: { readonly id: string; readonly name: string }) => {
        const fact = facts.of(definition, model)
        return [
          `id:${model.id.slice(model.id.lastIndexOf('/') + 1).toLowerCase()}`,
          modelKey(null, definition, model),
          ...(fact === null ? [] : [fact.slug]),
        ]
      }
      /** The keys of the model a choice runs, its agent's named default resolved; none where it isn't known. */
      const choiceKeys = (catalog: ReadonlyArray<AgentModels>, choice: ModelChoice | undefined) => {
        const agent = agents.list.find((entry) => entry.definition.id === choice?.agentId)
        const offered = catalog.find((one) => one.agentId === choice?.agentId)
        // An agent's own default is the model its entry names, where it names one of the agent's.
        const id = standsFor(offered?.models ?? [], choice?.model ?? offered?.model ?? null)
        if (agent === undefined || id === null) return []
        const model = offered?.models.find((one) => one.id === id)
        if (model !== undefined && isAgentDefault(model)) return []
        return modelKeys(agent.definition, model ?? { id, name: id.slice(id.lastIndexOf('/') + 1) })
      }

      const ranked = (input: {
        readonly projectId?: string
        readonly planned?: ModelChoice
        readonly from?: ModelChoice
        readonly other?: ModelChoice
        readonly besides?: ReadonlyArray<string>
        readonly only?: string
        readonly withRoom?: boolean
        readonly reviewing?: boolean
      }) =>
        Effect.gen(function* () {
          const catalog = yield* models.catalog
          const makerFor = (choice: ModelChoice | undefined) => {
            if (choice === undefined) return null
            const agent = agents.list.find((entry) => entry.definition.id === choice.agentId)
            const offered = catalog.find((one) => one.agentId === choice.agentId)
            const model = offered?.models.find((one) => one.id === (choice.model ?? offered.model))
            return makerOf(agent === undefined || model === undefined ? null : facts.of(agent.definition, model), choice.agentId, model)
          }
          const otherMaker = makerFor(input.other)
          const fromMaker = makerFor(input.from ?? input.planned)
          // The model the other step runs, its agent's named Default resolved: the one that is the other step itself.
          const otherOffered = catalog.find((one) => one.agentId === input.other?.agentId)
          const otherId =
            input.other === undefined ? null : standsFor(otherOffered?.models ?? [], input.other.model ?? otherOffered?.model ?? null)
          const fromKeys = choiceKeys(catalog, input.from ?? input.planned)
          const found: Array<
            Takeover & { low: boolean; sameMaker: boolean; sameModel: boolean; isOther: boolean; score: number; preferred: boolean }
          > = []
          for (const entry of agents.list) {
            const agentId = entry.definition.id
            if (
              input.besides?.includes(agentId) ||
              (input.only !== undefined && input.only !== agentId) ||
              !isInstalled(installs, entry.definition)
            )
              continue
            const offered = catalog.find((one) => one.agentId === agentId)
            const preferred =
              input.projectId === undefined
                ? null
                : yield* preferredModel({
                    agentId,
                    projectId: input.projectId,
                    ...(input.planned === undefined ? {} : { planned: input.planned }),
                  })
            const available = (offered?.models ?? []).filter((one) => !offered?.blocked.includes(one.id))
            const known = available.filter((one) => !isAgentDefault(one))
            // A default-only agent can still take work; blocking every offered model cannot.
            const candidates =
              known.length > 0
                ? known
                : available.some(isAgentDefault)
                  ? [{ id: null, name: entry.definition.name }]
                  : offered?.models.length
                    ? []
                    : [{ id: preferred, name: preferred ?? entry.definition.name }]
            for (const model of candidates) {
              const fact = model.id === null ? null : facts.of(entry.definition, { id: model.id, name: model.name })
              const maker = makerOf(fact, agentId, model.id === null ? undefined : { id: model.id, name: model.name })
              const ownWork =
                input.other !== undefined &&
                (otherMaker !== null && maker !== null ? maker === otherMaker : agentId === input.other.agentId)
              // Scores are the same Artificial Analysis indices list_models shows. Coding
              // and agentic weigh equally for a task step; intelligence breaks a tie.
              const score =
                fact === null
                  ? -1
                  : ((fact.coding ?? fact.intelligence ?? -1) + (fact.agentic ?? fact.intelligence ?? -1)) / 2 +
                    (fact.intelligence ?? 0) / 1000
              let room: boolean | undefined
              let accountId: string | undefined
              for (const account of yield* byStrategy(yield* runnable(agentId, input.projectId), model.id ?? undefined, input.projectId)) {
                if (Option.isSome(yield* outOf(account))) continue
                const status = yield* signIns.account(account)
                // A model the agent picks itself goes through the provider of its default.
                const named = model.id ?? offered?.model ?? undefined
                const through = named === undefined ? undefined : entry.definition.signIn.providers?.of(named)
                const providers = through === undefined ? [] : ((yield* signIns.providers(account, status)) ?? [])
                if (providers.some((one) => one.id === through && one.refusedAt !== null)) continue
                if (!(yield* planPays(account, named))) continue
                const reading = yield* roomOf(account, model.id === null ? undefined : `${model.id} ${model.name}`)
                if (Option.isSome(reading) && reading.value.leftPercent <= 0) continue
                const low = nearly(reading)
                if (accountId === undefined || (room === true && !low)) {
                  room = low
                  accountId = account.id
                }
              }
              if (room === undefined || accountId === undefined || (input.withRoom === true && room)) continue
              const sameModel =
                model.id !== null && modelKeys(entry.definition, { id: model.id, name: model.name }).some((key) => fromKeys.includes(key))
              // The other step itself, on its agent and model: a review by the lead, or a lead by its reviewer, checks nothing.
              const isOther =
                input.other !== undefined &&
                agentId === input.other.agentId &&
                (otherId === null || model.id === null || model.id === otherId || model.id === input.other.model)
              if (isOther && input.reviewing === true) continue
              found.push({
                agentId,
                model: model.id,
                ownWork,
                accountId,
                sameMaker: fromMaker !== null && (maker === null || maker === fromMaker),
                sameModel,
                isOther,
                // Said to be another model only where it is known: an agent's own default may be the same one.
                ...(fromKeys.length > 0 && !sameModel && model.id !== null ? { otherModel: true } : {}),
                low: room,
                score,
                preferred: model.id === preferred || (preferred === null && model.id === offered?.model),
              })
            }
          }
          // Within each review/room class, a different maker wins only among
          // models within five score points of its strongest candidate. Compare
          // to that maximum (not pairwise) so the ordering stays transitive.
          const comparable = (candidate: (typeof found)[number]) =>
            candidate.score >=
            Math.max(...found.filter((one) => one.ownWork === candidate.ownWork && one.low === candidate.low).map((one) => one.score)) - 5
          // The model the work was on, on another agent with usage left, before any other: the step stays on the model it
          // was given, a review's maker included, as it was planned so; of those, one not nearly out first. Another model
          // only where none of its ways has room. Every one found has some left: one with none isn't found.
          return found.toSorted(
            (a, b) =>
              Number(a.isOther) - Number(b.isOther) ||
              Number(b.sameModel) - Number(a.sameModel) ||
              Number(a.ownWork) - Number(b.ownWork) ||
              Number(a.low) - Number(b.low) ||
              Number(comparable(b)) - Number(comparable(a)) ||
              Number(a.sameMaker) - Number(b.sameMaker) ||
              b.score - a.score ||
              Number(b.preferred) - Number(a.preferred),
          )
        })

      const modelFor = (input: {
        readonly agentId: string
        readonly projectId: string
        readonly planned?: ModelChoice
        readonly reviewing?: ModelChoice
      }) =>
        Effect.gen(function* () {
          // Same-agent account rotation keeps the step's selected model.
          if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
          const { reviewing, ...rest } = input
          const list = yield* ranked({
            ...rest,
            only: input.agentId,
            ...(reviewing === undefined ? {} : { other: reviewing, reviewing: true }),
          })
          return list[0]?.model ?? (reviewing === undefined ? yield* preferredModel(rest) : null)
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

      const choices = (input: {
        readonly accountId: string | null
        readonly projectId: string
        readonly rather?: ReadonlyArray<string>
        readonly planned?: { readonly agentId: string; readonly model: string | null }
      }) =>
        Effect.gen(function* () {
          const ids = agents.list.map((entry) => entry.definition.id)
          const rather = input.rather ?? []
          const found: Array<{ readonly agentId: string; readonly accountId: string; readonly model: string | null }> = []
          for (const agentId of [...ids.filter((id) => !rather.includes(id)), ...ids.filter((id) => rather.includes(id))]) {
            const model = yield* preferredModel({
              agentId,
              projectId: input.projectId,
              ...(input.planned === undefined ? {} : { planned: input.planned }),
            })
            for (const account of yield* allowed(agentId, input.projectId))
              if (account.id !== input.accountId) found.push({ agentId, accountId: account.id, model })
          }
          return found
        })

      const canTakeOver = (list: ReadonlyArray<{ readonly agentId: string; readonly accountId: string }>) =>
        Effect.gen(function* () {
          for (const choice of list) {
            const account = (yield* accounts.of(choice.agentId)).find((each) => each.id === choice.accountId)
            if (account === undefined || (yield* signIns.account(account)).status === 'signed_out') continue
            if (Option.isNone(yield* outOf(account))) return true
          }
          return false
        })

      /** Why the agent can't take work on the model now; undefined where it can, or has no account to say. */
      const trouble = (agentId: string, projectId: string, model: string | null) =>
        Effect.gen(function* () {
          const definition = agents.list.find((entry) => entry.definition.id === agentId)?.definition
          const agent = definition?.name ?? agentId
          if ((yield* allowed(agentId, projectId)).length === 0) return undefined
          const open = yield* runnable(agentId, projectId)
          if (open.length === 0) return { agent, why: 'signed_out' } as Unable
          const found = yield* out(agentId, projectId)
          if (Option.isSome(found)) return { agent, why: 'out', until: found.value.until } as Unable
          const named = model ?? (yield* models.catalog).find((one) => one.agentId === agentId)?.model ?? null
          const through = named === null ? undefined : definition?.signIn.providers?.of(named)
          if (through === undefined) return undefined
          let provider: string | undefined
          for (const account of open) {
            const row = ((yield* signIns.providers(account, yield* signIns.account(account))) ?? []).find((one) => one.id === through)
            if (row === undefined || row.refusedAt === null) return undefined
            provider = row.name
          }
          return provider === undefined ? undefined : ({ agent, why: 'refused', provider } as Unable)
        })

      const standing = (input: {
        readonly agentId: string
        readonly model: string | null
        readonly projectId: string
        readonly other?: ModelChoice
        readonly reviewing?: boolean
      }) =>
        Effect.gen(function* () {
          const stuck = yield* trouble(input.agentId, input.projectId, input.model)
          if (stuck === undefined) return { kind: 'ok' } as Standing
          // Out of usage, the project's rule says what happens: only `move` takes the work elsewhere; `wait` and `ask` leave it
          // to the run, which holds for the reset or asks the person, as for any task.
          if (stuck.why === 'out' && usageLimitOf((yield* policies.current(input.projectId as ProjectId)).rules) !== 'move')
            return { kind: 'ok' } as Standing
          const [first] = yield* ranked({
            besides: [input.agentId],
            projectId: input.projectId,
            planned: { agentId: input.agentId, model: input.model },
            ...(input.other === undefined ? {} : { other: input.other }),
            ...(input.reviewing === true ? { reviewing: true } : {}),
          })
          return first === undefined
            ? ({ kind: 'unable', unable: stuck } as Standing)
            : ({
                kind: 'instead',
                agentId: first.agentId,
                model: first.model,
                accountId: first.accountId,
                ...(first.otherModel === true ? { otherModel: true } : {}),
                because: stuck,
              } as Standing)
        })

      return Limits.of({
        out,
        standing,
        nearlyOut,
        spent: (lead, projectId) =>
          Effect.gen(function* () {
            const list =
              lead.accountId === null
                ? yield* runnable(lead.agentId, projectId)
                : yield* accounts.get(lead.accountId).pipe(
                    Effect.map((one) => [one]),
                    Effect.catchTag('NotFound', () => Effect.succeed([])),
                  )
            const marked =
              lead.accountId === null
                ? yield* out(lead.agentId, projectId)
                : list[0] === undefined
                  ? Option.none<Out>()
                  : yield* outOf(list[0])
            if (Option.isSome(marked)) return marked
            const empty: Array<Room> = []
            for (const account of list) {
              if (lead.accountId === null && Option.isSome(yield* outOf(account))) continue
              const room = yield* roomOf(account, lead.model ?? undefined)
              if (Option.isNone(room) || room.value.leftPercent > 0) return Option.none<Out>()
              empty.push(room.value)
            }
            // The earliest reset read first; a reading without one last.
            const resetOf = (room: Room) => (room.resetsAt === null ? Number.POSITIVE_INFINITY : Date.parse(room.resetsAt))
            const [first] = empty.toSorted((a, b) => resetOf(a) - resetOf(b))
            if (first === undefined) return Option.none<Out>()
            const until = first.resetsAt ?? new Date((yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.hours(1))).toISOString()
            return Option.some<Out>({ agentId: lead.agentId, accountId: first.accountId, resetsAt: first.resetsAt, until })
          }),
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
              if (given.agentId !== input.agentId) return yield* new NotFound({ kind: 'account', id: input.accountId })
              return given
            }
            const all = yield* allowed(input.agentId, input.projectId)
            const list = all
            const rotate = yield* rotating(input.projectId)
            // One it can run on: not signed out, and, where the project rotates, not out of usage.
            const runs = (account: Account) =>
              Effect.gen(function* () {
                if ((yield* signIns.account(account)).status === 'signed_out') return false
                return !rotate || Option.isNone(yield* outOf(account))
              })
            // Sleeping sessions keep an eligible account even in fixed-account projects. Other starts keep the thread's
            // account only in rotating projects.
            if (input.preferAccountId !== undefined || (rotate && input.threadId !== undefined)) {
              const [last] =
                input.preferAccountId === undefined
                  ? yield* sql<{ accountId: string | null }>`
                    SELECT account_id FROM provider_sessions WHERE thread_id = ${input.threadId} AND agent_id = ${input.agentId}
                    ORDER BY started_at DESC LIMIT 1`
                  : []
              const own = list.find((account) => account.id === (input.preferAccountId ?? last?.accountId))
              // Not where the model's provider refused it lately (OpenCode Go's expired key): another account may have it working.
              if (
                own !== undefined &&
                (yield* runs(own)) &&
                (!rotate ||
                  Option.match(yield* roomOf(own, input.model), {
                    onNone: () => true,
                    onSome: (room) => (input.reserve === undefined ? room.leftPercent >= NEARLY_OUT : room.leftPercent > input.reserve),
                  })) &&
                (yield* providerStanding(own, input.model)) < 2
              )
                return own
            }
            // Where it rotates, follow the saved strategy; otherwise use the first signed-in account.
            const ordered = rotate ? yield* byStrategy(list, input.model, input.projectId, input.reserve) : list
            for (const account of yield* byProvider(input.agentId, ordered, input.model)) if (yield* runs(account)) return account
            const [first] = list
            return first ?? (yield* new NotFound({ kind: 'account', id: input.agentId }))
          }),
        free: (input) =>
          Effect.map(ranked(input), (list) => {
            const first = list[0]
            return first === undefined
              ? undefined
              : {
                  agentId: first.agentId,
                  model: first.model,
                  ownWork: first.ownWork,
                  accountId: first.accountId,
                  ...(first.otherModel === true ? { otherModel: true } : {}),
                }
          }),
        route: (input) =>
          Effect.gen(function* () {
            if (input.model === null) return { kind: 'here' as const }
            // Read as it is kept, not from the agent's models: asking the agent isn't started for it, and a list a moment
            // stale (as Codex's can be) never moves a lead that is fine where it is.
            const [off] = yield* sql<{ model: string }>`
              SELECT model FROM model_blocks WHERE agent_id = ${input.agentId} AND model = ${input.model}`
            if (off === undefined) return { kind: 'here' as const }
            // Turned off there: the same model through another agent with room, never another model unasked.
            const same = (yield* ranked({
              projectId: input.projectId,
              from: { agentId: input.agentId, model: input.model },
              besides: [input.agentId],
              ...(input.reviewing === undefined ? {} : { other: input.reviewing, reviewing: true }),
            })).find((one) => one.sameModel)
            if (same === undefined) return { kind: 'none' as const }
            return {
              kind: 'elsewhere' as const,
              to: { agentId: same.agentId, model: same.model, ownWork: same.ownWork, accountId: same.accountId },
            }
          }),
        choices: (input) => choices(input),
        sameModel: Effect.map(models.catalog, (catalog) => (a: ModelChoice, b: ModelChoice) => {
          const keys = choiceKeys(catalog, a)
          return choiceKeys(catalog, b).some((key) => keys.includes(key))
        }),
        canTakeOver: (list) => canTakeOver(list),
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
            const catalog = (yield* models.catalog).find((one) => one.agentId === agentId)?.models.find((one) => one.id === model)
            return { agent, model: modelName(agent, { id: model, name: catalog?.name ?? offered?.name ?? model }).name }
          }),
      })
    }),
  )
}
