import { assert, describe, it } from '@effect/vitest'
import type { PlanUsage as PlanUsageView } from '@althar/contracts'
import type { CredentialsRead, EndpointRead, UsageRead, UsageWindow } from '@althar/provider-adapters'
import { Duration, Effect, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Live } from '../src/Live'
import { PlanUsage } from '../src/PlanUsage'
import { type AgentEntry, Agents } from '../src/Config'
import { fakeAgents, runtime } from './support'

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
    readonly readEndpoint?: (sourceId: string, provider: string, agentMajor: number | undefined) => Promise<EndpointRead>
    readonly readVersion?: () => Promise<string | null>
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
        ...(usage.readEndpoint === undefined
          ? {}
          : { readEndpoint: (id, account) => usage.readEndpoint!(id, account.provider, account.agentMajor) }),
        ...(usage.readVersion === undefined ? {} : { readVersion: usage.readVersion }),
      },
    },
  )

/** The fake agents, with OpenCode's commands run out on the device, as in a Flatpak. */
const onDeviceOpenCode = Layer.effect(
  Agents,
  Effect.gen(function* () {
    const inner = yield* Agents
    const patch = (entry: AgentEntry): AgentEntry =>
      entry.definition.id !== 'opencode'
        ? entry
        : {
            ...entry,
            definition: {
              ...entry.definition,
              signIn: {
                ...entry.definition.signIn,
                credentials: () => ({
                  command: 'opencode',
                  args: ['auth', 'list'],
                  onDevice: () => ({ command: 'flatpak-spawn', args: [] }),
                }),
              },
            },
          }
    return Agents.of({ list: inner.list.map(patch), get: (agentId) => Effect.map(inner.get(agentId), patch) })
  }),
).pipe(Layer.provide(fakeAgents()))

const accountOf = (view: PlanUsageView, agentId: string) => view.accounts.find((account) => account.agentId === agentId)!

describe('Codex’s plan, asked of its app-server', () => {
  it.effect('shows the windows it reports, by length, with where they came from', () =>
    Effect.gen(function* () {
      const view = yield* (yield* PlanUsage).now()
      assert.deepStrictEqual(accountOf(view, 'codex').windows, [
        { kind: 'five_hour', label: null, usedPercent: 40, resetsAt: RESET },
        { kind: 'weekly', label: null, usedPercent: 12, resetsAt: null },
      ])
      assert.strictEqual(accountOf(view, 'codex').source, 'agent')
      assert.strictEqual(accountOf(view, 'codex').plan, 'plus')
      assert.isNull(accountOf(view, 'codex').fault)
    }).pipe(Effect.provide(withUsage({ readAgent: async () => read(used(40), { kind: 'weekly', usedPercent: 12 }) }))),
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
        yield* usage.now()
        yield* usage.now()
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
        assert.strictEqual(accountOf(yield* usage.now(), 'codex').windows.length, 1)
        answer = { kind: 'failed', message: 'Not signed in with ChatGPT.' }
        const view = accountOf(yield* usage.now(), 'codex')
        assert.deepStrictEqual(view.fault, { kind: 'sign_in_again', message: 'Not signed in with ChatGPT.' })
        assert.strictEqual(view.windows.length, 1)
        answer = { kind: 'failed', message: 'Codex stopped before it answered.' }
        assert.strictEqual(accountOf(yield* usage.now(), 'codex').fault?.kind, 'unreachable')
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('is a fault, not an empty row, when Codex reports no window for a plan', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(), 'codex')
      assert.strictEqual(view.fault?.kind, 'no_data_yet')
      assert.deepStrictEqual(view.windows, [])
    }).pipe(Effect.provide(withUsage({ readAgent: async () => ({ kind: 'none' }) }))),
  )

  it.effect('is no fault for an account on an API key, which has no plan window', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(), 'codex')
      assert.strictEqual(view.paidBy, 'key')
      assert.isNull(view.fault)
      assert.deepStrictEqual(view.windows, [])
    }).pipe(Effect.provide(withUsage({ readAgent: async () => assert.fail('a key is never asked') }, { perUse: ['codex'] }))),
  )

  it.effect('is a fault, with nothing asked, when the account is signed out', () =>
    Effect.gen(function* () {
      const view = accountOf(yield* (yield* PlanUsage).now(), 'codex')
      assert.strictEqual(view.fault?.kind, 'sign_in_again')
    }).pipe(Effect.provide(withUsage({ readAgent: async () => assert.fail('signed out is never asked') }, { signedOut: ['codex'] }))),
  )
})

