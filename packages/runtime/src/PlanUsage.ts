import { homedir } from 'node:os'

import type { AccountUsage, PlanUsage as PlanUsageView, UsageFaultKind } from '@althar/contracts'
import {
  adapterNode,
  type AgentDefinition,
  agentVersion,
  type CredentialsRead,
  type EndpointRead,
  majorOf,
  noReadingOf,
  openCodeCannotList,
  planPairOf,
  readAgentUsage,
  readOpenCodeCredentials,
  resolveOpenCodeCredential,
  type UsageAccount,
  usageReader,
  type UsageRead,
  type UsageSource,
  type UsageWindow,
} from '@althar/provider-adapters'
import { Clock, Context, Duration, Effect, Layer, Semaphore } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents, RuntimeConfig } from './Config'
import { Live } from './Live'
import { timestamp } from './records'
import { SignIns } from './SignIns'

/*
 * What each account's plan has left (docs/plans/plan-usage.md), for
 * the window's plan gauge, the pickers and steering (Limits). Where the numbers come from differs by
 * agent and moves to ACP as the adapters speak it:
 *
 * - Claude Code: live, the adapter's `_meta` on its usage updates, each
 *   window the CLI tracks, as its use moves, heard from sessions (`heard`);
 *   and where no session has said for a while, as on an idle account,
 *   Anthropic's usage endpoint with the account's own sign-in (the usage read,
 *   ADR-062), at most every five minutes, waiting as long as it asks. What the
 *   endpoint answers never replaces what a session said since.
 * - Codex: its app-server, asked in the account's home; ChatGPT's usage
 *   endpoint where that can't answer.
 * - Kimi Code and Grok Build: their providers' usage endpoints, with the
 *   account's own sign-in.
 * - OpenCode: its own listing of the account's sign-ins tells plan from key
 *   per provider; no plan's provider is read, and each says why.
 * - The others report no usage anyone can read, and say so calmly
 *   (`usageSources.ts`). Their limits are still recognised when they hit.
 * - An API key has no plan window, and says so.
 *
 * A window whose reset has passed is unknown until it is read again: it has started again, but how much of it is used since
 * no one has said. It is left out of the view, as steering leaves it out of an account's room (`tightestWindow`).
 */

/** The longest a reading is kept before another is taken: a window asking within a minute hears the one before. */
const KEPT = Duration.minutes(1)
/** The shortest time between two readings of an account, even when asked to read again. */
const LEAST = Duration.seconds(5)
/** How long a heard window waits before the view is told, so a turn's windows go out as one and the turn never waits on it. */
const SETTLE = Duration.millis(250)
/**
 * While a session has said its windows this lately, Claude Code's endpoint isn't asked: what was heard is fresher. The CLI
 * says them again each time one's rounded percentage moves, so a session at work says them every few minutes; one quiet
 * this long means the windows have barely moved, or no one is working. As long as the window shows numbers without their age.
 */
const HEARD_LATELY = Duration.minutes(15)

/** What the service is built with in a test: how each source is read, and how often accounts are read on their own. */
export interface PlanUsageOptions {
  /** How Codex's app-server is asked; as it is, unless a test says. */
  readonly readAgent?: (agent: AgentDefinition, home: Readonly<Record<string, string>>) => Promise<UsageRead>
  /** An agent's version as its CLI says it; as it is, unless a test says. OpenCode is listed only on a version known to list its sign-ins. */
  readonly readVersion?: (agent: AgentDefinition) => Promise<string | null>
  /** How a provider's usage endpoint is read with an account's sign-in (ADR-062); the package's reader, unless a test says. */
  readonly readEndpoint?: (sourceId: string, account: UsageAccount, now: () => Date) => Promise<EndpointRead>
  /** How an OpenCode account's sign-ins are listed. */
  readonly readCredentials?: (agent: AgentDefinition, home: Readonly<Record<string, string>>) => Promise<CredentialsRead>
  /** How often accounts are read on their own while the runtime runs: five minutes. Zero turns it off. */
  readonly every?: Duration.Duration
  /** How long a reading is kept before another is taken: a minute. */
  readonly kept?: Duration.Duration
}

interface Held {
  readonly agentId: string
  readonly source: UsageSource | null
  readonly plan: string | null
  readonly windows: ReadonlyArray<UsageWindow>
  readonly observedAt: string | null
  readonly fault: { readonly kind: UsageFaultKind; readonly message: string } | null
  /** How the account is paid for where the agent's status can't say (OpenCode's can't, by account). */
  readonly paidBy?: 'plan' | 'key'
  /** Why it has no reading, where the agent reports none anyone can read: said calmly, not a fault. */
  readonly noReading?: string
}

