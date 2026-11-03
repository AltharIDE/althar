import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import type { UsageWindow } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Limits } from '../src/Limits'
import { Instance } from '../src/Instance'
import { modelRooms } from '../src/modelRooms'
import { Models } from '../src/Models'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { usableModels } from '../src/usableModels'
import { fakeAgents, repository, runtime, task, until } from './support'

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

  it.live('gives OpenCode Go’s models Go’s room, on the account whose Go key works, though another has the reading', () => {
    // OpenCode paid per use on its keys, every model through OpenCode Go, a plan; each home lists Go's key as its own.
    const goAgents = Layer.effect(
      Agents,
      Effect.gen(function* () {
        const agents = yield* Agents
        const go = (entry: (typeof agents.list)[number]) =>
          entry.definition.id !== 'opencode'
            ? entry
            : {
                ...entry,
                definition: {
                  ...entry.definition,
                  signIn: {
                    ...entry.definition.signIn,
                    providers: {
                      read: (output: string) => [
                        { id: 'opencode-go', name: 'OpenCode Go', connections: output.trim(), pays: 'plan' as const },
                      ],
                      of: () => 'opencode-go',
                      plans: ['opencode-go'],
                    },
                  },
                },
              }
        return Agents.of({ list: agents.list.map(go), get: (id) => Effect.map(agents.get(id), go) })
      }),
    ).pipe(Layer.provide(fakeAgents({}, [], {}, ['opencode'])))
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const limits = yield* Limits
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* ready
      const [personal] = yield* accounts.of('opencode')
      const fresh = yield* accounts.add({ agentId: 'opencode', name: 'Account 2', folder: mkdtempSync(join(tmpdir(), 'althar-go-')) })
      const resetsAt = new Date(Date.now() + HOUR).toISOString()
      yield* reading(personal!.id, 'opencode', [left(60, resetsAt)])
      const goRoute = Effect.map(usableModels(projectId), (all) =>
        all.flatMap((model) => model.routes).find((route) => route.agentId === 'opencode' && route.model === 'large'),
      )
      // Go's key working on the account read: Go's room, though the account itself is paid per use.
      const room = (yield* modelRooms(projectId)).find((one) => one.agentId === 'opencode' && one.model === 'large')
      assert.deepStrictEqual([room?.accountId, room?.leftPercent], [personal!.id, 60])
      const read = yield* goRoute
      assert.deepStrictEqual([read?.plan, read?.room?.leftPercent, read?.refusedProvider], [true, 60, undefined])

      // Go refuses that account's key, as an expired one is: the fresh one in the new account takes Go's models.
      const { project, task: created } = yield* task('Ask Go')
      const sessionId = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: sessionId,
        projectId: project.projectId,
        threadId: created.threadId,
        agentId: 'opencode',
        accountId: personal!.id,
        state: 'active',
        startedAt: new Date().toISOString(),
      })}`
      const endedAt = new Date().toISOString()
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({
        id: yield* newId(Ids.turnDelivery),
        projectId: project.projectId,
        threadId: created.threadId,
        providerSessionId: sessionId,
        controllerGeneration: 1,
        state: 'failed',
        origin: 'person',
        model: 'large',
        errorClass: 'auth_required',
        endedAt,
        requestedAt: endedAt,
      })}`
      assert.strictEqual((yield* limits.pick({ agentId: 'opencode', model: 'large', projectId })).id, fresh.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'opencode', model: 'large' })).id, fresh.id)
      // The thread that ran on the refused account moves too.
      assert.strictEqual((yield* limits.pick({ agentId: 'opencode', model: 'large', threadId: created.threadId })).id, fresh.id)
      const moved = yield* goRoute
      assert.isUndefined(moved?.refusedProvider)
      assert.deepInclude(moved, { plan: true, room: null })
      // A model with no provider of its own still starts on the first.
      assert.strictEqual((yield* limits.pick({ agentId: 'opencode', projectId })).id, personal!.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents: goAgents })))
  })
})
