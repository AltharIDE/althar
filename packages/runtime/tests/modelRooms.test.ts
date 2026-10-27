import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UsageWindow } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { modelRooms } from '../src/modelRooms'
import { Models } from '../src/Models'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * Each model's room where work on it would start, as the pickers show it:
 * on the account steering would pick (the most room where the project
 * rotates, the first where it doesn't), a model's own window counted, and
 * nothing for an agent whose plan isn't read.
 */

const HOUR = 60 * 60 * 1000

/** What PlanUsage would have kept for an account: its windows, as last read. */
const reading = (accountId: string, agentId: string, windows: ReadonlyArray<UsageWindow>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO plan_usage_readings ${sql.insert({ accountId, agentId, source: 'agent', plan: null, windows: JSON.stringify(windows), observedAt: new Date().toISOString() })}
      ON CONFLICT (account_id) DO UPDATE SET windows = excluded.windows`
  })

const left = (percent: number, resetsAt: string, label?: string): UsageWindow => ({
  kind: label === undefined ? 'five_hour' : 'weekly',
  usedPercent: 100 - percent,
  resetsAt,
  ...(label === undefined ? {} : { label, model: label.toLowerCase() }),
})

const ready = Effect.gen(function* () {
  const models = yield* Models
  yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
  const projects = yield* Projects
  return (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
})

describe('each model’s room', () => {
  it.live(
    'is on the account with the most room where the project rotates, named as one of several, and on the first where it doesn’t',
    () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts
        const policies = yield* Policies
        const instance = yield* Instance
        const projectId = yield* ready
        const [usual] = yield* accounts.of('codex')
        const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: mkdtempSync(join(tmpdir(), 'althar-rooms-')) })
        const resetsAt = new Date(Date.now() + HOUR).toISOString()
        yield* reading(usual!.id, 'codex', [left(30, resetsAt)])
        yield* reading(work.id, 'codex', [left(80, resetsAt)])
        const codexIn = <R extends { readonly agentId: string }>(rooms: ReadonlyArray<R>) =>
          rooms.filter((room) => room.agentId === 'codex')

        yield* policies.setAccounts(projectId, { rotate: true }, instance.personId)
        const rotating = codexIn(yield* modelRooms(projectId))
        assert.isAbove(rotating.length, 0)
        for (const room of rotating)
          assert.deepStrictEqual(
            [room.accountName, room.several, room.leftPercent, room.kind, room.resetsAt],
            ['work', true, 80, 'five_hour', resetsAt],
          )

        yield* policies.setAccounts(projectId, { rotate: false }, instance.personId)
        for (const room of codexIn(yield* modelRooms(projectId)))
          assert.deepStrictEqual([room.accountId, room.leftPercent], [usual!.id, 30])
      }).pipe(Effect.provide(runtime())),
  )

  it.live('counts a model’s own window for it alone, and gives none to an agent whose plan isn’t read', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const models = yield* Models
      yield* ready
      const [claude] = yield* accounts.of('claude-code')
      const resetsAt = new Date(Date.now() + 50 * HOUR).toISOString()
      const offered = (yield* models.catalog).find((agent) => agent.agentId === 'claude-code')?.models ?? []
      // The fake agent offers Small and Large: Large has a week of its own, as Opus does.
      const opus = offered.find((model) => model.id === 'large')
      const other = offered.find((model) => model.id === 'small')
      assert.isDefined(opus)
      assert.isDefined(other)
      yield* reading(claude!.id, 'claude-code', [left(60, resetsAt), left(8, resetsAt, 'Large')])
      const rooms = yield* modelRooms()
      const of = (model: string) => rooms.find((room) => room.agentId === 'claude-code' && room.model === model)
      assert.deepStrictEqual([of(opus!.id)?.leftPercent, of(opus!.id)?.label], [8, 'Large'])
      assert.deepStrictEqual([of(other!.id)?.leftPercent, of(other!.id)?.label], [60, null])
      // OpenCode's plan has nothing read: no room, so the picker says why from the plan usage instead.
      assert.isFalse(rooms.some((room) => room.agentId === 'opencode'))
    }).pipe(Effect.provide(runtime())),
  )
})
