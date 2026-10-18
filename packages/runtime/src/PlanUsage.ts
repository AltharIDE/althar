import { homedir } from 'node:os'
import { join } from 'node:path'

import type { AccountUsage, PlanUsage as PlanUsageView, UsageFaultKind, UsageWarning } from '@althar/contracts'
import {
  adapterNode,
  type AgentDefinition,
  agentVersion,
  type CredentialsRead,
  type EndpointRead,
  majorOf,
  nextWarning,
  openCodeCannotList,
  readAgentUsage,
  readOpenCodeCredentials,
  resolveOpenCodeCredential,
  type UsageAccount,
  type UsageRead,
  usageReader,
  type UsagePair,
  type UsageSource,
  type UsageWindow,
  type WarningState,
} from '@althar/provider-adapters'
import { Context, Duration, Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Agents, RuntimeConfig } from './Config'
import { Live } from './Live'
import { timestamp } from './records'
import { SignIns } from './SignIns'

/*
 * What each account's plan has left (docs/plans/plan-usage.md, ADR-048), for
 * the usage tab and the warnings. Where the numbers come from differs by
 * agent and moves to ACP as the adapters speak it:
 *
 * - Claude Code: the adapter's `_meta` on its usage updates, one window per
 *   event, heard from sessions (`heard`). It says a window only when its
 *   limits change, so what it last said is kept, in the store, and shown with
 *   its age.
 * - Codex: its app-server, asked in the account's home.
 * - OpenCode: its own listing of the account's sign-ins tells plan from key
 *   per provider; a plan's provider is read from its endpoint under the usage
 *   read, which refuses every endpoint until a spike has confirmed it. An
 *   account that can't be read is a fault on the tab, never an empty row.
 * - An API key has no plan window, and says so.
 *
 * A warning is told at 50, 25, 10 and 5 percent left, once per account,
 * window and reset (provider-adapters' `nextWarning`), kept in the store so a
 * restart does not tell it again, until the person has seen it.
 */

/** The longest a reading is kept before another is taken: a window asking within a minute hears the one before. */
const KEPT = Duration.minutes(1)
/** The shortest time between two readings of an account, even when asked to read again. */
const LEAST = Duration.seconds(5)

/** What the service is built with in a test: how each source is read, and how often accounts are read on their own. */
export interface PlanUsageOptions {
  /** How Codex's app-server is asked; as it is, unless a test says. */
  readonly readAgent?: (agent: AgentDefinition, home: Readonly<Record<string, string>>) => Promise<UsageRead>
  /** An agent's version as its CLI says it; as it is, unless a test says. A source for one major version is read only for a version known to match. */
  readonly readVersion?: (agent: AgentDefinition) => Promise<string | null>
  /** How an OpenCode account's sign-ins are listed. */
  readonly readCredentials?: (agent: AgentDefinition, home: Readonly<Record<string, string>>) => Promise<CredentialsRead>
  /** How a plan provider's endpoint is read (the usage read); the reader of the package, unless a test says. */
  readonly readEndpoint?: (sourceId: string, account: UsageAccount) => Promise<EndpointRead>
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
}

const keyOf = (window: UsageWindow) => (window.label === undefined ? window.kind : `${window.kind}:${window.label}`)

/** The message a failed Codex read is shown as, and whether the person should sign in again. */
const faultOfRead = (message: string): { kind: UsageFaultKind; message: string } =>
  /not (logged|signed) in|sign in|log in|unauthori[sz]ed|auth/i.test(message)
    ? { kind: 'sign_in_again', message }
    : { kind: 'unreachable', message }

const shown = (window: UsageWindow) => ({
  kind: window.kind,
  label: window.label ?? null,
  usedPercent: window.usedPercent,
  resetsAt: window.resetsAt ?? null,
})

type Failure = SqlError.SqlError

