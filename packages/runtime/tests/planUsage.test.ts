import { assert, describe, it } from '@effect/vitest'
import type { PlanUsage as PlanUsageView } from '@althar/contracts'
import type { CredentialsRead, EndpointRead, UsageAccount, UsageRead, UsageWindow } from '@althar/provider-adapters'
import { agents as registry } from '@althar/provider-adapters'
import { Duration, Effect, Layer, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Limits } from '../src/Limits'
import { Live } from '../src/Live'
import { Models } from '../src/Models'
import { PlanUsage } from '../src/PlanUsage'
import { SignIns } from '../src/SignIns'
import { usableModels } from '../src/usableModels'
import { fakeAgents, runtime, until } from './support'

/*
 * Plan usage (docs/plans/plan-usage.md): where each account's windows come
 * from, the warnings as a plan runs down, and what is shown when an account
 * can't be read. The agents are stand-ins; nothing is asked of a real one.
 */

const NOW = '2026-10-15T12:00:00.000Z'
const RESET = '2026-10-15T17:00:00.000Z'

const used = (usedPercent: number, extra: Partial<UsageWindow> = {}): UsageWindow => ({
  kind: 'five_hour',
  usedPercent,
  resetsAt: RESET,
  ...extra,
})
const read = (...windows: UsageWindow[]): UsageRead => ({
  kind: 'usage',
  usage: { windows, source: 'agent', observedAt: NOW, plan: 'plus' },
})
const credentials = (...list: Array<[string, 'plan' | 'key' | 'unknown']>): CredentialsRead => ({
  kind: 'credentials',
  credentials: list.map(([provider, pays]) => ({ provider, pays })),
})

/** A runtime whose agents answer as the test says; readings are never kept, so each `now` asks again. */
const withUsage = (
  usage: {
    readonly readAgent?: () => Promise<UsageRead>
    readonly readCredentials?: () => Promise<CredentialsRead>
    readonly readVersion?: () => Promise<string | null>
    readonly readEndpoint?: (sourceId: string, account: UsageAccount) => Promise<EndpointRead>
  },
  more: { readonly perUse?: ReadonlyArray<string>; readonly signedOut?: ReadonlyArray<string>; readonly database?: string } = {},
) =>
  runtime(
    ':memory:',
    {},
    {
      ...(more.perUse === undefined ? {} : { perUse: more.perUse }),
      ...(more.signedOut === undefined ? {} : { signedOut: more.signedOut }),
      usage: {
        every: Duration.zero,
        kept: Duration.zero,
        ...(usage.readAgent === undefined ? {} : { readAgent: usage.readAgent }),
        ...(usage.readCredentials === undefined ? {} : { readCredentials: usage.readCredentials }),
        ...(usage.readEndpoint === undefined ? {} : { readEndpoint: usage.readEndpoint }),
        // OpenCode 2, whose listing tells plans from keys, unless the test says another.
        readVersion: usage.readVersion ?? (async () => '2.0.29'),
      },
    },
  )

const accountOf = (view: PlanUsageView, agentId: string) => view.accounts.find((account) => account.agentId === agentId)!

