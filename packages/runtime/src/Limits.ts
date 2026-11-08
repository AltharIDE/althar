import { isAgentDefault, modelName } from '@althar/contracts'
import { type ConfigOption, leftOf, tightestWindow, type UsageWindow, type WindowKind } from '@althar/provider-adapters'
import type { ProjectId } from '@althar/domain'
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents } from './Config'
import { NotFound } from './errors'
import { accountsOf, Policies } from './Policies'
import { timestamp } from './records'
import { SignIns } from './SignIns'
import { Models } from './Models'
import { ModelFacts } from './ModelFacts'
import { makerOf } from './modelMaker'
import { Installs, isInstalled } from './Installs'

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

/**
 * An automation's run, which nobody watches, runs only on an account its
 * agent's own status says a plan pays for: never per use, nor where the
 * status can't tell, as Mistral Vibe's can't (docs/plans/automations.md).
 */
export class PlanOnly extends Schema.TaggedError<PlanOnly>()('PlanOnly', { message: Schema.String }) {}

/** Why an automation's run can't run on these accounts, as its history and its task's thread say it. */
export const planOnlyWords = (paidBy: ReadonlyArray<'plan' | 'key' | 'unknown'>) =>
  paidBy.includes('unknown') || paidBy.length === 0
    ? 'Automations run only on a plan for now, and its agent’s plan isn’t known.'
    : 'Automations run only on a plan for now, and its agent pays per use.'

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
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const work = step?.work ?? 'the step'
  if (input.to !== undefined)
    return `${input.from} has ${roomWords(input.room, input.now)}. ${input.to.agent} takes ${work} instead${
      input.to.model === null ? '' : `, on ${input.to.model}`
    }${input.to.ownWork === true && (input.step === 'implement' || input.step === 'review') ? ', with the review by the same maker' : ''}.`
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
  /** Who takes over, on which model; `ownWork` where the review and implementation use the same maker. */
  readonly to?: { readonly agent: string; readonly model: string | null; readonly ownWork?: boolean }
  readonly waits?: 'step' | 'message'
  /** The project moves work on, but no other model was free to take it. */
  readonly nothingFree?: boolean
}): string => {
  const step = input.step === undefined ? undefined : outStep[input.step]
  const out = `${input.from} ran out of usage${step === undefined ? '' : ` ${step.during}`}`
  const back = input.resetsAt === null ? null : whenWords(input.resetsAt, input.now)
  if (input.to !== undefined)
    return `${out}${back === null ? '' : `, until ${back}`}. ${input.to.agent} takes ${step === undefined ? '' : `${step.work} `}over${
      input.to.model === null ? '' : `, on ${input.to.model}`
    }${input.to.ownWork === true && (input.step === 'implement' || input.step === 'review') ? ', with the review by the same maker' : ''}.`
  if (input.waits === undefined) return `${out}${back === null ? '' : `, until ${back}`}.`
  const until = back === null ? `until ${input.from} is back` : `until ${back}`
  if (input.waits === 'message') return `${out}. Your message waits ${until}.`
  const waits = `${step?.work ?? 'the step'} ${step?.waits ?? 'waits'}`
  return input.nothingFree === true ? `${out}. No other model is free: ${waits} ${until}.` : `${out}. ${capitalized(waits)} ${until}.`
}

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

