import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { TestClock } from 'effect/testing'

import { Ids, newId, TaskId, RunId } from '../src/ids'
import { WebCrypto } from './crypto'

describe('ids', () => {
  it.effect('are a prefix, an underscore and 32 hex digits', () =>
    Effect.gen(function* () {
      const task = yield* newId(Ids.task)
      const run = yield* newId(Ids.run)
      assert.match(task, /^task_[0-9a-f]{32}$/)
      assert.match(run, /^run_[0-9a-f]{32}$/)
    }).pipe(Effect.provide(WebCrypto)),
  )

  it.effect('sort in the order they were made', () =>
    Effect.gen(function* () {
      const first = yield* newId(Ids.task)
      yield* TestClock.adjust(1)
      const second = yield* newId(Ids.task)
      yield* TestClock.adjust(60_000)
      const third = yield* newId(Ids.task)
      assert.deepStrictEqual([third, first, second].toSorted(), [first, second, third])
    }).pipe(Effect.provide(WebCrypto)),
  )

  it.effect('are never repeated', () =>
    Effect.gen(function* () {
      const ids = yield* Effect.all(Array.from({ length: 500 }, () => newId(Ids.node)))
      assert.strictEqual(new Set(ids).size, ids.length)
    }).pipe(Effect.provide(WebCrypto)),
  )

  it('reject another kind of id, and anything malformed', () => {
    const isTaskId = Schema.is(TaskId)
    assert.isTrue(isTaskId('task_0192f0b3c4d57e8f9a0b1c2d3e4f5a6b'))
    assert.isFalse(isTaskId('run_0192f0b3c4d57e8f9a0b1c2d3e4f5a6b'))
    assert.isFalse(isTaskId('task_0192F0B3C4D57E8F9A0B1C2D3E4F5A6B'))
    assert.isFalse(isTaskId('task_0192f0b3'))
    assert.isFalse(isTaskId('task-0192f0b3c4d57e8f9a0b1c2d3e4f5a6b'))
    assert.isFalse(Schema.is(RunId)('task_0192f0b3c4d57e8f9a0b1c2d3e4f5a6b'))
  })

  it('have one prefix per kind', () => {
    const prefixes = Object.values(Ids).map((kind) => kind.prefix)
    assert.strictEqual(new Set(prefixes).size, prefixes.length)
    for (const prefix of prefixes) assert.match(prefix, /^[a-z]{2,5}$/)
  })
})
