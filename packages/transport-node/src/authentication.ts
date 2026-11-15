import { API_VERSION, ApiError, ClientChallenge, ClientIdentity, clientChallengeMessage, type PortLike } from '@althar/contracts'
import { Effect, Schema } from 'effect'

export const AUTH_FRAME_LIMIT = 16 * 1024
const failed = () =>
  new ApiError({
    reason: 'AuthenticationFailed',
    message: 'This connection could not authenticate. Check the home and pair the device again.',
  })
const closed = () => new ApiError({ reason: 'ConnectionClosed', message: 'The Althar connection closed.' })
export const Authenticated = Schema.Struct({ type: Schema.Literal('Authenticated'), identity: ClientIdentity, apiVersion: Schema.Int })
const Ready = Authenticated

/** Waits for exactly one handshake frame, releasing both listeners on completion, cancellation or closure. */
export const readFrame = (port: PortLike): Effect.Effect<unknown, ApiError> =>
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
      const challenge = yield* Schema.decodeUnknownEffect(ClientChallenge)(yield* readFrame(port)).pipe(Effect.mapError(failed))
      if (challenge.homeId !== homeId || challenge.deviceId !== auth.deviceId || challenge.apiVersion !== apiVersion) return yield* failed()
      port.post({ type: 'Proof', challenge, signature: yield* auth.sign(clientChallengeMessage(challenge)) })
    }
    const ready = yield* Schema.decodeUnknownEffect(Ready)(yield* readFrame(port)).pipe(Effect.mapError(failed))
    if (
      ready.identity.homeId !== homeId ||
      ready.apiVersion !== apiVersion ||
      (auth.kind === 'device' && ready.identity.deviceId !== auth.deviceId) ||
      (auth.kind === 'device' && ready.identity.role !== 'paired_device' && ready.identity.role !== 'socket') ||
      (auth.kind === 'secret' && ready.identity.role !== 'socket')
    )
      return yield* failed()
    return ready.identity
  }).pipe(Effect.timeoutOrElse({ duration: '10 seconds', orElse: () => Effect.fail(failed()) }))