/** Words that open a sentence. */
export const capitalized = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`

export interface ModelChoice {
  readonly agentId: string
  readonly model: string | null
}

export interface Takeover extends ModelChoice {
  readonly ownWork: boolean
  readonly accountId: string
}

type Failure = SqlError.SqlError | Schema.SchemaError

export class Limits extends Context.Service<
  Limits,
  {
    /**
     * Whether the agent is out now, and until when: every account work could
     * run on (in the project, where given: its first, unless it rotates;
     * on the thread, where given: of an automation's run, those on a plan),
     * the soonest back.
     */
    out(agentId: string, projectId?: string, threadId?: string, model?: string): Effect.Effect<Option.Option<Out>, Failure>
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
     * On the thread of an automation's run, only those on a plan count, as for `out`.
     */
    nearlyOut(agentId: string, projectId?: string, model?: string, threadId?: string): Effect.Effect<Option.Option<Room>, Failure>
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
     * A thread of an automation's run, or `planOnly`, runs only on an account
     * on a plan, given or picked: none is PlanOnly.
     */
    pick(input: {
      readonly agentId: string
      readonly projectId?: string
      readonly threadId?: string
      readonly accountId?: string
      readonly model?: string
      readonly planOnly?: boolean
    }): Effect.Effect<Account, Failure | NotFound | PlanOnly>
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
     * The strongest free model on the agent, using the takeover ranking.
     * Same-agent account rotation preserves the plan's selected model.
     */
    modelFor(input: {
      readonly agentId: string
      readonly projectId: string
      readonly planned?: { readonly agentId: string; readonly model: string | null }
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

      /** Whether a thread is one of an automation's run's, whose sessions run on a plan only. */
      const automated = (threadId: string | undefined) =>
        threadId === undefined
          ? Effect.succeed(false)
          : Effect.map(
              sql<{ one: number }>`
                SELECT 1 AS one FROM threads h JOIN automation_occurrences o ON o.task_id = h.task_id WHERE h.id = ${threadId} LIMIT 1`,
              (rows) => rows.length > 0,
            )

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

      /** Accounts a plan pays for on this model; none is PlanOnly, saying why. */
      const onPlan = (list: ReadonlyArray<Account>, model?: string) =>
        Effect.gen(function* () {
          const kept: Array<Account> = []
          const paidBy: Array<'plan' | 'key' | 'unknown'> = []
          for (const account of list) {
            paidBy.push((yield* signIns.account(account)).paidBy)
            if (yield* planPays(account, model)) kept.push(account)
          }
          return kept.length > 0 ? kept : yield* new PlanOnly({ message: planOnlyWords(paidBy) })
        })

      /**
       * The accounts work on the agent can run on here: those the project
       * allows that aren't signed out, and, for an automation's run, are on a
       * plan. Where the project doesn't rotate, only the first of them, whose
       * being out of usage puts the agent out.
       */
      const runnable = (agentId: string, projectId?: string, planOnly = false, model?: string) =>
        Effect.gen(function* () {
          const rotate = yield* rotating(projectId)
          const found: Array<Account> = []
          for (const account of yield* allowed(agentId, projectId)) {
            const check = yield* signIns.account(account)
            if (check.status === 'signed_out' || (planOnly && !(yield* planPays(account, model)))) continue
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
            ORDER BY started_at DESC LIMIT 1`
          return last?.model ?? null
        })

      /** One ranking for both picking an agent and picking its model. */
      const ranked = (input: {
        readonly projectId?: string
        readonly planned?: ModelChoice
        readonly from?: ModelChoice
        readonly other?: ModelChoice
        readonly besides?: ReadonlyArray<string>
        readonly only?: string
        readonly withRoom?: boolean
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
          const found: Array<Takeover & { low: boolean; sameMaker: boolean; score: number; preferred: boolean }> = []
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
              for (const account of yield* byRoom(yield* runnable(agentId, input.projectId), model.id ?? undefined)) {
                if (Option.isSome(yield* outOf(account))) continue
                const status = yield* signIns.account(account)
                const through = model.id === null ? undefined : entry.definition.signIn.providers?.of(model.id)
                const providers = through === undefined ? [] : ((yield* signIns.providers(account, status)) ?? [])
                if (providers.some((one) => one.id === through && one.refusedAt !== null)) continue
                if (!(yield* planPays(account, model.id ?? undefined))) continue
                const reading = yield* roomOf(account, model.id === null ? undefined : `${model.id} ${model.name}`)
                if (Option.isSome(reading) && reading.value.leftPercent <= 0) continue
                const low = nearly(reading)
                if (accountId === undefined || (room === true && !low)) {
                  room = low
                  accountId = account.id
                }
              }
              if (room === undefined || accountId === undefined || (input.withRoom === true && room)) continue
              found.push({
                agentId,
                model: model.id,
                ownWork,
                accountId,
                sameMaker: fromMaker !== null && (maker === null || maker === fromMaker),
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
          return found.toSorted(
            (a, b) =>
              Number(a.ownWork) - Number(b.ownWork) ||
              Number(a.low) - Number(b.low) ||
              Number(comparable(b)) - Number(comparable(a)) ||
              Number(a.sameMaker) - Number(b.sameMaker) ||
              b.score - a.score ||
              Number(b.preferred) - Number(a.preferred),
          )
        })

      const modelFor = (input: { readonly agentId: string; readonly projectId: string; readonly planned?: ModelChoice }) =>
        Effect.gen(function* () {
          // Same-agent account rotation keeps the step's selected model.
          if (input.planned?.agentId === input.agentId && input.planned.model !== null) return input.planned.model
          return (yield* ranked({ ...input, only: input.agentId }))[0]?.model ?? (yield* preferredModel(input))
        })

      const out = (agentId: string, projectId?: string, threadId?: string, model?: string) =>
        Effect.gen(function* () {
          const outs: Array<Out> = []
          for (const account of yield* runnable(agentId, projectId, yield* automated(threadId), model)) {
            const found = yield* outOf(account)
            if (Option.isNone(found)) return Option.none<Out>()
            outs.push(found.value)
          }
          return Option.fromUndefinedOr(outs.toSorted((a, b) => a.until.localeCompare(b.until))[0])
        })

      const nearlyOut = (agentId: string, projectId?: string, model?: string, threadId?: string) =>
        Effect.gen(function* () {
          const low: Array<Room> = []
          for (const account of yield* runnable(agentId, projectId, yield* automated(threadId), model)) {
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
            const planOnly = input.planOnly === true || (yield* automated(input.threadId))
            // One given is the agent's own: another agent's would sign it in as someone else.
            if (input.accountId !== undefined) {
              const given = yield* accounts.get(input.accountId)
              if (given.agentId !== input.agentId) return yield* new NotFound({ kind: 'account', id: input.accountId })
              if (planOnly) yield* onPlan([given], input.model)
              return given
            }
            const all = yield* allowed(input.agentId, input.projectId)
            const list = planOnly ? yield* onPlan(all, input.model) : all
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
              // Not where the model's provider refused it lately (OpenCode Go's expired key): another account may have it working.
              if (
                own !== undefined &&
                (yield* runs(own)) &&
                !nearly(yield* roomOf(own, input.model)) &&
                (yield* providerStanding(own, input.model)) < 2
              )
                return own
            }
            // Where it rotates, the one with the most room; where it doesn't, the first, in the person's order.
            const ordered = rotate ? yield* byRoom(list, input.model) : list
            for (const account of yield* byProvider(input.agentId, ordered, input.model)) if (yield* runs(account)) return account
            const [first] = list
            return first ?? (yield* new NotFound({ kind: 'account', id: input.agentId }))
          }),
        free: (input) =>
          Effect.map(ranked(input), (list) => {
            const first = list[0]
            return first === undefined
              ? undefined
              : { agentId: first.agentId, model: first.model, ownWork: first.ownWork, accountId: first.accountId }
          }),
        choices: (input) =>
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
          }),
        canTakeOver: (choices) =>
          Effect.gen(function* () {
            for (const choice of choices) {
              const account = (yield* accounts.of(choice.agentId)).find((each) => each.id === choice.accountId)
              if (account === undefined || (yield* signIns.account(account)).status === 'signed_out') continue
              if (Option.isNone(yield* outOf(account))) return true
            }
            return false
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
            const catalog = (yield* models.catalog).find((one) => one.agentId === agentId)?.models.find((one) => one.id === model)
            return { agent, model: modelName(agent, { id: model, name: catalog?.name ?? offered?.name ?? model }).name }
          }),
      })
    }),
  )
}