export class PlanUsage extends Context.Service<
  PlanUsage,
  {
    /** Every account's plan usage and the warnings not yet seen; `refresh` asks the sources again first. */
    readonly now: (refresh?: boolean) => Effect.Effect<PlanUsageView, Failure>
    /** A window Claude Code's adapter reported on a session of the account. */
    readonly heard: (accountId: string, agentId: string, window: UsageWindow) => Effect.Effect<void, never>
    /** The person has seen these warnings. */
    readonly acknowledge: (
      warnings: ReadonlyArray<{ readonly accountId: string; readonly windowKey: string }>,
    ) => Effect.Effect<void, Failure>
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
        const options = (yield* RuntimeConfig).usage ?? {}
        const readAgent =
          options.readAgent ??
          ((agent: AgentDefinition, home: Readonly<Record<string, string>>) => readAgentUsage(agent, { node: adapterNode(), home }))
        const readCredentials =
          options.readCredentials ??
          ((agent: AgentDefinition, home: Readonly<Record<string, string>>) =>
            readOpenCodeCredentials(agent, { node: adapterNode(), home }))
        const readVersion = options.readVersion ?? ((agent: AgentDefinition) => Effect.runPromise(agentVersion(agent, adapterNode())))
        const majors = new Map<string, number | undefined>()
        /* The agent's major version, asked once a launch; unknown stays unknown, which the usage read refuses. */
        const agentMajorOf = (definition: AgentDefinition) =>
          Effect.gen(function* () {
            if (majors.has(definition.id)) return majors.get(definition.id)
            const version = yield* Effect.promise(() => readVersion(definition).catch(() => null))
            const known = (version === null ? null : majorOf(version)) ?? undefined
            majors.set(definition.id, known)
            return known
          })
        const readEndpoint = options.readEndpoint ?? ((sourceId: string, account: UsageAccount) => usageReader.read(sourceId, account))

        const held = new Map<string, Held>()
        const asked = new Map<string, number>()
        let hydrated = false

        /* What the store kept of the accounts' last readings, once. */
        const hydrate = Effect.gen(function* () {
          if (hydrated) return
          hydrated = true
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
        })

        const keep = (accountId: string, next: Held) =>
          Effect.gen(function* () {
            held.set(accountId, next)
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

        /* Tells the warning a window's use calls for, if any, and keeps what was told. */
        const warn = (accountId: string, windows: ReadonlyArray<UsageWindow>) =>
          Effect.gen(function* () {
            for (const window of windows) {
              const windowKey = keyOf(window)
              const [row] = yield* sql<{ threshold: number; resetsAt: string | null }>`
              SELECT threshold, resets_at FROM plan_usage_warnings WHERE account_id = ${accountId} AND window_key = ${windowKey}`
              const before: WarningState | undefined =
                row === undefined ? undefined : { resetsAt: row.resetsAt ?? undefined, firedAt: row.threshold }
              const step = nextWarning(window.usedPercent, window.resetsAt, before)
              if (step.warn !== undefined) {
                const raisedAt = yield* timestamp
                yield* sql`
                INSERT INTO plan_usage_warnings ${sql.insert({ accountId, windowKey, threshold: step.warn, resetsAt: window.resetsAt ?? null, raisedAt, acknowledgedAt: null })}
                ON CONFLICT (account_id, window_key) DO UPDATE SET threshold = excluded.threshold, resets_at = excluded.resets_at,
                  raised_at = excluded.raised_at, acknowledged_at = NULL`
              } else if (row !== undefined && (row.resetsAt ?? undefined) !== window.resetsAt) {
                // A new reset period without a threshold crossed: armed again.
                yield* sql`DELETE FROM plan_usage_warnings WHERE account_id = ${accountId} AND window_key = ${windowKey}`
              }
            }
          })

        const homeDirOf = (definition: AgentDefinition, account: Account) =>
          definition.home.usual({ ...process.env, ...accounts.env(account) }, homedir())

        /* Reads one account from its agent's source and keeps what it said. */
        const readAccount = (account: Account) =>
          Effect.gen(function* () {
            const entry = agents.list.find((each) => each.definition.id === account.agentId)
            if (entry === undefined) return
            const definition = entry.definition
            const check = yield* signIns.account(account)
            const before = held.get(account.id)
            const home = accounts.env(account)
            const fault = (kind: UsageFaultKind, message: string): Held => ({
              agentId: definition.id,
              source: before?.source ?? null,
              plan: before?.plan ?? null,
              windows: before?.windows ?? [],
              observedAt: before?.observedAt ?? null,
              fault: { kind, message },
            })
            if (check.status === 'signed_out')
              return yield* keep(account.id, fault('sign_in_again', `Sign in to ${definition.name} to see its usage.`))
            if (definition.id === 'codex') {
              if (check.paidBy === 'key')
                return yield* keep(account.id, {
                  agentId: definition.id,
                  source: null,
                  plan: null,
                  windows: [],
                  observedAt: null,
                  fault: null,
                  paidBy: 'key',
                })
              const read = yield* Effect.promise(() => readAgent(definition, home))
              if (read.kind === 'usage') {
                yield* keep(account.id, {
                  agentId: definition.id,
                  source: read.usage.source,
                  plan: read.usage.plan ?? null,
                  windows: read.usage.windows,
                  observedAt: read.usage.observedAt,
                  fault: null,
                })
                yield* warn(account.id, read.usage.windows)
              } else
                yield* keep(
                  account.id,
                  read.kind === 'none'
                    ? fault('no_data_yet', 'Codex reported no plan window for this account.')
                    : { ...fault('unreachable', read.message), fault: faultOfRead(read.message) },
                )
              return
            }
            if (definition.id === 'opencode') {
              // The usage read opens the agent's credential file in this process. Where the agent lives out on the device (a Flatpak's host) the helper ADR-048 asks for is not built, so a plan's endpoint is refused there rather than read from the wrong place.
              const onDevice =
                definition.signIn.credentials?.(adapterNode()).onDevice !== undefined ||
                definition.launch(adapterNode()).onDevice !== undefined
              // Its listing is OpenCode 2's: on 1.x the command fails with its help, and what it can list says no plan from a key.
              const agentMajor = yield* agentMajorOf(definition)
              const cannotList = openCodeCannotList(definition.name, agentMajor)
              if (cannotList !== null) return yield* keep(account.id, fault('cannot_classify', cannotList))
              const listed = yield* Effect.promise(() => readCredentials(definition, home))
              if (listed.kind === 'failed') return yield* keep(account.id, fault('cannot_classify', listed.message))
              // Each plan sign-in with the pair that covers it, or none where it is not declared; a key needs nothing.
              const plans: Array<{ credential: (typeof listed.credentials)[number]; pair: UsagePair | null }> = []
              for (const credential of listed.credentials) {
                const resolved = resolveOpenCodeCredential(credential)
                if (resolved.kind !== 'covered') plans.push({ credential, pair: null })
                else if (credential.pays === 'plan') plans.push({ credential, pair: resolved.pair })
              }
              if (plans.length === 0)
                return yield* keep(account.id, {
                  agentId: definition.id,
                  source: null,
                  plan: null,
                  windows: [],
                  observedAt: null,
                  fault: null,
                  paidBy: 'key',
                })
              const windows: UsageWindow[] = []
              let observed: string | null = null
              let failed: { kind: UsageFaultKind; message: string } | null = null
              for (const { credential, pair } of plans) {
                if (pair === null) {
                  failed ??= {
                    kind: 'cannot_classify',
                    message: `OpenCode has a ${credential.provider} sign-in whose usage Althar cannot read yet.`,
                  }
                  continue
                }
                const source = pair.sources.find((each) => each.kind === 'endpoint')
                if (source === undefined || source.kind !== 'endpoint') {
                  failed ??= { kind: 'no_source', message: `OpenCode's ${credential.provider} sign-in has no usage source yet.` }
                  continue
                }
                if (onDevice) {
                  failed ??= {
                    kind: 'no_source',
                    message: `${definition.name}'s ${credential.provider} usage cannot be read yet where it runs on the device (a Flatpak): the on-device read is not built.`,
                  }
                  continue
                }
                const read = yield* Effect.promise(() =>
                  readEndpoint(source.id, {
                    agent: 'opencode',
                    provider: credential.provider,
                    home: join(homeDirOf(definition, account), 'opencode'),
                    ...(agentMajor === undefined ? {} : { agentMajor }),
                  }),
                )
                if (read.kind === 'usage') {
                  windows.push(...read.usage.windows.map((window) => ({ ...window, label: window.label ?? credential.provider })))
                  // As old as the reader says: a reading it kept is not newly fetched.
                  if (observed === null || read.usage.observedAt < observed) observed = read.usage.observedAt
                } else failed ??= { kind: read.fault, message: read.message }
              }
              yield* keep(account.id, {
                agentId: definition.id,
                source: windows.length > 0 ? 'endpoint' : null,
                plan: null,
                windows: windows.length > 0 ? windows : (before?.windows ?? []),
                observedAt: windows.length > 0 ? observed : (before?.observedAt ?? null),
                fault: failed,
                paidBy: 'plan',
              })
              if (windows.length > 0) yield* warn(account.id, windows)
            }
          })

        const readAll = (force: boolean) =>
          Effect.gen(function* () {
            yield* hydrate
            const now = Date.now()
            for (const entry of agents.list) {
              if (entry.definition.id === 'claude-code') continue
              for (const account of yield* accounts.of(entry.definition.id)) {
                const last = asked.get(account.id)
                if (last !== undefined && now - last < Duration.toMillis(options.kept ?? (force ? LEAST : KEPT))) continue
                asked.set(account.id, now)
                yield* readAccount(account).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read plan usage', cause)))
              }
            }
          })

        const view = Effect.gen(function* () {
          yield* hydrate
          const list: AccountUsage[] = []
          for (const entry of agents.list) {
            for (const account of yield* accounts.of(entry.definition.id)) {
              const check = yield* signIns.account(account)
              const mine = held.get(account.id)
              const paidBy = mine?.paidBy ?? check.paidBy
              const key = paidBy === 'key'
              // No window and no fault yet is a fault too: the agent has not been read, or has not reported.
              const fault =
                mine?.fault ??
                (key || (mine?.windows.length ?? 0) > 0
                  ? null
                  : entry.definition.id === 'claude-code'
                    ? {
                        kind: 'no_data_yet' as const,
                        message: 'Claude Code reports its plan after its first turn, and again when it changes.',
                      }
                    : { kind: 'no_data_yet' as const, message: `${entry.definition.name}'s usage has not been read yet.` })
              list.push({
                agentId: entry.definition.id,
                agentName: entry.definition.name,
                accountId: account.id,
                accountName: account.name,
                paidBy,
                source: mine?.source ?? null,
                observedAt: mine?.observedAt ?? null,
                plan: mine?.plan ?? null,
                windows: (key ? [] : (mine?.windows ?? [])).map(shown),
                fault,
              })
            }
          }
          const rows = yield* sql<{ accountId: string; windowKey: string; threshold: number; resetsAt: string | null; raisedAt: string }>`
          SELECT account_id, window_key, threshold, resets_at, raised_at FROM plan_usage_warnings WHERE acknowledged_at IS NULL ORDER BY raised_at`
          const warnings: UsageWarning[] = []
          for (const row of rows) {
            const account = list.find((each) => each.accountId === row.accountId)
            if (account === undefined) continue
            const [kind, ...rest] = row.windowKey.split(':')
            warnings.push({
              accountId: row.accountId,
              accountName: account.accountName,
              agentId: account.agentId,
              agentName: account.agentName,
              windowKey: row.windowKey,
              kind: (['five_hour', 'weekly', 'monthly'].includes(kind ?? '') ? kind : 'other') as UsageWarning['kind'],
              label: rest.length === 0 ? null : rest.join(':'),
              remainingPercent: row.threshold,
              resetsAt: row.resetsAt,
              raisedAt: row.raisedAt,
            })
          }
          return { accounts: list, warnings } satisfies PlanUsageView
        })

        const told = view.pipe(
          Effect.flatMap((usage) => live.publish({ _tag: 'PlanUsage', usage })),
          Effect.catchCause((cause) => Effect.logWarning('Could not tell plan usage', cause)),
        )

        const every = options.every ?? Duration.minutes(5)
        // Not at launch: the window reads when it opens the tab, and accounts are read on their own after each wait.
        if (Duration.toMillis(every) > 0)
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.andThen(Effect.sleep(every), Effect.andThen(readAll(false), told)).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not read plan usage', cause)),
              ),
            ),
          )

        return PlanUsage.of({
          now: (refresh = false) => Effect.andThen(readAll(refresh), view),
          heard: (accountId, agentId, window) =>
            Effect.gen(function* () {
              yield* hydrate
              const before = held.get(accountId)
              const at = yield* timestamp
              // One window per event: it replaces its own, and the others stay as last said.
              const windows = [...(before?.windows ?? []).filter((each) => keyOf(each) !== keyOf(window)), window]
              yield* keep(accountId, { agentId, source: 'acp_extension', plan: before?.plan ?? null, windows, observedAt: at, fault: null })
              yield* warn(accountId, [window])
              yield* told
            }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep a plan window', cause))),
          acknowledge: (warnings) =>
            Effect.gen(function* () {
              const at = yield* timestamp
              for (const each of warnings)
                yield* sql`UPDATE plan_usage_warnings SET acknowledged_at = ${at} WHERE account_id = ${each.accountId} AND window_key = ${each.windowKey} AND acknowledged_at IS NULL`
              yield* told
            }),
        })
      }),
    )
}
