import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AccountStrategy } from '@althar/contracts'
import { Ids, newId, type ProjectId } from '@althar/domain'
import { isoAfter } from '@althar/testing'
import { assert, it } from '@effect/vitest'
import { Clock, Effect, Random } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { accountStrategyOf, Policies } from '../src/Policies'
import { newProjectDefaultsOf, setNewProjectDefaults } from '../src/plansAndReviews'
import { Projects } from '../src/Projects'
import { applyRules } from '../src/rulesChange'
import * as Runtime from '../src/Runtime'
import { repository, runtime, task } from './support'

const reading = (accountId: string, left: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const windows = [{ kind: 'five_hour', usedPercent: 100 - left, resetsAt: isoAfter(3_600_000) }]
    yield* sql`INSERT INTO plan_usage_readings ${sql.insert({
      accountId,
      agentId: 'codex',
      source: 'agent',
      plan: null,
      windows: JSON.stringify(windows),
      observedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })} ON CONFLICT (account_id) DO UPDATE SET windows = excluded.windows`
  })

it.live('chooses accounts by the saved strategy, keeps project restrictions, and switches away from low usage', () =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const limits = yield* Limits
    const instance = yield* Instance
    const { projectId } = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const [main] = yield* accounts.of('codex')
    const add = (name: string) => accounts.add({ agentId: 'codex', name, folder: mkdtempSync(join(tmpdir(), 'althar-strategy-')) })
    const work = yield* add('Work')
    const excluded = yield* add('Another client')
    yield* reading(main!.id, 6)
    yield* reading(work.id, 80)
    yield* reading(excluded.id, 99)
    const pick = Effect.map(limits.pick({ agentId: 'codex', projectId }), (account) => account.id)
    const strategy = (accountStrategy: AccountStrategy) =>
      applyRules(projectId, { accountStrategy, onlyAccounts: { codex: [main!.id, work.id] } }, instance.personId)

    for (const [chosen, expected] of [
      ['most_room', work.id],
      ['least_room', main!.id],
      ['in_order', main!.id],
      ['first', main!.id],
    ] as const) {
      yield* strategy(chosen)
      assert.strictEqual(yield* pick, expected)
    }

    yield* strategy('random')
    const random = yield* Effect.all(Array.from({ length: 20 }, () => pick)).pipe(Random.withSeed('account-strategy'))
    assert.sameMembers([...new Set(random)], [main!.id, work.id])

    yield* reading(main!.id, 3)
    for (const chosen of ['most_room', 'least_room', 'in_order', 'random'] as const) {
      yield* strategy(chosen)
      assert.strictEqual(yield* pick, work.id)
    }
    // Fixed-account mode retains the person's choice, even as its quota runs low.
    yield* strategy('first')
    assert.strictEqual(yield* pick, main!.id)
  }).pipe(Effect.provide(runtime())),
)

it.live('keeps a conversation on its account across strategy changes and random choices', () =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const limits = yield* Limits
    const instance = yield* Instance
    const { project, task: created } = yield* task('Keep the conversation account')
    const [main] = yield* accounts.of('codex')
    const work = yield* accounts.add({ agentId: 'codex', name: 'Work', folder: mkdtempSync(join(tmpdir(), 'althar-sticky-')) })
    yield* reading(main!.id, 6)
    yield* reading(work.id, 80)
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO provider_sessions ${sql.insert({
      id: yield* newId(Ids.providerSession),
      projectId: project.projectId,
      threadId: created.threadId,
      agentId: 'codex',
      accountId: main!.id,
      state: 'active',
      startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })}`
    for (const accountStrategy of ['most_room', 'least_room', 'random', 'in_order'] as const) {
      yield* applyRules(project.projectId, { accountStrategy }, instance.personId)
      const picked = yield* limits.pick({ agentId: 'codex', projectId: project.projectId, threadId: created.threadId })
      assert.strictEqual(picked.id, main!.id)
    }
  }).pipe(Effect.provide(runtime())),
)

it.live('persists the strategy for new projects and leaves existing projects on their own choice', () =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const policies = yield* Policies
    const before = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    yield* setNewProjectDefaults({ accountStrategy: 'least_room' })
    assert.deepInclude(yield* newProjectDefaultsOf, { accountStrategy: 'least_room', rotateAccounts: true })
    const after = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    assert.strictEqual(accountStrategyOf((yield* policies.current(before.projectId as ProjectId)).rules), 'first')
    assert.strictEqual(accountStrategyOf((yield* policies.current(after.projectId as ProjectId)).rules), 'least_room')
    yield* setNewProjectDefaults({ accountStrategy: 'first' })
    assert.deepInclude(yield* newProjectDefaultsOf, { accountStrategy: 'first', rotateAccounts: false })
    // An older client can still toggle rotation without leaving a contradictory strategy behind.
    yield* setNewProjectDefaults({ rotateAccounts: true })
    assert.deepInclude(yield* newProjectDefaultsOf, { accountStrategy: 'most_room', rotateAccounts: true })
  }).pipe(Effect.provide(runtime())),
)