const keyOf = (window: UsageWindow) => (window.label === undefined ? window.kind : `${window.kind}:${window.label}`)

/** The message a failed Codex read is shown as, and whether the person should sign in again. */
const faultOfRead = (message: string): { kind: UsageFaultKind; message: string } =>
  /not (logged|signed) in|sign in|log in|unauthori[sz]ed|auth/i.test(message)
    ? { kind: 'sign_in_again', message }
    : { kind: 'unreachable', message }

/** Whether a reset time has passed: the window it belongs to has started again. */
const past = (resetsAt: string | null | undefined, now: number) =>
  resetsAt !== null && resetsAt !== undefined && Date.parse(resetsAt) <= now

/** The windows as the view shows them: one whose reset has passed is unknown until it is read again, so it isn't shown. */
const shown = (windows: ReadonlyArray<UsageWindow>, now: number) =>
  windows
    .filter((window) => !past(window.resetsAt, now))
    .map((window) => ({
      kind: window.kind,
      label: window.label ?? null,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt ?? null,
    }))

type Failure = SqlError.SqlError

export class PlanUsage extends Context.Service<
  PlanUsage,
  {
    /** Every account's plan usage; `refresh` asks the sources again first. */
    readonly now: (refresh?: boolean) => Effect.Effect<PlanUsageView, Failure>
    /** The windows Claude Code's adapter reported on a session of the account, from one event. */
    readonly heard: (accountId: string, agentId: string, windows: ReadonlyArray<UsageWindow>) => Effect.Effect<void, never>
  }
