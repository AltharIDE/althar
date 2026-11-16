import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { API_VERSION, ApiError, ConnectionInfo, emitterPort, serverProtocol, type ClientIdentity } from '@althar/contracts'
import { removeTreeSync } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { Rpc, RpcGroup, RpcServer } from 'effect/rpc'

import { authenticateApiClient, readFrame } from '../src/authentication'
import { apiClient, openLocalConnection } from '../src/client'
import { socketPort } from '../src/socketPort'
import { openApiSocket } from '../src/socket'

const homeId = `home_${'1'.repeat(32)}`
const identity: ClientIdentity = { homeId, actorId: `act_${'2'.repeat(32)}`, deviceId: `dev_${'3'.repeat(32)}`, role: 'socket' }
const info = {
  identity,
  hostDeviceId: `dev_${'4'.repeat(32)}`,
  apiVersion: API_VERSION,
  appVersion: 'test',
  position: { homeId, cursor: 0, checkpoint: null },
}
const Mini = RpcGroup.make(Rpc.make('GetConnectionInfo', { payload: {}, success: ConnectionInfo, error: ApiError }))
const mini = (port: Parameters<typeof serverProtocol>[0], value = info) =>
  Layer.launch(
    RpcServer.layer(Mini).pipe(
      Layer.provide(Mini.toLayer({ GetConnectionInfo: () => Effect.succeed(value) })),
      Layer.provide(serverProtocol(port)),
    ),
  )
const pair = () =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        channel.port1.close()
        channel.port2.close()
      }),
    )
    return {
      channel,
      port: {
        ...emitterPort(channel.port2),
        close: () => channel.port2.close(),
        closed: (handler: () => void) => emitterPort(channel.port2).closed!(handler),
        setFrameLimit: () => {},
      },
    }
  })

