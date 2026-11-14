import { randomBytes, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  API_VERSION,
  ApiError,
  ClientChallenge,
  ClientIdentity,
  ClientSignature,
  HomeId,
  clientChallengeMessage,
  type PortLike,
} from '@althar/contracts'
import { Cause, Effect, Layer, Option, Schema, type Scope } from 'effect'

import { connection } from './Api'
import { ClientIdentities } from './ClientIdentities'
import { Instance } from './Instance'
import { MAX_SOCKET_FRAME, socketPort, type SocketPort } from './socketPort'

const AUTH_FRAME_LIMIT = 16 * 1024
const MAX_CONNECTIONS = 32
const failed = () =>
  new ApiError({
    reason: 'AuthenticationFailed',
    message: 'This connection could not authenticate. Check the home and pair the device again.',
  })
const closed = () => new ApiError({ reason: 'ConnectionClosed', message: 'The Althar connection closed.' })
const unavailable = () => new ApiError({ reason: 'SocketUnavailable', message: 'Althar could not open its private API connection.' })
const Hello = Schema.Struct({
  type: Schema.Literal('Hello'),
  protocol: Schema.Literal(1),
  homeId: HomeId,
  apiVersion: Schema.Int,
  auth: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('secret'), secret: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)) }),
    Schema.Struct({ kind: Schema.Literal('device'), deviceId: Schema.String }),
  ]),
})
const Proof = Schema.Struct({ type: Schema.Literal('Proof'), challenge: ClientChallenge, signature: ClientSignature })
const Ready = Schema.Struct({ type: Schema.Literal('Authenticated'), identity: ClientIdentity, apiVersion: Schema.Int })

export const LocalApiEndpoint = Schema.Struct({
  protocol: Schema.Literal(1),
  homeId: HomeId,
  apiVersion: Schema.Int,
  address: Schema.String,
  /** Private profile file only. Possession grants socket authority, never the person's approval authority. */
  secret: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
})
export type LocalApiEndpoint = typeof LocalApiEndpoint.Type

/** Waits for exactly one handshake frame, releasing both listeners on completion, cancellation or closure. */
const read = (port: PortLike): Effect.Effect<unknown, ApiError> =>
  Effect.callback((resume) => {
    let done = false
    let stop = () => {}
    let unclose = () => {}
    const finish = (value: Effect.Effect<unknown, ApiError>) => {
      if (done) return
      done = true
      stop()
      unclose()
      resume(value)
    }
    stop = port.listen((message) => finish(Effect.succeed(message)))
    if (done) stop()
    else unclose = port.closed?.(() => finish(Effect.fail(closed()))) ?? (() => {})
    return Effect.sync(() => {
      stop()
      unclose()
    })
  })

export type ClientAuthentication =
  | { readonly kind: 'secret'; readonly secret: string }
  | { readonly kind: 'device'; readonly deviceId: string; readonly sign: (message: string) => Effect.Effect<string, ApiError> }

/** Reusable by a local socket, an SSH-forwarded socket, or a later protected relay channel. */
export const authenticateApiClient = (port: PortLike, homeId: string, auth: ClientAuthentication, apiVersion = API_VERSION) =>
  Effect.gen(function* () {
    port.post({
      type: 'Hello',
      protocol: 1,
      homeId,
      apiVersion,
      auth: auth.kind === 'secret' ? auth : { kind: 'device', deviceId: auth.deviceId },
    })
    if (auth.kind === 'device') {
      const challenge = yield* Schema.decodeUnknownEffect(ClientChallenge)(yield* read(port)).pipe(Effect.mapError(failed))
      if (challenge.homeId !== homeId || challenge.deviceId !== auth.deviceId || challenge.apiVersion !== apiVersion) return yield* failed()
      port.post({ type: 'Proof', challenge, signature: yield* auth.sign(clientChallengeMessage(challenge)) })
    }
    const ready = yield* Schema.decodeUnknownEffect(Ready)(yield* read(port)).pipe(Effect.mapError(failed))
    if (
      ready.identity.homeId !== homeId ||
      ready.apiVersion !== apiVersion ||
      (auth.kind === 'device' && ready.identity.deviceId !== auth.deviceId) ||
      (auth.kind === 'secret' && ready.identity.role !== 'socket')
    )
      return yield* failed()
    return ready.identity
  }).pipe(Effect.timeoutOrElse({ duration: '10 seconds', orElse: () => Effect.fail(failed()) }))

type ConnectionServices = Layer.Services<ReturnType<typeof connection>>