describe('Codex’s plan, asked of its app-server', () => {
  it.effect('shows the windows it reports, by length, with where they came from', () =>
    Effect.gen(function* () {
      const view = yield* (yield* PlanUsage).now(true)
      assert.deepStrictEqual(accountOf(view, 'codex').windows, [
        { kind: 'five_hour', label: null, usedPercent: 40, resetsAt: RESET },
        { kind: 'weekly', label: null, usedPercent: 12, resetsAt: null },
      ])
      assert.strictEqual(accountOf(view, 'codex').source, 'agent')
      assert.strictEqual(accountOf(view, 'codex').plan, 'plus')
      assert.isNull(accountOf(view, 'codex').fault)
    }).pipe(Effect.provide(withUsage({ readAgent: async () => read(used(40), { kind: 'weekly', usedPercent: 12 }) }))),
  )

  it.effect('answers an open at once with what it has, and tells the view again once the accounts are read', () =>
    Effect.gen(function* () {
      let answer!: () => void
      const answered = new Promise<void>((resolve) => (answer = resolve))
      const layer = withUsage({ readAgent: async () => (await answered, read(used(40))) })
      yield* Effect.gen(function* () {
        const usage = yield* PlanUsage
        const events = yield* (yield* Live).subscribe
        // Codex has not answered, and the view does not wait for it.
        const opened = accountOf(yield* usage.now(), 'codex')
        assert.strictEqual(opened.fault?.kind, 'no_data_yet')
        assert.deepStrictEqual(opened.windows, [])
        answer()
        const [told] = (yield* events.pipe(
          Stream.filter((event) => event._tag === 'PlanUsage'),
          Stream.take(1),
          Stream.runCollect,
        )) as ReadonlyArray<{ _tag: 'PlanUsage'; usage: PlanUsageView }>
        assert.deepStrictEqual(
          accountOf(told!.usage, 'codex').windows.map((window) => window.usedPercent),
          [40],
        )
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('reads its accounts at once, so one slow to answer holds up none of the others', () =>
    Effect.gen(function* () {
      let open = 0
      let most = 0
      const layer = withUsage({
        readAgent: async () => {
          most = Math.max(most, ++open)
          await new Promise((resolve) => setTimeout(resolve, 20))
          open--
          return read(used(10))
        },
      })
      yield* Effect.gen(function* () {
        const accounts = yield* Accounts
        yield* accounts.add({ agentId: 'codex', name: 'Work' })
        yield* (yield* PlanUsage).now(true)
        assert.strictEqual(most, 2)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('is asked again only after a reading has been kept for its time', () =>
    Effect.gen(function* () {
      let asked = 0
      const layer = runtime(
        ':memory:',
        {},
        {
          usage: { every: Duration.zero, kept: Duration.minutes(1), readAgent: async () => (asked++, read(used(10))) },
        },
      )
      yield* Effect.gen(function* () {
        const usage = yield* PlanUsage
        yield* usage.now(true)
        yield* usage.now(true)
        assert.strictEqual(asked, 1)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('says sign in again when Codex says it is not signed in, and keeps the windows it last had', () =>
    Effect.gen(function* () {
      let answer: UsageRead = read(used(30))
      const layer = withUsage({ readAgent: async () => answer })
      yield* Effect.gen(function* () {
        const usage = yield* PlanUsage
        assert.strictEqual(accountOf(yield* usage.now(true), 'codex').windows.length, 1)
        answer = { kind: 'failed', message: 'Not signed in with ChatGPT.' }
        const view = accountOf(yield* usage.now(true), 'codex')
        assert.deepStrictEqual(view.fault, { kind: 'sign_in_again', message: 'Not signed in with ChatGPT.' })
        assert.strictEqual(view.windows.length, 1)
        answer = { kind: 'failed', message: 'Codex stopped before it answered.' }
        assert.strictEqual(accountOf(yield* usage.now(true), 'codex').fault?.kind, 'unreachable')
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('reads ChatGPT’s usage endpoint where its app-server can’t answer, but not where it isn’t signed in', () =>
    Effect.gen(function* () {
      let answer: UsageRead = { kind: 'failed', message: 'Codex stopped before it answered.' }
      const asked: string[] = []
      const layer = withUsage({
        readAgent: async () => answer,
        readEndpoint: async (sourceId) =>
          sourceId === 'codex-chatgpt'
            ? (asked.push(sourceId), { kind: 'usage', stale: false, usage: { windows: [used(55)], source: 'endpoint', observedAt: NOW } })
            : { kind: 'none' },
      })
      yield* Effect.gen(function* () {
        const usage = yield* PlanUsage
        const view = accountOf(yield* usage.now(true), 'codex')
        assert.deepStrictEqual([view.source, view.windows.map((window) => window.usedPercent), view.fault], ['endpoint', [55], null])
        assert.deepStrictEqual(asked, ['codex-chatgpt'])
        answer = { kind: 'failed', message: 'Not signed in with ChatGPT.' }
        assert.strictEqual(accountOf(yield* usage.now(true), 'codex').fault?.kind, 'sign_in_again')
        assert.deepStrictEqual(asked, ['codex-chatgpt'])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('is a fault, not an empty row, when Codex reports no window for a plan', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(true), 'codex')
      assert.strictEqual(view.fault?.kind, 'no_data_yet')
      assert.deepStrictEqual(view.windows, [])
    }).pipe(Effect.provide(withUsage({ readAgent: async () => ({ kind: 'none' }) }))),
  )

  it.effect('is no fault for an account on an API key, which has no plan window', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(true), 'codex')
      assert.strictEqual(view.paidBy, 'key')
      assert.isNull(view.fault)
      assert.deepStrictEqual(view.windows, [])
    }).pipe(Effect.provide(withUsage({ readAgent: async () => assert.fail('a key is never asked') }, { perUse: ['codex'] }))),
  )

  it.effect('is a fault, with nothing asked, when the account is signed out', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(true), 'codex')
      assert.strictEqual(view.fault?.kind, 'sign_in_again')
    }).pipe(Effect.provide(withUsage({ readAgent: async () => assert.fail('signed out is never asked') }, { signedOut: ['codex'] }))),
  )
})

describe('Claude Code’s plan, read from its endpoint and heard from its sessions', () => {
  it.effect('is read for an idle account from Anthropic’s endpoint, with the account’s home and the agent’s version', () =>
    Effect.gen(function* () {
      const asked: Array<[string, UsageAccount]> = []
      const layer = withUsage({
        readVersion: async () => '2.1.5 (Claude Code)',
        readEndpoint: async (sourceId, account) =>
          sourceId === 'claude-oauth'
            ? (asked.push([sourceId, account]),
              {
                kind: 'usage',
                stale: false,
                usage: { windows: [used(30), { kind: 'weekly', usedPercent: 70 }], source: 'endpoint', observedAt: NOW },
              })
            : { kind: 'none' },
      })
      yield* Effect.gen(function* () {
        const view = accountOf(yield* (yield* PlanUsage).now(true), 'claude-code')
        assert.deepStrictEqual([view.source, view.windows.length, view.fault], ['endpoint', 2, null])
        assert.deepStrictEqual(
          asked.map(([sourceId, account]) => [sourceId, account.agent, account.provider, account.agentVersion]),
          [['claude-oauth', 'claude-code', 'anthropic', '2.1.5 (Claude Code)']],
        )
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('says its sign-in has expired, keeping what it last read, and isn’t asked while a session has just said', () =>
    Effect.gen(function* () {
      let reply: EndpointRead = { kind: 'usage', stale: false, usage: { windows: [used(30)], source: 'endpoint', observedAt: NOW } }
      let asked = 0
      const layer = withUsage({ readEndpoint: async (sourceId) => (sourceId === 'claude-oauth' ? (asked++, reply) : { kind: 'none' }) })
      yield* Effect.gen(function* () {
        const usage = yield* PlanUsage
        const [account] = yield* (yield* Accounts).of('claude-code')
        yield* usage.now(true)
        reply = { kind: 'fault', fault: 'expired', message: 'Its sign-in has expired.' }
        const view = accountOf(yield* usage.now(true), 'claude-code')
        assert.strictEqual(view.fault?.kind, 'expired')
        assert.include(view.fault?.message ?? '', 'renews it the next time it runs on this account')
        assert.deepStrictEqual(
          view.windows.map((window) => window.usedPercent),
          [30],
        )
        // A session says its windows: the endpoint isn't asked again for a while.
        yield* usage.heard(account!.id, 'claude-code', used(35))
        const before = asked
        assert.isNull(accountOf(yield* usage.now(true), 'claude-code').fault)
        assert.strictEqual(asked, before)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('is a fault until the adapter has reported, then each window it reports, kept as last said', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('claude-code')
      assert.strictEqual(accountOf(yield* usage.now(true), 'claude-code').fault?.kind, 'no_data_yet')
      yield* usage.heard(account!.id, 'claude-code', used(20))
      yield* usage.heard(account!.id, 'claude-code', { kind: 'weekly', usedPercent: 5, resetsAt: '2026-10-20T00:00:00.000Z' })
      yield* usage.heard(account!.id, 'claude-code', used(25))
      const view = accountOf(yield* usage.now(true), 'claude-code')
      assert.isNull(view.fault)
      assert.strictEqual(view.source, 'acp_extension')
      assert.deepStrictEqual(
        view.windows.map((window) => [window.kind, window.usedPercent]),
        [
          ['weekly', 5],
          ['five_hour', 25],
        ],
      )
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('names a window of one model apart from the plan’s own', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const [account] = yield* (yield* Accounts).of('claude-code')
      yield* usage.heard(account!.id, 'claude-code', { kind: 'weekly', usedPercent: 10 })
      yield* usage.heard(account!.id, 'claude-code', { kind: 'weekly', label: 'Opus', usedPercent: 60 })
      const windows = accountOf(yield* usage.now(true), 'claude-code').windows
      assert.deepStrictEqual(
        windows.map((window) => window.label),
        [null, 'Opus'],
      )
    }).pipe(Effect.provide(withUsage({}))),
  )
})

describe('warnings as a plan runs down', () => {
  const heard = (usedPercent: number) =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const [account] = yield* (yield* Accounts).of('claude-code')
      yield* usage.heard(account!.id, 'claude-code', used(usedPercent))
      return { usage, account: account! }
    })

  it.effect('tells 50, 25, 10 and 5 percent left, each once, and the lowest a reading skips to', () =>
    Effect.gen(function* () {
      const told: number[] = []
      for (const percent of [30, 55, 60, 76, 77, 93, 99]) {
        const { usage } = yield* heard(percent)
        const view = yield* usage.now(true)
        const latest = view.warnings.at(-1)
        if (latest !== undefined && !told.includes(latest.remainingPercent)) told.push(latest.remainingPercent)
      }
      assert.deepStrictEqual(told, [50, 25, 10, 5])
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('holds one warning per window until the person has seen it, and no more for the same one', () =>
    Effect.gen(function* () {
      const { usage, account } = yield* heard(80)
      const first = (yield* usage.now(true)).warnings
      assert.deepStrictEqual(
        first.map((warning) => [warning.accountId, warning.windowKey, warning.remainingPercent, warning.agentId]),
        [[account.id, 'five_hour', 25, 'claude-code']],
      )
      yield* usage.acknowledge([{ accountId: account.id, windowKey: 'five_hour' }])
      assert.deepStrictEqual((yield* usage.now(true)).warnings, [])
      yield* heard(82)
      assert.deepStrictEqual((yield* usage.now(true)).warnings, [])
      yield* heard(91)
      assert.deepStrictEqual(
        (yield* usage.now(true)).warnings.map((warning) => warning.remainingPercent),
        [10],
      )
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('arms again when the window resets, and not because use dipped', () =>
    Effect.gen(function* () {
      const { usage, account } = yield* heard(80)
      yield* usage.acknowledge([{ accountId: account.id, windowKey: 'five_hour' }])
      yield* heard(40)
      yield* heard(80)
      assert.deepStrictEqual((yield* usage.now(true)).warnings, [])
      yield* usage.heard(account.id, 'claude-code', used(80, { resetsAt: '2026-10-15T22:00:00.000Z' }))
      assert.deepStrictEqual(
        (yield* usage.now(true)).warnings.map((warning) => warning.remainingPercent),
        [25],
      )
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('does not arm again when a reading leaves the reset out', () =>
    Effect.gen(function* () {
      const { usage, account } = yield* heard(96)
      yield* usage.acknowledge([{ accountId: account.id, windowKey: 'five_hour' }])
      yield* usage.heard(account.id, 'claude-code', { kind: 'five_hour', usedPercent: 96 })
      yield* heard(96)
      assert.deepStrictEqual((yield* usage.now(true)).warnings, [])
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('shows a window whose reset has passed with all of its plan left, and drops its warning', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const [account] = yield* (yield* Accounts).of('claude-code')
      // The test clock starts at 0: this window resets a second in.
      yield* usage.heard(account!.id, 'claude-code', used(95, { resetsAt: new Date(1000).toISOString() }))
      assert.strictEqual((yield* usage.now(true)).warnings.length, 1)
      yield* TestClock.adjust(Duration.seconds(2))
      const view = yield* usage.now(true)
      assert.deepStrictEqual(accountOf(view, 'claude-code').windows, [{ kind: 'five_hour', label: null, usedPercent: 0, resetsAt: null }])
      assert.deepStrictEqual(view.warnings, [])
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('tells Codex’s windows too, with the agent’s name', () =>
    Effect.gen(function* () {
      const view = yield* (yield* PlanUsage).now(true)
      assert.deepStrictEqual(
        view.warnings.map((warning) => [warning.agentId, warning.kind, warning.remainingPercent]),
        [['codex', 'weekly', 5]],
      )
    }).pipe(Effect.provide(withUsage({ readAgent: async () => read(used(10), { kind: 'weekly', usedPercent: 96 }) }))),
  )

  it.effect('keeps what it told and what it last read in the store, which is all a restart reads back', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { usage, account } = yield* heard(80)
      const [told] = yield* sql<{ threshold: number; resetsAt: string | null; acknowledgedAt: string | null }>`
        SELECT threshold, resets_at, acknowledged_at FROM plan_usage_warnings WHERE account_id = ${account.id}`
      assert.deepStrictEqual([told?.threshold, told?.resetsAt, told?.acknowledgedAt], [25, RESET, null])
      const [kept] = yield* sql<{
        source: string
        windows: string
      }>`SELECT source, windows FROM plan_usage_readings WHERE account_id = ${account.id}`
      assert.strictEqual(kept?.source, 'acp_extension')
      assert.deepStrictEqual(JSON.parse(kept?.windows ?? '[]'), [used(80)])
      yield* usage.acknowledge([{ accountId: account.id, windowKey: 'five_hour' }])
      const [seen] = yield* sql<{
        acknowledgedAt: string | null
      }>`SELECT acknowledged_at FROM plan_usage_warnings WHERE account_id = ${account.id}`
      assert.isString(seen?.acknowledgedAt)
      // What was told is read back from the store each time, so a reading that follows a restart tells nothing twice.
      yield* heard(82)
      assert.deepStrictEqual((yield* usage.now(true)).warnings, [])
    }).pipe(Effect.provide(withUsage({}))),
  )
})

describe('OpenCode’s accounts, by their own sign-ins', () => {
  const openCode = (view: PlanUsageView) => accountOf(view, 'opencode')

  it.effect('are keys, with no fault, when every sign-in is a key', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.strictEqual(view.paidBy, 'key')
      assert.isNull(view.fault)
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['openai', 'key'], ['openrouter', 'key']) }))),
  )

  it.effect('are a fault, not a key, when the listing fails', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.strictEqual(view.fault?.kind, 'cannot_classify')
    }).pipe(
      Effect.provide(withUsage({ readCredentials: async () => ({ kind: 'failed', message: 'OpenCode would not list its sign-ins.' }) })),
    ),
  )

  it.effect('are a fault for a sign-in whose method it cannot classify', () =>
    Effect.gen(function* () {
      assert.strictEqual(openCode(yield* (yield* PlanUsage).now(true)).fault?.kind, 'cannot_classify')
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['openai', 'unknown']) }))),
  )

  it.effect('are not listed on OpenCode 1, whose `auth list` has no such flags, and say it can’t tell plans from keys', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.strictEqual(view.fault?.kind, 'cannot_classify')
      assert.include(view.fault?.message ?? '', ' 1 can’t tell plans from API keys')
    }).pipe(
      Effect.provide(
        withUsage({
          readVersion: async () => '1.19.0',
          readCredentials: async () => assert.fail('OpenCode 1 is not asked for its listing'),
        }),
      ),
    ),
  )

  it.effect('are not listed where the agent’s version is not known, and say so', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.strictEqual(view.fault?.kind, 'cannot_classify')
      assert.include(view.fault?.message ?? '', 'couldn’t tell which version')
    }).pipe(
      Effect.provide(
        withUsage({
          readVersion: async () => null,
          readCredentials: async () => assert.fail('an OpenCode of unknown version is not asked for its listing'),
        }),
      ),
    ),
  )

  it.effect('are a plan with no reading for a ChatGPT sign-in, and say why, calmly rather than as a fault', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.strictEqual(view.paidBy, 'plan')
      assert.isNull(view.fault)
      assert.include(view.noReading ?? '', 'its own database')
      assert.deepStrictEqual(view.windows, [])
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['openai', 'plan']) }))),
  )

  it.effect('say why for every plan provider with no reading', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now(true))
      assert.deepStrictEqual([view.fault, view.noReading?.includes('GitHub Copilot')], [null, true])
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['github-copilot', 'plan']) }))),
  )

  it.effect('are a fault for a plan provider that has no pair at all', () =>
    Effect.gen(function* () {
      assert.strictEqual(openCode(yield* (yield* PlanUsage).now(true)).fault?.kind, 'cannot_classify')
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['brand-new-plan', 'plan']) }))),
  )
})

describe('the agents run over ACP', () => {
  /* One such agent alone, a fake under its id, paid as the test says. */
  const only = (
    agentId: string,
    perUse: ReadonlyArray<string>,
    readEndpoint?: (sourceId: string, account: UsageAccount) => Promise<EndpointRead>,
  ) =>
    runtime(
      ':memory:',
      {},
      {
        perUse,
        agents: Layer.effect(
          Agents,
          Effect.gen(function* () {
            const all = yield* Agents
            return Agents.of({ list: [yield* all.get(agentId)], get: all.get })
          }).pipe(Effect.orDie),
        ).pipe(Layer.provide(fakeAgents({}, [], {}, perUse))),
        usage: { every: Duration.zero, kept: Duration.zero, ...(readEndpoint === undefined ? {} : { readEndpoint }) },
      },
    )
  const reading: EndpointRead = {
    kind: 'usage',
    stale: false,
    usage: { windows: [{ kind: 'weekly', usedPercent: 72 }], source: 'endpoint', observedAt: NOW },
  }

  it.effect('read Grok Build’s and Kimi Code’s plans from their providers, with the account’s own sign-in', () =>
    Effect.gen(function* () {
      for (const [agentId, sourceId] of [
        ['grok', 'grok-billing'],
        ['kimi', 'kimi-usages'],
      ] as const) {
        const asked: string[] = []
        const view = yield* Effect.gen(function* () {
          return accountOf(yield* (yield* PlanUsage).now(true), agentId)
        }).pipe(Effect.provide(only(agentId, [], async (id) => (asked.push(id), reading))))
        assert.deepStrictEqual([view.source, view.windows.map((window) => window.usedPercent), asked], ['endpoint', [72], [sourceId]])
      }
    }),
  )

  it.live('take Kimi Code read on its plan for one its plan pays for, though its status can’t say, to move work to and to list', () => {
    // Kimi Code's status, as it ships, can't say how it is paid: its plan is told by its sign-in for it being there.
    let answer: EndpointRead = reading
    const asShipped = runtime(
      ':memory:',
      {},
      {
        agents: Layer.effect(
          Agents,
          Effect.gen(function* () {
            const all = yield* Agents
            const kimi = yield* all.get('kimi')
            const shipped = registry.kimi.signIn
            const signIn = { ...kimi.definition.signIn, paidBy: (output: string) => shipped.paidBy?.(output) }
            return Agents.of({ list: [{ ...kimi, definition: { ...kimi.definition, signIn } }], get: (agentId) => all.get(agentId) })
          }).pipe(Effect.orDie),
        ).pipe(Layer.provide(fakeAgents())),
        usage: { every: Duration.zero, kept: Duration.zero, readEndpoint: async () => answer },
      },
    )
    return Effect.gen(function* () {
      const signIns = yield* SignIns
      const limits = yield* Limits
      const [account] = yield* (yield* Accounts).of('kimi')
      assert.strictEqual((yield* signIns.account(account!)).paidBy, 'unknown')
      // Not read yet, it isn't taken for a plan: work moves to it unasked only where a plan pays.
      assert.isUndefined(yield* limits.free([]))
      assert.strictEqual(accountOf(yield* (yield* PlanUsage).now(true), 'kimi').paidBy, 'plan')
      assert.strictEqual((yield* signIns.account(account!)).paidBy, 'plan')
      assert.strictEqual(yield* limits.free([]), 'kimi')
      // The coordinator's list has its models on the plan, with what the plan has left.
      yield* until((yield* Models).catalog, (all) => all.every((agent) => !agent.probing))
      const routes = (yield* usableModels()).flatMap((model) => model.routes)
      assert.isNotEmpty(routes)
      assert.isTrue(routes.every((route) => route.plan && route.room?.leftPercent === 28))
      // Its plan's sign-in gone, read again it is a key, with nothing left of the plan's windows.
      answer = { kind: 'none' }
      yield* (yield* PlanUsage).now(true)
      assert.strictEqual((yield* signIns.account(account!)).paidBy, 'unknown')
      assert.isTrue(Option.isNone(yield* limits.room(account!.id)))
    }).pipe(Effect.provide(asShipped))
  })

  it.effect('take Kimi Code with no plan sign-in for a key, and Grok with none found for a fault to look at', () =>
    Effect.gen(function* () {
      const kimi = yield* Effect.gen(function* () {
        return accountOf(yield* (yield* PlanUsage).now(true), 'kimi')
      }).pipe(Effect.provide(only('kimi', [])))
      assert.deepStrictEqual([kimi.paidBy, kimi.fault], ['key', null])
      const grok = yield* Effect.gen(function* () {
        return accountOf(yield* (yield* PlanUsage).now(true), 'grok')
      }).pipe(Effect.provide(only('grok', [])))
      assert.strictEqual(grok.fault?.kind, 'no_data_yet')
    }),
  )

  it.effect('say calmly why one reports no usage anyone can read, rather than that it has not been read', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(true), 'copilot')
      assert.strictEqual(view.paidBy, 'plan')
      assert.isNull(view.fault)
      assert.include(view.noReading ?? '', 'premium requests')
    }).pipe(Effect.provide(only('copilot', [], async () => assert.fail('Copilot has no endpoint to read')))),
  )

  it.effect('show a key with no fault', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(true), 'grok')
      assert.strictEqual(view.paidBy, 'key')
      assert.isNull(view.fault)
    }).pipe(Effect.provide(only('grok', ['grok']))),
  )
})