describe('client connection boundaries', () => {
  it.effect('bounds an authenticated server that never answers the API identity check', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = yield* pair()
        const asked = yield* Deferred.make<void>()
        yield* Effect.forkScoped(
          Layer.launch(
            RpcServer.layer(Mini).pipe(
              Layer.provide(Mini.toLayer({ GetConnectionInfo: () => Effect.andThen(Deferred.succeed(asked, undefined), Effect.never) })),
              Layer.provide(serverProtocol(emitterPort(at.channel.port1))),
            ),
          ),
        )
        const binding = yield* Effect.forkScoped(Effect.flip(apiClient({ port: at.port, identity })))
        yield* Deferred.await(asked)
        yield* TestClock.adjust('10 seconds')
        assert.strictEqual((yield* Fiber.join(binding)).reason, 'HostUnavailable')
      }),
    ),
  )
  it.live('authenticates and binds a real private socket, then closes only that connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = mkdtempSync(join(tmpdir(), 'althar-client-test-'))
        yield* Effect.addFinalizer(() => Effect.sync(() => removeTreeSync(root)))
        mkdirSync(join(root, 'api'), { mode: 0o700 })
        const address =
          process.platform === 'win32' ? `\\\\.\\pipe\\althar-client-${process.pid}-${root.split(/[/\\]/).at(-1)}` : join(root, 'api.sock')
        const secret = 'a'.repeat(64)
        const sockets = new Set<ReturnType<typeof socketPort>>()
        const scope = yield* Effect.scope
        const server = createServer((socket) => {
          const port = socketPort(socket)
          sockets.add(port)
          Effect.runFork(
            Effect.forkIn(
              Effect.scoped(
                Effect.gen(function* () {
                  const hello = yield* readFrame(port)
                  assert.deepStrictEqual(hello, {
                    type: 'Hello',
                    protocol: 1,
                    homeId,
                    apiVersion: API_VERSION,
                    auth: { kind: 'secret', secret },
                  })
                  port.post({ type: 'Authenticated', identity, apiVersion: API_VERSION })
                  yield* mini(port)
                }),
              ),
              scope,
            ),
          )
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(
            () =>
              new Promise<void>((done) => {
                for (const socket of sockets) socket.close()
                server.close(() => done())
              }),
          ),
        )
        yield* Effect.promise(() => new Promise<void>((done) => server.listen(address, done)))
        writeFileSync(join(root, 'api/endpoint.json'), JSON.stringify({ protocol: 1, homeId, apiVersion: API_VERSION, address, secret }), {
          mode: 0o600,
        })
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* openLocalConnection(root, homeId)
            assert.deepStrictEqual(connection.identity, identity)
            assert.deepStrictEqual((yield* apiClient(connection)).info, info)
          }),
        )
        assert.isTrue(server.listening)
        const unavailable = yield* Effect.scoped(
          Effect.flip(openApiSocket(process.platform === 'win32' ? `${address}-missing` : join(root, 'absent.sock'))),
        )
        assert.strictEqual(unavailable.reason, 'SocketUnavailable')
      }),
    ),
  )
  it.live('rejects an RPC endpoint that changes identity, version or history home after authentication', () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const [change, reason] of [
          [{ identity: { ...identity, actorId: `act_${'5'.repeat(32)}` } }, 'AuthenticationFailed'],
          [{ identity: { ...identity, deviceId: `dev_${'5'.repeat(32)}` } }, 'AuthenticationFailed'],
          [{ identity: { ...identity, role: 'paired_device' as const } }, 'AuthenticationFailed'],
          [{ apiVersion: 2 }, 'ApiVersionMismatch'],
          [{ position: { ...info.position, homeId: `home_${'5'.repeat(32)}` } }, 'HomeMismatch'],
        ] as const) {
          const at = yield* pair()
          yield* Effect.forkScoped(mini(emitterPort(at.channel.port1), { ...info, ...change }))
          assert.strictEqual((yield* Effect.flip(apiClient({ port: at.port, identity }))).reason, reason)
        }
      }),
    ),
  )
  it.live('signs a valid challenge and rejects mismatched or elevated device readiness', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const challenge = { protocol: 1, homeId, deviceId: identity.deviceId, apiVersion: API_VERSION, nonce: 'A'.repeat(43), expiresAt: 1 }
        for (const readyIdentity of [
          { ...identity, role: 'paired_device' as const },
          { ...identity, role: 'socket' as const },
          { ...identity, deviceId: `dev_${'9'.repeat(32)}` },
          { ...identity, role: 'window' as const },
        ]) {
          const at = yield* pair()
          let proofs = 0
          at.channel.port1.on('message', (message) => {
            if (message.type === 'Hello') at.channel.port1.postMessage(challenge)
            else {
              proofs++
              assert.strictEqual(message.type, 'Proof')
              at.channel.port1.postMessage({ type: 'Authenticated', identity: readyIdentity, apiVersion: API_VERSION })
            }
          })
          const outcome = yield* Effect.result(
            authenticateApiClient(at.port, homeId, {
              kind: 'device',
              deviceId: identity.deviceId,
              sign: (message) =>
                Effect.sync(() => {
                  assert.include(message, 'althar.client.authentication')
                  return 'A'.repeat(86)
                }),
            }),
          )
          assert.strictEqual(proofs, 1)
          assert.strictEqual(
            outcome._tag,
            readyIdentity.deviceId === identity.deviceId && readyIdentity.role !== 'window' ? 'Success' : 'Failure',
          )
        }
        const at = yield* pair()
        at.channel.port1.close()
        assert.strictEqual((yield* Effect.flip(readFrame(at.port))).reason, 'ConnectionClosed')
        let released = false
        assert.strictEqual(
          yield* readFrame({
            post: () => {},
            listen: (handler) => {
              handler('one')
              return () => {
                released = true
              }
            },
          }),
          'one',
        )
        assert.isTrue(released)
      }),
    ),
  )
})