const accept = (port: SocketPort, secret: string) =>
  Effect.gen(function* () {
    const identities = yield* ClientIdentities
    const instance = yield* Instance
    const identity = yield* Effect.gen(function* () {
      const hello = yield* Schema.decodeUnknownEffect(Hello)(yield* read(port)).pipe(Effect.mapError(failed))
      if (hello.homeId !== instance.homeId || hello.apiVersion !== API_VERSION) return yield* failed()
      if (hello.auth.kind === 'secret') {
        if (!timingSafeEqual(Buffer.from(secret, 'hex'), Buffer.from(hello.auth.secret, 'hex'))) return yield* failed()
        return { homeId: instance.homeId, actorId: instance.personId, deviceId: instance.deviceId, role: 'socket' as const }
      }
      const challenge = yield* identities.challenge(hello.auth.deviceId)
      port.post(challenge)
      const proof = yield* Schema.decodeUnknownEffect(Proof)(yield* read(port)).pipe(Effect.mapError(failed))
      if (clientChallengeMessage(proof.challenge) !== clientChallengeMessage(challenge)) return yield* failed()
      return yield* identities.authenticate(proof.challenge, proof.signature)
    }).pipe(Effect.timeoutOrElse({ duration: '10 seconds', orElse: () => Effect.fail(failed()) }))
    yield* identities.check(identity)
    port.setFrameLimit(MAX_SOCKET_FRAME)
    port.post({ type: 'Authenticated', identity, apiVersion: API_VERSION })
    const sender =
      identity.role === 'paired_device' ? { kind: 'paired_device' as const, deviceId: identity.deviceId } : { kind: 'socket' as const }
    yield* Layer.launch(connection(port, sender, identity))
  })

/** A fresh private socket per launch; the descriptor is published only after the server is listening. No network interface is opened. */
export const listenLocalApi = (profile: string): Effect.Effect<LocalApiEndpoint, ApiError, ConnectionServices | Scope.Scope> =>
  Effect.gen(function* () {
    const instance = yield* Instance
    const context = yield* Effect.context<ConnectionServices>()
    const scope = yield* Effect.scope
    const directory = join(profile, 'api')
    yield* Effect.tryPromise({
      try: async () => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 })
        const stat = await fs.lstat(directory)
        if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid !== undefined && stat.uid !== process.getuid()))
          throw new Error('The API directory is not private')
        await fs.chmod(directory, 0o700)
      },
      catch: unavailable,
    })
    const socketDirectory = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => fs.mkdtemp(join(tmpdir(), 'althar-api-')), catch: unavailable }),
      (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })).pipe(Effect.ignore),
    )
    const address =
      process.platform === 'win32' ? `\\\\.\\pipe\\althar-${randomBytes(16).toString('hex')}` : join(socketDirectory, 'api.sock')
    const secret = randomBytes(32).toString('hex')
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      if (sockets.size >= MAX_CONNECTIONS) return void socket.destroy()
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      const port = socketPort(socket, AUTH_FRAME_LIMIT)
      const serving = Effect.scoped(accept(port, secret)).pipe(
        Effect.provideContext(context),
        Effect.catchCause((cause) => {
          const error = Cause.findErrorOption(cause)
          return Cause.hasInterruptsOnly(cause) || (Option.isSome(error) && error.value instanceof ApiError)
            ? Effect.void
            : Effect.logWarning('A private API connection failed', cause)
        }),
        Effect.ensuring(Effect.sync(() => port.close())),
      )
      Effect.runFork(Effect.forkIn(serving, scope))
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => resolve())
          }),
      ),
    )
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(address, () => {
            server.off('error', reject)
            resolve()
          })
        }),
      catch: unavailable,
    })
    server.on('error', () => {
      for (const socket of sockets) socket.destroy()
    })
    if (process.platform !== 'win32') yield* Effect.tryPromise({ try: () => fs.chmod(address, 0o600), catch: unavailable })
    const endpoint: LocalApiEndpoint = { protocol: 1, homeId: instance.homeId, apiVersion: API_VERSION, address, secret }
    const descriptor = join(directory, 'endpoint.json')
    const temporary = join(directory, `endpoint-${randomBytes(8).toString('hex')}.tmp`)
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await fs.rm(temporary, { force: true })
        const current: unknown = JSON.parse(await fs.readFile(descriptor, 'utf8'))
        if (typeof current === 'object' && current !== null && 'address' in current && current.address === address)
          await fs.rm(descriptor, { force: true })
      }).pipe(Effect.ignore),
    )
    yield* Effect.tryPromise({
      try: async () => {
        await fs.writeFile(temporary, JSON.stringify(endpoint), { flag: 'wx', mode: 0o600 })
        await fs.rename(temporary, descriptor)
      },
      catch: unavailable,
    })
    return endpoint
  }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : unavailable())))

/** Opens a transport owned by the caller's scope. SSH forwarding can supply the same private-socket address shape. */
export const openApiSocket = (address: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) =>
        new Promise<SocketPort>((resolve, reject) => {
          const socket = createConnection({ path: address, signal })
          socket.once('error', reject)
          socket.once('connect', () => {
            const port = socketPort(socket)
            socket.off('error', reject)
            resolve(port)
          })
        }),
      catch: unavailable,
    }),
    (port) => Effect.sync(() => port.close()),
  )
