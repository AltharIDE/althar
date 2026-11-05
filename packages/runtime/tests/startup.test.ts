import { assert, describe, it } from '@effect/vitest'
import { Context, Deferred, Effect, Fiber, Layer } from 'effect'

import { AfterOpen, afterOpen } from '../src/startup'
import { ModelFacts } from '../src/ModelFacts'
import { SqlClient } from 'effect/sql'
import { fetchBranch, git } from '../src/git'
import { repository, runtime, until } from './support'

describe('startup background work', () => {
  it.live('builds the store and serves local reads while the first screen holds network work', () => {
    let fetched = false
    const fetch = async () => {
      fetched = true
      return Response.json({ data: [{ id: 'test/large', context_length: 1000 }] })
    }
    return Effect.gen(function* () {
      const opened = yield* Deferred.make<void>()
      const context = yield* Layer.build(runtime(':memory:', {}, { modelFacts: { url: 'https://models.test/list', fetch } })).pipe(
        Effect.provideService(AfterOpen, Deferred.await(opened)),
      )
      const sql = Context.get(context, SqlClient.SqlClient)
      const projects = yield* sql`SELECT id FROM projects`
      assert.deepStrictEqual(projects, [])
      assert.isFalse(fetched)
      yield* Deferred.succeed(opened, undefined)
      yield* until(
        Effect.sync(() => fetched),
        Boolean,
      )
      const facts = yield* Effect.provideContext(ModelFacts, context)
      yield* until(
        Effect.sync(() => facts.of({ id: 'test', name: 'Test' }, { id: 'large', name: 'Large' })),
        (fact) => fact !== null,
      )
    }).pipe(Effect.scoped)
  })

  it.live('holds repository fetches while local git reads still answer', () =>
    Effect.gen(function* () {
      const repo = repository()
      yield* git(repo, 'remote', 'add', 'origin', repo)
      const opened = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      let finished = false
      const fetch = yield* Effect.forkChild(
        fetchBranch(repo, 'main').pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              finished = true
            }),
          ),
          Effect.provideService(AfterOpen, Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(opened))),
        ),
      )
      yield* Deferred.await(entered)
      assert.isNotEmpty(yield* git(repo, 'rev-parse', 'HEAD'))
      assert.isFalse(finished)
      yield* Deferred.succeed(opened, undefined)
      assert.isTrue(yield* Fiber.join(fetch))
      assert.isTrue(finished)
    }),
  )

  it.effect('interrupts work waiting for the first screen when the runtime closes', () =>
    Effect.gen(function* () {
      const opened = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      let ran = false
      const waiting = yield* Effect.forkChild(
        afterOpen(
          Effect.sync(() => {
            ran = true
          }),
        ).pipe(Effect.provideService(AfterOpen, Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(opened)))),
      )
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(waiting)
      yield* Deferred.succeed(opened, undefined)
      assert.isFalse(ran)
    }),
  )
})
