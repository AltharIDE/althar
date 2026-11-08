import { Ids, newId } from '@althar/domain'
import type { UsageRead, UsageWindow } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { modelRooms } from '../src/modelRooms'
import { Models } from '../src/Models'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { usableModels } from '../src/usableModels'
import { repository, runtime, task, until } from './support'

/*
 * An account marked out of usage is back as soon as it shows it works again, before the reset its limit gave: the person reset
 * their usage, topped up or changed plan. One rule (Limits' `outOf`) says so for the coordinator's model list, for picking an
 * account and for the cards, and the pickers' room comes from the same reading.
 */

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const from = (ms: number) => new Date(Date.now() + ms).toISOString()

/** The windows as PlanUsage keeps them: each with when it was read. */
const window = (left: number, observedAt: string, kind: UsageWindow['kind'] = 'five_hour'): UsageWindow & { observedAt: string } => ({
  kind,
  usedPercent: 100 - left,
  resetsAt: from(3 * 60 * MINUTE),
  observedAt,
})

const read = (accountId: string, windows: ReadonlyArray<UsageWindow & { observedAt: string }>, observedAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO plan_usage_readings ${sql.insert({ accountId, agentId: 'codex', source: 'agent', plan: 'plus', windows: JSON.stringify(windows), observedAt })}
      ON CONFLICT (account_id) DO UPDATE SET windows = excluded.windows, observed_at = excluded.observed_at`
  })

/** The account's agent said it ran out of usage at `at`, until `resetsAt`. */
const limitedAt = (accountId: string, at: string, resetsAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const principalId = yield* newId(Ids.principal)
    yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId: 'codex', accountId, deviceId: instance.deviceId, subjectHint: 'Fake sign-in', authMode: 'vendor_cli', observedAt: at })}`
    yield* sql`INSERT INTO account_statuses ${sql.insert({
      id: yield* newId(Ids.accountStatus),
      principalId,
      state: 'limited',
      windows: JSON.stringify([{ kind: 'usage', resetsAt }]),
      source: 'error',
      observedAt: at,
    })}`
  })