describe('telling the window', () => {
  const plans = (events: Stream.Stream<{ readonly _tag: string }>) =>
    events.pipe(
      Stream.filter((event) => event._tag === 'PlanUsage'),
      Stream.take(1),
      Stream.runCollect,
      Effect.map((told) => (told as unknown as ReadonlyArray<{ _tag: 'PlanUsage'; usage: PlanUsageView }>)[0]!.usage),
    )

  it.effect('publishes the usage whole a moment after windows are heard, once for them all, and when a warning is seen', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const [account] = yield* (yield* Accounts).of('claude-code')
      const events = yield* (yield* Live).subscribe
      // What heard them goes on at once: the clock has not moved, so nothing waited for the telling.
      yield* usage.heard(account!.id, 'claude-code', used(80))
      yield* usage.heard(account!.id, 'claude-code', { kind: 'weekly', usedPercent: 30 })
      yield* TestClock.adjust(Duration.millis(250))
      const heard = yield* plans(events)
      assert.strictEqual(accountOf(heard, 'claude-code').windows.length, 2)
      assert.strictEqual(heard.warnings.length, 1)
      yield* usage.acknowledge([{ accountId: account!.id, windowKey: 'five_hour' }])
      assert.strictEqual((yield* plans(events)).warnings.length, 0)
    }).pipe(Effect.provide(Layer.fresh(withUsage({})))),
  )
})
