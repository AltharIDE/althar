import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Ledger } from '../src/Ledger'
import { seed } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Ledger.layer.pipe(Layer.provideMerge(Layer.mergeAll(InMemory, WebCrypto)))

describe('Ledger', () => {
  it.effect('tells clients about a change without recording a fact', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* seed
      yield* ledger.notify({ projectId, aggregateType: 'thread_item', aggregateId: 'item_1', aggregateRevision: 2 })
      const [change] = yield* ledger.changesSince(0, 10)
      assert.deepStrictEqual(
        { type: change?.aggregateType, id: change?.aggregateId, revision: change?.aggregateRevision },
        { type: 'thread_item', id: 'item_1', revision: 2 },
      )
      const [events] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM record_events`
      assert.strictEqual(events?.count, 0)
    }).pipe(Effect.provide(Env)),
  )

  it.live('wakes a listener when the feed grows, and only then', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ledger = yield* Ledger
        const { actorId, projectId } = yield* seed
        const grown = yield* ledger.listen
        // Nothing yet: the wait doesn't return.
        assert.isTrue(Exit.isFailure(yield* Effect.exit(Effect.timeout(grown, '10 millis'))))
        yield* ledger.notify({ projectId, aggregateType: 'thread_item', aggregateId: 'item_1', aggregateRevision: 1 })
        yield* grown
        yield* ledger.record({
          aggregateType: 'project',
          aggregateId: projectId,
          aggregateRevision: 1,
          type: 'project.renamed',
          payload: {},
          actorId,
        })
        yield* ledger.notify({ projectId, aggregateType: 'thread_item', aggregateId: 'item_1', aggregateRevision: 2 })
        // Several changes since it last looked wake it once, not once each.
        yield* grown
        assert.isTrue(Exit.isFailure(yield* Effect.exit(Effect.timeout(grown, '10 millis'))))
      }),
    ).pipe(Effect.provide(Env)),
  )

  it.effect('records a fact and tells clients the aggregate changed', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const sql = yield* SqlClient.SqlClient
      const { actorId, projectId } = yield* seed
      yield* TestClock.adjust(5)
      const event = yield* ledger.record({
        projectId,
        aggregateType: 'project',
        aggregateId: projectId,
        aggregateRevision: 1,
        type: 'project.created',
        payload: { name: 'Meridian' },
        actorId,
      })
      assert.match(event.id, /^evt_[0-9a-f]{32}$/)
      assert.strictEqual(event.occurredAt, '1970-01-01T00:00:00.005Z')
      const [stored] = yield* sql<{ payload: string; commandId: string | null }>`SELECT payload, command_id FROM record_events`
      assert.deepStrictEqual(JSON.parse(stored?.payload ?? ''), { name: 'Meridian' })
      assert.isNull(stored?.commandId)
      const changes = yield* ledger.changesSince(0, 10)
      assert.deepStrictEqual(
        changes.map((change) => [change.projectId, change.aggregateType, change.aggregateId, change.aggregateRevision]),
        [[projectId, 'project', projectId, 1]],
      )
    }).pipe(Effect.provide(Env)),
  )

  it.effect('feeds changes in order, from any cursor, a page at a time', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const { actorId, projectId } = yield* seed
      for (const revision of [1, 2, 3, 4, 5]) {
        yield* ledger.record({
          aggregateType: 'project',
          aggregateId: projectId,
          aggregateRevision: revision,
          type: 'project.renamed',
          payload: {},
          actorId,
        })
      }
      const firstPage = yield* ledger.changesSince(0, 2)
      assert.deepStrictEqual(
        firstPage.map((change) => change.aggregateRevision),
        [1, 2],
      )
      const rest = yield* ledger.changesSince(firstPage.at(-1)?.cursor ?? 0, 10)
      assert.deepStrictEqual(
        rest.map((change) => change.aggregateRevision),
        [3, 4, 5],
      )
      assert.isTrue(rest.every((change, index) => index === 0 || change.cursor > (rest[index - 1]?.cursor ?? 0)))
      assert.lengthOf(yield* ledger.changesSince(rest.at(-1)?.cursor ?? 0, 10), 0)
      assert.lengthOf(yield* ledger.changesSince(0, 0), 1)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('refuses a malformed fact', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const { actorId, projectId } = yield* seed
      const exit = yield* Effect.exit(
        ledger.record({ aggregateType: 'project', aggregateId: projectId, aggregateRevision: 0, type: 'Created', payload: {}, actorId }),
      )
      assert.isTrue(Exit.isFailure(exit))
      assert.lengthOf(yield* ledger.changesSince(0, 10), 0)
    }).pipe(Effect.provide(Env)),
  )

  it.effect("commits with the caller's write, or not at all", () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const sql = yield* SqlClient.SqlClient
      const { actorId, projectId } = yield* seed
      const renameThenFail = Effect.gen(function* () {
        yield* sql`UPDATE projects SET name = 'Renamed' WHERE id = ${projectId}`
        yield* ledger.record({
          aggregateType: 'project',
          aggregateId: projectId,
          aggregateRevision: 2,
          type: 'project.renamed',
          payload: {},
          actorId,
        })
        return yield* Effect.fail('the command failed after recording')
      }).pipe(sql.withTransaction)
      assert.isTrue(Exit.isFailure(yield* Effect.exit(renameThenFail)))
      const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
      assert.strictEqual(project?.name, 'Meridian')
      assert.lengthOf(yield* sql`SELECT 1 FROM record_events`, 0)
      assert.lengthOf(yield* ledger.changesSince(0, 10), 0)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('stores an empty payload when a fact has none', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      const sql = yield* SqlClient.SqlClient
      const { actorId, projectId } = yield* seed
      yield* ledger.record({
        aggregateType: 'project',
        aggregateId: projectId,
        aggregateRevision: 1,
        type: 'project.opened',
        payload: undefined,
        actorId,
      })
      const [stored] = yield* sql<{ payload: string }>`SELECT payload FROM record_events`
      assert.strictEqual(stored?.payload, '{}')
    }).pipe(Effect.provide(Env)),
  )
})
