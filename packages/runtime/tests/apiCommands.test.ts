import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ApiError, type ClientIdentity } from '@althar/contracts'
import { Ids, newId } from '@althar/domain'
import { Database, Ledger } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer, Ref, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { ApiCommands } from '../src/ApiCommands'
import { RuntimeConfig, WebCrypto } from '../src/Config'
import { Instance } from '../src/Instance'

const environment = (filename = ':memory:') =>
  ApiCommands.layer.pipe(
    Layer.provideMerge(
      Instance.layer.pipe(
        Layer.provideMerge(Ledger.layer),
        Layer.provideMerge(Database.layer({ filename })),
        Layer.provideMerge(WebCrypto),
        Layer.provideMerge(Layer.succeed(RuntimeConfig, { worktreeRoot: tmpdir(), appVersion: 'test', deviceName: 'Host' })),
      ),
    ),
  )
const identity = Effect.map(Instance, (instance): ClientIdentity => ({
  homeId: instance.homeId,
  actorId: instance.personId,
  deviceId: instance.deviceId,
  role: 'window',
}))

describe('durable API command admission', () => {
  it.effect('rejects invalid command ids and unencodable payloads before admitting an external effect', () =>
    Effect.gen(function* () {
      const commands = yield* ApiCommands
      const commandId = yield* newId(Ids.command)
      const request = {
        identity: yield* identity,
        commandId,
        method: 'Publish',
        payload: {},
        result: Schema.String,
        handle: Effect.die('invalid request executed'),
      }
      assert.strictEqual((yield* Effect.flip(commands.execute({ ...request, commandId: 'not-a-command' }))).reason, 'InvalidCommand')
      assert.strictEqual((yield* Effect.flip(commands.execute({ ...request, payload: { unsupported: 1n } }))).reason, 'InvalidCommand')
      assert.strictEqual(yield* commands.execute({ ...request, handle: Effect.succeed('admitted once valid') }), 'admitted once valid')
    }).pipe(Effect.provide(environment())),
  )

  it.effect('preserves portable encoded results, including bytes, bigint and explicit undefined, in receipts', () =>
    Effect.gen(function* () {
      const commands = yield* ApiCommands
      const value = { bytes: new Uint8Array([0, 255]), id: 9007199254740993n, missing: undefined }
      const request = {
        identity: yield* identity,
        commandId: yield* newId(Ids.command),
        method: 'Portable',
        payload: {},
        result: Schema.Struct({ bytes: Schema.Uint8Array, id: Schema.BigInt, missing: Schema.Undefined }),
        handle: Effect.succeed(value),
      }
      assert.deepStrictEqual(yield* commands.execute(request), value)
      assert.deepStrictEqual(yield* commands.execute({ ...request, handle: Effect.die('replayed') }), value)
    }).pipe(Effect.provide(environment())),
  )

  it.effect('owns admitted resources independently of the request scope and releases them when the action ends', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commands = yield* ApiCommands
        const requestScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(requestScope, Exit.void))
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const closed = yield* Ref.make(0)
        const request = {
          identity: yield* identity,
          commandId: yield* newId(Ids.command),
          method: 'Publish',
          payload: {},
          result: Schema.String,
          handle: Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () => Ref.update(closed, (count) => count + 1))
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return 'done'
          }),
        }
        yield* Effect.forkIn(commands.execute(request).pipe(Scope.provide(requestScope)), requestScope)
        yield* Deferred.await(entered)
        yield* Scope.close(requestScope, Exit.void)
        assert.strictEqual(yield* Ref.get(closed), 0)
        yield* Deferred.succeed(release, undefined)
        assert.strictEqual(yield* commands.execute({ ...request, handle: Effect.die('replayed') }), 'done')
        assert.strictEqual(yield* Ref.get(closed), 1)
      }),
    ).pipe(Effect.provide(environment())),
  )

  it.effect('coalesces concurrent requests and rejects a changed method or payload under the same command id', () =>
    Effect.gen(function* () {
      const commands = yield* ApiCommands
      const caller = yield* identity
      const commandId = yield* newId(Ids.command)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const count = yield* Ref.make(0)
      const handle = Effect.gen(function* () {
        yield* Ref.update(count, (n) => n + 1)
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
        return { id: 'kept' }
      })
      const request = {
        identity: caller,
        commandId,
        method: 'Make',
        payload: { b: 2, a: 1 },
        result: Schema.Struct({ id: Schema.String }),
        handle,
      }
      const first = yield* Effect.forkChild(commands.execute(request))
      yield* Deferred.await(entered)
      const retry = yield* Effect.forkChild(commands.execute({ ...request, payload: { a: 1, b: 2 } }))
      const collision = yield* Effect.flip(commands.execute({ ...request, method: 'Other' }))
      assert.strictEqual(collision.reason, 'CommandIdReused')
      assert.strictEqual((yield* Effect.flip(commands.execute({ ...request, payload: { a: 3 } }))).reason, 'CommandIdReused')
      assert.strictEqual(
        (yield* Effect.flip(commands.execute({ ...request, identity: { ...caller, role: 'socket' } }))).reason,
        'CommandIdReused',
      )
      yield* Deferred.succeed(release, undefined)
      assert.deepStrictEqual(yield* Fiber.join(first), { id: 'kept' })
      assert.deepStrictEqual(yield* Fiber.join(retry), { id: 'kept' })
      assert.strictEqual(yield* Ref.get(count), 1)
    }).pipe(Effect.provide(environment())),
  )

  it.effect('retains typed refusals and releases capacity after commands complete', () =>
    Effect.gen(function* () {
      const commands = yield* ApiCommands
      const caller = yield* identity
      const request = {
        identity: caller,
        commandId: yield* newId(Ids.command),
        method: 'Refuse',
        payload: {},
        result: Schema.String,
        handle: Effect.fail(new ApiError({ reason: 'ChangedSinceSeen', message: 'Read it again.' })),
      }
      assert.strictEqual((yield* Effect.flip(commands.execute(request))).message, 'Read it again.')
      assert.strictEqual(
        (yield* Effect.flip(commands.execute({ ...request, handle: Effect.die('retried a refusal') }))).reason,
        'ChangedSinceSeen',
      )
      const release = yield* Deferred.make<void>()
      const requests = yield* Effect.forEach(Array.from({ length: 16 }), () =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const pending = yield* Effect.forkChild(
            commands.execute({
              ...request,
              commandId: yield* newId(Ids.command),
              handle: Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(release), 'done')),
            }),
          )
          yield* Deferred.await(entered)
          return pending
        }),
      )
      assert.strictEqual(
        (yield* Effect.flip(commands.execute({ ...request, commandId: yield* newId(Ids.command) }))).reason,
        'CommandCapacity',
      )
      yield* Deferred.succeed(release, undefined)
      yield* Effect.forEach(requests, Fiber.join)
      assert.strictEqual(
        yield* commands.execute({ ...request, commandId: yield* newId(Ids.command), handle: Effect.succeed('available') }),
        'available',
      )
    }).pipe(Effect.provide(environment())),
  )

  it.live('quarantines a pending intent left by a process crash before accepting retries', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-command-crash-')), 'profile.sqlite')
      const commandId = `cmd_${'c'.repeat(32)}`
      const request = Effect.gen(function* () {
        return {
          identity: yield* identity,
          commandId,
          method: 'Publish',
          payload: {},
          result: Schema.String,
          handle: Effect.succeed('published'),
        }
      })
      yield* Effect.gen(function* () {
        yield* (yield* ApiCommands).execute(yield* request)
      }).pipe(Effect.provide(environment(file)))
      // The durable state at a hard process loss: admission committed, completion absent.
      yield* Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`UPDATE api_commands SET state = 'pending', result = NULL, error = NULL, completed_at = NULL WHERE command_id = ${commandId}`,
      ).pipe(Effect.provide(Database.layer({ filename: file })))
      const error = yield* Effect.gen(function* () {
        return yield* Effect.flip((yield* ApiCommands).execute({ ...(yield* request), handle: Effect.die('replayed an external action') }))
      }).pipe(Effect.provide(environment(file)))
      assert.strictEqual(error.reason, 'CommandOutcomeUnknown')
    }),
  )

  it.live('returns a completed result across runtime restarts without performing the effect again', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-command-')), 'profile.sqlite')
      const commandId = `cmd_${'a'.repeat(32)}`
      const execute = (handle: Effect.Effect<string, ApiError>) =>
        Effect.gen(function* () {
          return yield* (yield* ApiCommands).execute({
            identity: yield* identity,
            commandId,
            method: 'Publish',
            payload: { target: 'main' },
            result: Schema.String,
            handle,
          })
        }).pipe(Effect.provide(environment(file)))
      assert.strictEqual(yield* execute(Effect.succeed('published')), 'published')
      assert.strictEqual(yield* execute(Effect.die('external effect repeated')), 'published')
    }),
  )

  it.effect('continues an admitted command after its requesting connection is cancelled', () =>
    Effect.gen(function* () {
      const commands = yield* ApiCommands
      const caller = yield* identity
      const commandId = yield* newId(Ids.command)
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const request = {
        identity: caller,
        commandId,
        method: 'Merge',
        payload: {},
        result: Schema.String,
        handle: Effect.andThen(Deferred.succeed(entered, undefined), Effect.andThen(Deferred.await(release), Effect.succeed('merged'))),
      }
      const disconnected = yield* Effect.forkChild(commands.execute(request))
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(disconnected)
      yield* Deferred.succeed(release, undefined)
      assert.strictEqual(yield* commands.execute({ ...request, handle: Effect.die('ran twice') }), 'merged')
    }).pipe(Effect.provide(environment())),
  )

  it.live('refuses to repeat an action whose outcome was not recorded before the runtime stopped', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-command-')), 'profile.sqlite')
      const commandId = `cmd_${'b'.repeat(32)}`
      yield* Effect.gen(function* () {
        const commands = yield* ApiCommands
        const entered = yield* Deferred.make<void>()
        yield* Effect.forkScoped(
          commands.execute({
            identity: yield* identity,
            commandId,
            method: 'Merge',
            payload: {},
            result: Schema.String,
            handle: Effect.andThen(Deferred.succeed(entered, undefined), Effect.never),
          }),
        )
        yield* Deferred.await(entered)
      }).pipe(Effect.scoped, Effect.provide(environment(file)))
      const failure = yield* Effect.gen(function* () {
        return yield* Effect.flip(
          (yield* ApiCommands).execute({
            identity: yield* identity,
            commandId,
            method: 'Merge',
            payload: {},
            result: Schema.String,
            handle: Effect.die('unsafe replay'),
          }),
        )
      }).pipe(Effect.provide(environment(file)))
      assert.strictEqual(failure.reason, 'CommandOutcomeUnknown')
    }),
  )
})