const ready = Effect.gen(function* () {
  yield* until((yield* Models).catalog, (all) => all.every((agent) => !agent.probing))
  const projects = yield* Projects
  return (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
})

/** Whether the coordinator can give work to Codex's models. */
const codexUsable = (projectId: string) =>
  Effect.map(usableModels(projectId), (all) => all.some((model) => model.routes.some((route) => route.agentId === 'codex')))

const codexAccount = Effect.gen(function* () {
  const [account] = yield* (yield* Accounts).of('codex')
  return account!
})

/** A Codex that has nothing to say: an out account's re-read by the model list asks it, never the machine's own binary. */
const silent = {
  every: Duration.zero,
  kept: Duration.zero,
  readAgent: async (): Promise<UsageRead> => ({ kind: 'failed', message: 'Not asked in this test.' }),
  readVersion: async () => '2.0.29',
}

describe('an account marked out of usage', () => {
  it.live('is usable at once when a reading taken after shows room in every window, where the pickers show it too', () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const projectId = yield* ready
      const account = yield* codexAccount
      // It ran out a minute ago, until tomorrow.
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      assert.isFalse(yield* codexUsable(projectId))
      assert.isTrue(Option.isSome(yield* limits.outAccount(account.id)))
      assert.isTrue(Option.isSome(yield* limits.out('codex', projectId)))

      // A reading from before it ran out says nothing of it, however much room it showed.
      yield* read(account.id, [window(80, ago(5 * MINUTE))], ago(5 * MINUTE))
      assert.isFalse(yield* codexUsable(projectId))

      // The person reset their usage: a reading taken after, with room in both windows.
      yield* read(account.id, [window(100, ago(1000)), window(100, ago(1000), 'weekly')], ago(1000))
      assert.isTrue(yield* codexUsable(projectId))
      assert.isTrue(Option.isNone(yield* limits.outAccount(account.id)))
      assert.isTrue(Option.isNone(yield* limits.out('codex', projectId)))
      // The pickers' source reads the same reading, and the account is the one steering picks.
      const rooms = (yield* modelRooms(projectId)).filter((one) => one.agentId === 'codex')
      assert.isAbove(rooms.length, 0)
      assert.isTrue(rooms.every((one) => one.leftPercent === 100 && one.accountId === account.id))
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId })).id, account.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: silent }))),
  )

  it.live('stays out when a reading taken after still has a window with nothing left, or one not read since', () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const projectId = yield* ready
      const account = yield* codexAccount
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      // The five-hour window has room again, the week is used up.
      yield* read(account.id, [window(60, ago(1000)), window(0, ago(1000), 'weekly')], ago(1000))
      assert.isFalse(yield* codexUsable(projectId))
      // The week was last read before it ran out, so it says nothing of whether it holds.
      yield* read(account.id, [window(60, ago(1000)), window(70, ago(5 * MINUTE), 'weekly')], ago(1000))
      assert.isFalse(yield* codexUsable(projectId))
      assert.isTrue(Option.isSome(yield* limits.outAccount(account.id)))
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: silent }))),
  )

  it.live('stays out while a model’s own window, read since, has nothing left, though the plan’s has room', () =>
    Effect.gen(function* () {
      const projectId = yield* ready
      const account = yield* codexAccount
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      const own = { ...window(0, ago(1000), 'weekly'), model: 'gpt-6.1-sol' }
      yield* read(account.id, [window(100, ago(1000)), own], ago(1000))
      assert.isFalse(yield* codexUsable(projectId))
      assert.isTrue(Option.isSome(yield* (yield* Limits).outAccount(account.id)))
      // Once that one has room too, the account is back; and an account whose reading holds only a model’s window can come back.
      yield* read(account.id, [window(100, ago(1000)), { ...own, usedPercent: 10 }], ago(1000))
      assert.isTrue(yield* codexUsable(projectId))
      yield* limitedAt(account.id, ago(500), from(DAY))
      assert.isFalse(yield* codexUsable(projectId))
      yield* read(account.id, [{ ...own, usedPercent: 10, observedAt: ago(100) }], ago(100))
      assert.isTrue(yield* codexUsable(projectId))
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: silent }))),
  )

  it.live('tells the pickers when the account is out, as steering sees it, whatever room it last read', () =>
    Effect.gen(function* () {
      const projectId = yield* ready
      const account = yield* codexAccount
      yield* read(account.id, [window(80, ago(5 * MINUTE))], ago(5 * MINUTE))
      assert.isTrue((yield* modelRooms(projectId)).every((one) => one.outUntil === undefined))
      const resetsAt = from(DAY)
      yield* limitedAt(account.id, ago(MINUTE), resetsAt)
      const rooms = (yield* modelRooms(projectId)).filter((one) => one.agentId === 'codex')
      assert.isAbove(rooms.length, 0)
      assert.isTrue(rooms.every((one) => one.outUntil === resetsAt))
      yield* read(account.id, [window(100, ago(1000))], ago(1000))
      assert.isTrue((yield* modelRooms(projectId)).every((one) => one.outUntil === undefined))
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: silent }))),
  )

  it.live('is usable at once when a turn completed on it after it ran out', () =>
    Effect.gen(function* () {
      const limits = yield* Limits
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ready
      const account = yield* codexAccount
      const { project, task: created } = yield* task('Ask Codex')
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      assert.isFalse(yield* codexUsable(projectId))
      const sessionId = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: sessionId,
        projectId: project.projectId,
        threadId: created.threadId,
        agentId: 'codex',
        accountId: account.id,
        state: 'active',
        startedAt: ago(MINUTE),
      })}`
      const turn = (state: 'failed' | 'completed', endedAt: string) =>
        Effect.gen(function* () {
          yield* sql`INSERT INTO turn_deliveries ${sql.insert({
            id: yield* newId(Ids.turnDelivery),
            projectId: project.projectId,
            threadId: created.threadId,
            providerSessionId: sessionId,
            controllerGeneration: 1,
            state,
            origin: 'person',
            model: 'large',
            endedAt,
            requestedAt: endedAt,
          })}`
        })
      // One that completed before it ran out, and one that failed after, change nothing.
      yield* turn('completed', ago(2 * MINUTE))
      yield* turn('failed', ago(1000))
      assert.isTrue(Option.isSome(yield* limits.outAccount(account.id)))
      yield* turn('completed', ago(500))
      assert.isTrue(Option.isNone(yield* limits.outAccount(account.id)))
      assert.isTrue(yield* codexUsable(projectId))
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: silent }))),
  )
})

describe('the model list, while an account is marked out', () => {
  /** Codex answers as the person's plan stands now; every ask is counted. */
  const asked = { count: 0, left: 100 }
  const answer = async (): Promise<UsageRead> => {
    asked.count += 1
    const observedAt = new Date().toISOString()
    return {
      kind: 'usage',
      usage: {
        windows: [{ kind: 'five_hour', usedPercent: 100 - asked.left, resetsAt: from(3 * 60 * MINUTE) }],
        source: 'agent',
        observedAt,
        plan: 'plus',
      },
    }
  }
  const usage = { every: Duration.zero, kept: Duration.zero, readAgent: answer, readVersion: async () => '2.0.29' }

  it.live('asks the plan again, only then, and takes the account back when the person has reset it', () =>
    Effect.gen(function* () {
      const projectId = yield* ready
      const account = yield* codexAccount
      asked.count = 0
      asked.left = 100
      // Nothing is out: listing the models reads nothing.
      assert.isTrue(yield* codexUsable(projectId))
      assert.strictEqual(asked.count, 0)

      // Out until tomorrow, though the person reset it since: the list reads it again, and it is back.
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      assert.isTrue(yield* codexUsable(projectId))
      assert.strictEqual(asked.count, 1)
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage }))),
  )

  it.live('keeps the account out when the plan has nothing left', () =>
    Effect.gen(function* () {
      const projectId = yield* ready
      const account = yield* codexAccount
      asked.count = 0
      asked.left = 0
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      assert.isFalse(yield* codexUsable(projectId))
      assert.strictEqual(asked.count, 1)
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage }))),
  )
})

describe('the model list, asking the plans again', () => {
  const homes: string[] = []
  const reading = (left: number): UsageRead => ({
    kind: 'usage',
    usage: {
      windows: [{ kind: 'five_hour', usedPercent: 100 - left, resetsAt: from(3 * 60 * MINUTE) }],
      source: 'agent',
      observedAt: new Date().toISOString(),
      plan: 'plus',
    },
  })
  const asking = (answer: (home: string) => UsageRead) => ({
    every: Duration.zero,
    kept: Duration.zero,
    readAgent: async (_agent: unknown, home: Readonly<Record<string, string>>): Promise<UsageRead> => {
      const one = JSON.stringify(home)
      homes.push(one)
      return answer(one)
    },
    readVersion: async () => '2.0.29',
  })

  it.live('keeps the account out when asking again fails or gives no windows', () => {
    let kind: 'failed' | 'none' = 'failed'
    return Effect.gen(function* () {
      const projectId = yield* ready
      const account = yield* codexAccount
      yield* limitedAt(account.id, ago(MINUTE), from(DAY))
      assert.isFalse(yield* codexUsable(projectId))
      kind = 'none'
      assert.isFalse(yield* codexUsable(projectId))
      assert.isTrue(Option.isSome(yield* (yield* Limits).outAccount(account.id)))
    }).pipe(
      Effect.provide(
        runtime(':memory:', {}, { usage: asking(() => (kind === 'failed' ? { kind: 'failed', message: 'Down.' } : { kind: 'none' })) }),
      ),
    )
  })

  it.live('asks again only the accounts that are out, not the agent’s others', () => {
    homes.length = 0
    return Effect.gen(function* () {
      const projectId = yield* ready
      const accounts = yield* Accounts
      const [first] = yield* accounts.of('codex')
      const second = yield* accounts.add({ agentId: 'codex', name: 'Work' })
      // Only the first is out: the model list asks for its reading again, and not for its sibling's.
      yield* limitedAt(first!.id, ago(MINUTE), from(DAY))
      yield* usableModels(projectId)
      assert.strictEqual(homes.length, 1)
      assert.isTrue(Option.isSome(yield* (yield* Limits).outAccount(first!.id)))
      assert.isTrue(Option.isNone(yield* (yield* Limits).outAccount(second.id)))
    }).pipe(Effect.provide(runtime(':memory:', {}, { usage: asking(() => ({ kind: 'failed', message: 'Down.' })) })))
  })
})
