import { Duplex, PassThrough } from 'node:stream'
import { MAX_PREVIEW_SOCKET_CHUNK } from '@althar/contracts'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { workerPreviewSockets } from '../src/workerPreviewSockets'

it.effect('expires an unclaimed preview connection and never uses it again', () =>
  Effect.gen(function* () {
    const service = workerPreviewSockets(yield* Effect.scope)
    const local = new PassThrough()
    const id = yield* service.open(Effect.succeed(local))
    yield* TestClock.adjust('6 seconds')
    assert.isTrue(local.destroyed)
    const missing = yield* Effect.flip(service.write(id, 'YWJj'))
    assert.strictEqual(missing.reason, 'NotFound')
  }),
)

it.effect('allows one preview reader, checks its payload and drops the socket at the end', () =>
  Effect.gen(function* () {
    const service = workerPreviewSockets(yield* Effect.scope)
    const local = new PassThrough()
    const id = yield* service.open(Effect.succeed(local))
    const data = 'YWJj'
    yield* Effect.flip(service.write(id, 'YWJj!'))
    yield* service.write(id, data)
    const received = yield* Stream.runCollect(service.read(id).pipe(Stream.take(1)))
    assert.deepStrictEqual(received, [data])
    assert.isTrue(local.destroyed)
    yield* Effect.flip(Stream.runCollect(service.read(id)))
    yield* service.close
    yield* Effect.flip(service.open(Effect.succeed(new PassThrough())))
  }),
)

it.effect('includes in-flight connections in the preview limit and disposes them when the client closes', () =>
  Effect.gen(function* () {
    const service = workerPreviewSockets(yield* Effect.scope)
    const began = yield* Deferred.make<void>()
    const connected = yield* Deferred.make<Duplex>()
    const opening = yield* Effect.forkScoped(
      service.open(Deferred.succeed(began, undefined).pipe(Effect.andThen(Deferred.await(connected)))),
    )
    yield* Deferred.await(began)
    const sockets = Array.from({ length: 7 }, () => new PassThrough())
    for (const socket of sockets) yield* service.open(Effect.succeed(socket))
    assert.strictEqual((yield* Effect.flip(service.open(Effect.die('The ninth connection must not be opened')))).reason, 'NotFound')
    yield* service.close
    const late = new PassThrough()
    yield* Deferred.succeed(connected, late)
    assert.strictEqual((yield* Effect.flip(Fiber.join(opening))).reason, 'NotFound')
    assert.isTrue(late.destroyed)
    assert.isTrue(sockets.every((socket) => socket.destroyed))
  }),
)

it.live('rejects a second reader and splits the preview stream into bounded chunks', () =>
  Effect.gen(function* () {
    const service = workerPreviewSockets(yield* Effect.scope)
    const local = new PassThrough()
    const id = yield* service.open(Effect.succeed(local))
    const reader = yield* Effect.forkScoped(Stream.runCollect(service.read(id)))
    yield* Effect.yieldNow
    assert.strictEqual((yield* Effect.flip(Stream.runCollect(service.read(id)))).reason, 'NotFound')
    const large = Buffer.alloc(MAX_PREVIEW_SOCKET_CHUNK + 4, 5)
    local.end(large)
    const received = (yield* Fiber.join(reader)).map((chunk) => Buffer.from(chunk, 'base64'))
    assert.deepStrictEqual(
      received.map((chunk) => chunk.length),
      [MAX_PREVIEW_SOCKET_CHUNK, 4],
    )
    assert.deepStrictEqual(Buffer.concat(received), large)
    yield* service.end(id)
  }),
)

it.live('holds one in-flight write and refuses invalid data before touching the preview socket', () =>
  Effect.gen(function* () {
    const service = workerPreviewSockets(yield* Effect.scope)
    const writing = yield* Deferred.make<(error: Error) => void>()
    const local = new Duplex({
      read: () => undefined,
      write: (_chunk, _encoding, callback) => Deferred.doneUnsafe(writing, Effect.succeed(callback)),
    })
    const id = yield* service.open(Effect.succeed(local))
    const invalid = ['', Buffer.alloc(MAX_PREVIEW_SOCKET_CHUNK + 1).toString('base64'), '0'.repeat(MAX_PREVIEW_SOCKET_CHUNK * 2)]
    for (const encoded of invalid) assert.strictEqual((yield* Effect.flip(service.write(id, encoded))).reason, 'NotFound')
    const running = yield* Effect.forkScoped(service.write(id, 'YWJj'))
    const refused = yield* Deferred.await(writing)
    assert.strictEqual((yield* Effect.flip(service.write(id, 'YWJj'))).reason, 'NotFound')
    refused(new Error('Worker tunnel closed'))
    assert.strictEqual((yield* Effect.flip(Fiber.join(running))).reason, 'NotFound')
  }),
)