>()('@althar/runtime/PlanUsage') {
  static readonly layer: Layer.Layer<PlanUsage, never, SqlClient.SqlClient | Agents | Accounts | SignIns | Live | RuntimeConfig> =
    Layer.effect(
      PlanUsage,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const agents = yield* Agents
        const accounts = yield* Accounts
        const signIns = yield* SignIns
        const live = yield* Live
        const scope = yield* Effect.scope
        const options = (yield* RuntimeConfig).usage ?? {}
        // The runtime's clock, for the readers outside any effect, which read the windows' resets by it.
        const nowAsDate = yield* Clock.clockWith((clock) => Effect.succeed(() => new Date(clock.currentTimeMillisUnsafe())))
        const readAgent =
          options.readAgent ??
          ((agent: AgentDefinition, home: Readonly<Record<string, string>>) =>
            readAgentUsage(agent, { node: adapterNode(), home, now: nowAsDate }))
        const readCredentials =
          options.readCredentials ??
          ((agent: AgentDefinition, home: Readonly<Record<string, string>>) =>
            readOpenCodeCredentials(agent, { node: adapterNode(), home }))
        const readVersion = options.readVersion ?? ((agent: AgentDefinition) => Effect.runPromise(agentVersion(agent, adapterNode())))
        const readEndpoint = options.readEndpoint ?? usageReader.read
        const versions = new Map<string, string | undefined>()
        /* The agent's version as its CLI says it, asked once a launch; unknown stays unknown. */
        const versionOf = (definition: AgentDefinition) =>
          Effect.gen(function* () {
            if (versions.has(definition.id)) return versions.get(definition.id)
            const version = (yield* Effect.promise(() => readVersion(definition).catch(() => null))) ?? undefined
            versions.set(definition.id, version)
            return version
          })
        const agentMajorOf = (definition: AgentDefinition) =>
          Effect.map(versionOf(definition), (version) => (version === undefined ? null : majorOf(version)) ?? undefined)
        /* Windows heard from sessions are kept one at a time, so two heard together don't write over each other. */
        const hearing = Semaphore.makeUnsafe(1)

        const held = new Map<string, Held>()
        const asked = new Map<string, number>()
        /* How many times sessions have said each account's windows: an endpoint's answer to a question asked before the last of them doesn't replace it. */
        const sayings = new Map<string, number>()
        let hydrated = false

        /* What the store kept of the accounts' last readings, once. */
        const hydrate = Effect.gen(function* () {
          if (hydrated) return
          const rows = yield* sql<{
            accountId: string
            agentId: string
            source: string
            plan: string | null
            windows: string
            observedAt: string
          }>`
          SELECT account_id, agent_id, source, plan, windows, observed_at FROM plan_usage_readings`
          for (const row of rows) {
            if (held.has(row.accountId)) continue
            held.set(row.accountId, {
              agentId: row.agentId,
              source: row.source as UsageSource,
              plan: row.plan,
              windows: JSON.parse(row.windows) as ReadonlyArray<UsageWindow>,
              observedAt: row.observedAt,
              fault: null,
            })
          }
          // Only once they are in: a read that failed is tried again by the next one to ask.
          hydrated = true
        })

        const keep = (accountId: string, next: Held) =>
          Effect.gen(function* () {
            held.set(accountId, next)
            // A key has no windows: one read while it was on a plan no longer steers work, nor says it is on one (SignIns).
            if (next.paidBy === 'key') return yield* sql`DELETE FROM plan_usage_readings WHERE account_id = ${accountId}`
            if (next.source === null || next.observedAt === null || next.windows.length === 0) return
            yield* sql`
            INSERT INTO plan_usage_readings ${sql.insert({
              accountId,
              agentId: next.agentId,
              source: next.source,
              plan: next.plan,
              windows: JSON.stringify(next.windows),
              observedAt: next.observedAt,
            })}
            ON CONFLICT (account_id) DO UPDATE SET agent_id = excluded.agent_id, source = excluded.source, plan = excluded.plan,
              windows = excluded.windows, observed_at = excluded.observed_at`
          })

        /* Reads one account from its agent's source and keeps what it said. */
        const readAccount = (account: Account) =>
          Effect.gen(function* () {
            const entry = agents.list.find((each) => each.definition.id === account.agentId)
            if (entry === undefined) return
            const definition = entry.definition
            const check = yield* signIns.account(account)
            const before = held.get(account.id)
            const env = accounts.env(account)
            /* A fault, with the reading held when it is kept: one a session said while the source was asked stays. */
            const fault = (kind: UsageFaultKind, message: string): Held => {
              const last = held.get(account.id)
              return {
                agentId: definition.id,
                source: last?.source ?? null,
                plan: last?.plan ?? null,
                windows: last?.windows ?? [],
                observedAt: last?.observedAt ?? null,
                fault: { kind, message },
              }
            }
            const key: Held = {
              agentId: definition.id,
              source: null,
              plan: null,
              windows: [],
              observedAt: null,
              fault: null,
              paidBy: 'key',
            }
            // Its status says plan, but the sign-in its usage is read with isn't where its agent keeps it: what was heard stays.
            const unfound = fault(
              'no_data_yet',
              definition.id === 'claude-code'
                ? 'Althar couldn’t find this account’s sign-in to read its usage. Its usage shows after its next turn.'
                : 'Althar couldn’t find this account’s sign-in to read its usage.',
            )
            /* What a source read, kept. */
            const read = (usage: {
              readonly source: UsageSource
              readonly plan?: string
              readonly windows: ReadonlyArray<UsageWindow>
              readonly observedAt: string
            }) =>
              keep(account.id, {
                agentId: definition.id,
                source: usage.source,
                plan: usage.plan ?? before?.plan ?? null,
                windows: usage.windows,
                observedAt: usage.observedAt,
                fault: null,
              })
            /*
             * A provider's usage endpoint, read with the account's own sign-in
             * (ADR-062), from the account's home. With no sign-in for it there,
             * `none` says what that is: for Kimi Code, a key; for an agent whose
             * status said plan, a sign-in Althar couldn't find.
             */
            const fromEndpoint = (sourceId: string, provider: string, none: Held) =>
              Effect.gen(function* () {
                const variable = definition.home.variable
                const named = env[variable] ?? process.env[variable]
                const version = yield* versionOf(definition)
                const said = sayings.get(account.id) ?? 0
                const got = yield* Effect.promise(() =>
                  readEndpoint(
                    sourceId,
                    {
                      agent: definition.id,
                      provider,
                      home: env[variable] ?? definition.home.usual(process.env, homedir()),
                      named: named !== undefined && named !== '',
                      ...(version === undefined ? {} : { agentVersion: version }),
                    },
                    nowAsDate,
                  ).catch((): EndpointRead => ({ kind: 'fault', fault: 'unreachable', message: 'The provider could not be reached.' })),
                )
                if (got.kind === 'fault' && got.waiting !== undefined)
                  yield* Effect.logInfo('A usage endpoint asked Althar to wait').pipe(
                    Effect.annotateLogs({ agent: definition.id, retryAfter: got.waiting.retryAfter ?? 'none', until: got.waiting.until }),
                  )
                // Kept one at a time with what sessions say, and against what is held by then: a session may have said its windows meanwhile.
                yield* hearing.withPermits(1)(
                  Effect.gen(function* () {
                    // One did while the endpoint was asked: what it said is fresher than the answer, which may yet come with a later time.
                    if ((sayings.get(account.id) ?? 0) !== said) return
                    if (got.kind === 'usage') {
                      // An answer no newer than what is held, as the reader's own from before it was asked to wait, leaves that as it is.
                      const last = held.get(account.id)
                      if (last?.observedAt != null && Date.parse(got.usage.observedAt) <= Date.parse(last.observedAt))
                        return yield* keep(account.id, { ...last, fault: null })
                      return yield* read(got.usage)
                    }
                    if (got.kind === 'none') return yield* keep(account.id, none)
                    yield* keep(
                      account.id,
                      got.fault === 'expired'
                        ? fault('expired', `Its sign-in has expired. ${definition.name} renews it the next time it runs on this account.`)
                        : fault(got.fault, got.message),
                    )
                  }),
                )
              })
            if (check.status === 'signed_out')
              return yield* keep(account.id, fault('sign_in_again', `Sign in to ${definition.name} to see its usage.`))
            if (definition.id === 'codex') {
              if (check.paidBy === 'key') return yield* keep(account.id, key)
              const asked = yield* Effect.promise(() => readAgent(definition, env))
              if (asked.kind === 'usage') return yield* read(asked.usage)
              if (asked.kind === 'none')
                return yield* keep(account.id, fault('no_data_yet', 'Codex reported no plan window for this account.'))
              const failed = { ...fault('unreachable', asked.message), fault: faultOfRead(asked.message) }
              // Its app-server couldn't answer, for another reason than its sign-in: ChatGPT's own usage endpoint instead.
              return yield* failed.fault.kind === 'sign_in_again'
                ? keep(account.id, failed)
                : fromEndpoint('codex-chatgpt', 'openai', failed)
            }
            if (definition.id === 'claude-code') {
              if (check.paidBy === 'key') return yield* keep(account.id, key)
              // A session said its windows lately: fresher than the endpoint, which limits how often it is asked.
              const lately = (yield* Clock.currentTimeMillis) - Duration.toMillis(HEARD_LATELY)
              if (before?.source === 'acp_extension' && before.observedAt !== null && Date.parse(before.observedAt) > lately) return
              return yield* fromEndpoint('claude-oauth', 'anthropic', unfound)
            }
            if (definition.id === 'opencode') {
              // Its listing is OpenCode 2's: on 1.x the command fails with its help, and what it can list says no plan from a key.
              const cannotList = openCodeCannotList(definition.name, yield* agentMajorOf(definition))
              if (cannotList !== null) return yield* keep(account.id, fault('cannot_classify', cannotList))
              const listed = yield* Effect.promise(() => readCredentials(definition, env))
              if (listed.kind === 'failed') return yield* keep(account.id, fault('cannot_classify', listed.message))
              // A key needs nothing. A plan says why it has no reading, or that its sign-in isn't one Althar knows.
              let unknown: string | undefined
              let unread: string | undefined
              for (const credential of listed.credentials) {
                const resolved = resolveOpenCodeCredential(credential)
                if (resolved.kind !== 'covered')
                  unknown ??= `OpenCode has a ${credential.provider} sign-in whose usage Althar cannot read yet.`
                else if (credential.pays === 'plan') unread ??= noReadingOf(resolved.pair) ?? undefined
              }
              if (unknown !== undefined) return yield* keep(account.id, { ...fault('cannot_classify', unknown), paidBy: 'plan' })
              return yield* keep(account.id, unread === undefined ? key : { ...key, paidBy: 'plan', noReading: unread })
            }
            if (check.paidBy === 'key') return yield* keep(account.id, key)
            const pair = planPairOf(definition.id)
            const endpoint = pair?.sources.find((source) => source.kind === 'endpoint')
            if (pair !== undefined && endpoint?.kind === 'endpoint')
              return yield* fromEndpoint(endpoint.id, pair.provider, pair.classification === 'token' ? key : unfound)
            // It reports no usage anyone can read: it says why, calmly.
            yield* keep(account.id, {
              ...key,
              paidBy: 'plan',
              noReading: (pair === undefined ? null : noReadingOf(pair)) ?? `${definition.name} doesn’t report its usage to other apps.`,
            })
          })

        const readAll = (force: boolean) =>
          Effect.gen(function* () {
            yield* hydrate
            const now = yield* Clock.currentTimeMillis
            let read = 0
            for (const entry of agents.list) {
              // Each account at once: one agent slow to answer (up to its timeout) holds up none of the others.
              const due = (yield* accounts.of(entry.definition.id)).filter((account) => {
                const last = asked.get(account.id)
                if (last !== undefined && now - last < Duration.toMillis(options.kept ?? (force ? LEAST : KEPT))) return false
                asked.set(account.id, now)
                return true
              })
              yield* Effect.forEach(
                due,
                (account) => readAccount(account).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read plan usage', cause))),
                { concurrency: 'unbounded', discard: true },
              )
              read += due.length
            }
            return read
          })

        const view = Effect.gen(function* () {
          yield* hydrate
          const now = yield* Clock.currentTimeMillis
          const list: AccountUsage[] = []
          for (const entry of agents.list) {
            for (const account of yield* accounts.of(entry.definition.id)) {
              const check = yield* signIns.account(account)
              const mine = held.get(account.id)
              const paidBy = mine?.paidBy ?? check.paidBy
              const key = paidBy === 'key'
              const noReading = mine?.noReading ?? null
              // No window and no fault yet, where there is a reading to have, is a fault too: the agent has not been read yet.
              const fault =
                mine?.fault ??
                (key || noReading !== null || (mine?.windows.length ?? 0) > 0
                  ? null
                  : { kind: 'no_data_yet' as const, message: `${entry.definition.name}’s usage hasn’t been read yet.` })
              list.push({
                agentId: entry.definition.id,
                agentName: entry.definition.name,
                accountId: account.id,
                accountName: account.name,
                paidBy,
                source: mine?.source ?? null,
                observedAt: mine?.observedAt ?? null,
                plan: mine?.plan ?? null,
                windows: shown(key ? [] : (mine?.windows ?? []), now),
                fault,
                noReading,
              })
            }
          }
          return { accounts: list } satisfies PlanUsageView
        })

        const told = view.pipe(
          Effect.flatMap((usage) => live.publish({ _tag: 'PlanUsage', usage })),
          Effect.catchCause((cause) => Effect.logWarning('Could not tell plan usage', cause)),
        )

        /* Tells the view a moment from now, in a fiber of its own: windows heard meanwhile go out with it, and what heard them goes on at once. */
        let telling = false
        const tellSoon = Effect.suspend(() => {
          if (telling) return Effect.void
          telling = true
          return Effect.asVoid(
            Effect.forkIn(Effect.sleep(SETTLE).pipe(Effect.andThen(Effect.sync(() => (telling = false))), Effect.andThen(told)), scope),
          )
        })

        const every = options.every ?? Duration.minutes(5)
        // Not at launch: the window reads as it opens, and accounts are read on their own after each wait.
        if (Duration.toMillis(every) > 0)
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.andThen(Effect.sleep(every), Effect.andThen(readAll(false), told)).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not read plan usage', cause)),
              ),
            ),
          )

        return PlanUsage.of({
          // Asked again, it waits for the reading; opened, it answers with what it has, and tells the view again once the accounts are read.
          now: (refresh = false) =>
            refresh
              ? Effect.andThen(readAll(true), view)
              : Effect.andThen(
                  Effect.forkIn(
                    Effect.flatMap(readAll(false), (read) => (read > 0 ? told : Effect.void)),
                    scope,
                  ),
                  view,
                ),
          // One event at a time, so two heard together don't write over each other; the session forks it, and never waits on it.
          heard: (accountId, agentId, said) =>
            hearing
              .withPermits(1)(
                Effect.gen(function* () {
                  yield* hydrate
                  sayings.set(accountId, (sayings.get(accountId) ?? 0) + 1)
                  const before = held.get(accountId)
                  const at = yield* timestamp
                  // Each window said replaces its own, and the others stay as last said.
                  const named = new Set(said.map(keyOf))
                  const windows = [...(before?.windows ?? []).filter((each) => !named.has(keyOf(each))), ...said]
                  yield* keep(accountId, {
                    agentId,
                    source: 'acp_extension',
                    plan: before?.plan ?? null,
                    windows,
                    observedAt: at,
                    fault: null,
                  })
                  yield* tellSoon
                }),
              )
              .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep a plan window', cause))),
        })
      }),
    )
}