describe('Claude Code’s plan, heard from its sessions', () => {
  it.effect('is a fault until the adapter has reported, then each window it reports, kept as last said', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('claude-code')
      assert.strictEqual(accountOf(yield* usage.now(), 'claude-code').fault?.kind, 'no_data_yet')
      yield* usage.heard(account!.id, 'claude-code', used(20))
      yield* usage.heard(account!.id, 'claude-code', { kind: 'weekly', usedPercent: 5, resetsAt: '2026-10-20T00:00:00.000Z' })
      yield* usage.heard(account!.id, 'claude-code', used(25))
      const view = accountOf(yield* usage.now(), 'claude-code')
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
      const windows = accountOf(yield* usage.now(), 'claude-code').windows
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
        const view = yield* usage.now()
        const latest = view.warnings.at(-1)
        if (latest !== undefined && !told.includes(latest.remainingPercent)) told.push(latest.remainingPercent)
      }
      assert.deepStrictEqual(told, [50, 25, 10, 5])
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('holds one warning per window until the person has seen it, and no more for the same one', () =>
    Effect.gen(function* () {
      const { usage, account } = yield* heard(80)
      const first = (yield* usage.now()).warnings
      assert.deepStrictEqual(
        first.map((warning) => [warning.accountId, warning.windowKey, warning.remainingPercent, warning.agentId]),
        [[account.id, 'five_hour', 25, 'claude-code']],
      )
      yield* usage.acknowledge([{ accountId: account.id, windowKey: 'five_hour' }])
      assert.deepStrictEqual((yield* usage.now()).warnings, [])
      yield* heard(82)
      assert.deepStrictEqual((yield* usage.now()).warnings, [])
      yield* heard(91)
      assert.deepStrictEqual(
        (yield* usage.now()).warnings.map((warning) => warning.remainingPercent),
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
      assert.deepStrictEqual((yield* usage.now()).warnings, [])
      yield* usage.heard(account.id, 'claude-code', used(80, { resetsAt: '2026-10-15T22:00:00.000Z' }))
      assert.deepStrictEqual(
        (yield* usage.now()).warnings.map((warning) => warning.remainingPercent),
        [25],
      )
    }).pipe(Effect.provide(withUsage({}))),
  )

  it.effect('tells Codex’s windows too, with the agent’s name', () =>
    Effect.gen(function* () {
      const view = yield* (yield* PlanUsage).now()
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
      assert.deepStrictEqual((yield* usage.now()).warnings, [])
    }).pipe(Effect.provide(withUsage({}))),
  )
})

describe('OpenCode’s accounts, by their own sign-ins', () => {
  const openCode = (view: PlanUsageView) => accountOf(view, 'opencode')

  it.effect('are keys, with no fault, when every sign-in is a key', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.strictEqual(view.paidBy, 'key')
      assert.isNull(view.fault)
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['openai', 'key'], ['openrouter', 'key']) }))),
  )

  it.effect('are a fault, not a key, when the listing fails, as OpenCode 1.x’s count does', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.strictEqual(view.fault?.kind, 'cannot_classify')
    }).pipe(
      Effect.provide(withUsage({ readCredentials: async () => ({ kind: 'failed', message: 'OpenCode would not list its sign-ins.' }) })),
    ),
  )

  it.effect('are a fault for a sign-in whose method it cannot classify', () =>
    Effect.gen(function* () {
      assert.strictEqual(openCode(yield* (yield* PlanUsage).now()).fault?.kind, 'cannot_classify')
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['openai', 'unknown']) }))),
  )

  it.effect('read a ChatGPT sign-in from its endpoint, naming the windows by the provider', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.deepStrictEqual(
        view.windows.map((window) => [window.kind, window.label, window.usedPercent]),
        [['five_hour', 'openai', 33]],
      )
      assert.strictEqual(view.source, 'endpoint')
      assert.isNull(view.fault)
    }).pipe(
      Effect.provide(
        withUsage({
          readCredentials: async () => credentials(['openai', 'plan']),
          readVersion: async () => '1.19.0',
          readEndpoint: async (id, provider, major) => {
            assert.deepStrictEqual([id, provider, major], ['opencode-chatgpt', 'openai', 1])
            return { kind: 'usage', stale: false, usage: { windows: [used(33)], source: 'endpoint', observedAt: NOW } }
          },
        }),
      ),
    ),
  )

  it.effect('show the reader’s fault when the endpoint is not confirmed or the sign-in is refused', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.deepStrictEqual(view.fault, { kind: 'sign_in_again', message: 'The provider refused this sign-in.' })
      assert.deepStrictEqual(view.windows, [])
    }).pipe(
      Effect.provide(
        withUsage({
          readCredentials: async () => credentials(['openai', 'plan']),
          readEndpoint: async () => ({ kind: 'fault', fault: 'sign_in_again', message: 'The provider refused this sign-in.' }),
        }),
      ),
    ),
  )

  it.effect('read the endpoint without a version when the agent’s is not known, which the reader then refuses', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.strictEqual(view.fault?.kind, 'no_source')
    }).pipe(
      Effect.provide(
        withUsage({
          readCredentials: async () => credentials(['openai', 'plan']),
          readVersion: async () => null,
          readEndpoint: async (_id, _provider, major) => {
            assert.isUndefined(major)
            return {
              kind: 'fault',
              fault: 'no_source',
              message: 'This usage source is for version 1 of the agent, and this one is not known to be.',
            }
          },
        }),
      ),
    ),
  )

  it.effect('show a reading the reader kept as old as it is, and say unreachable for what cannot be reached', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const first = openCode(yield* usage.now())
      assert.strictEqual(first.observedAt, '2026-10-15T10:00:00.000Z')
      assert.isNull(first.fault)
      const second = openCode(yield* usage.now())
      assert.strictEqual(second.fault?.kind, 'unreachable')
      assert.strictEqual(second.observedAt, '2026-10-15T10:00:00.000Z')
      assert.strictEqual(second.windows.length, 1)
    }).pipe(
      Effect.provide(
        (() => {
          let calls = 0
          return withUsage({
            readCredentials: async () => credentials(['openai', 'plan']),
            readVersion: async () => '1.19.0',
            readEndpoint: async () =>
              ++calls === 1
                ? { kind: 'usage', stale: true, usage: { windows: [used(33)], source: 'endpoint', observedAt: '2026-10-15T10:00:00.000Z' } }
                : { kind: 'fault', fault: 'unreachable', message: 'The provider could not be reached.' },
          })
        })(),
      ),
    ),
  )

  it.effect('are not read from where the agent runs on the device, for the helper that would read there is not built', () =>
    Effect.gen(function* () {
      const view = openCode(yield* (yield* PlanUsage).now())
      assert.strictEqual(view.fault?.kind, 'no_source')
      assert.include(view.fault?.message ?? '', 'on the device')
    }).pipe(
      Effect.provide(
        runtime(
          ':memory:',
          {},
          {
            agents: onDeviceOpenCode,
            usage: {
              every: Duration.zero,
              kept: Duration.zero,
              readCredentials: async () => credentials(['openai', 'plan']),
              readEndpoint: async () => assert.fail('an agent on the device is never read in this process'),
            },
          },
        ),
      ),
    ),
  )

  it.effect('are a fault for a plan provider that waits for its spike, and one with no pair at all', () =>
    Effect.gen(function* () {
      assert.strictEqual(openCode(yield* (yield* PlanUsage).now()).fault?.kind, 'no_source')
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['github-copilot', 'plan']) }))),
  )

  it.effect('are a fault for a plan provider that has no pair at all', () =>
    Effect.gen(function* () {
      assert.strictEqual(openCode(yield* (yield* PlanUsage).now()).fault?.kind, 'cannot_classify')
    }).pipe(Effect.provide(withUsage({ readCredentials: async () => credentials(['brand-new-plan', 'plan']) }))),
  )
})

describe('telling the window', () => {
  it.effect('publishes the usage whole when a window is heard and when a warning is seen', () =>
    Effect.gen(function* () {
      const live = yield* Live
      const usage = yield* PlanUsage
      const [account] = yield* (yield* Accounts).of('claude-code')
      const events = yield* live.subscribe
      yield* usage.heard(account!.id, 'claude-code', used(80))
      yield* usage.acknowledge([{ accountId: account!.id, windowKey: 'five_hour' }])
      const told = yield* events.pipe(
        Stream.filter((event) => event._tag === 'PlanUsage'),
        Stream.take(2),
        Stream.runCollect,
      )
      const [heard, seen] = told as ReadonlyArray<{ _tag: 'PlanUsage'; usage: PlanUsageView }>
      assert.strictEqual(heard!.usage.warnings.length, 1)
      assert.strictEqual(seen!.usage.warnings.length, 0)
    }).pipe(Effect.provide(Layer.fresh(withUsage({})))),
  )
})
