import { Schema } from 'effect'
import { ClientPublicKey } from '@althar/contracts'
import { emitterPort } from '@althar/contracts'
import {
  inspectSshHost,
  TransportError,
  completeDevicePairing,
  decodePairingCode,
  openHttpsConnection,
  apiClient,
  signDeviceMessage,
} from '@althar/transport-node'
import { Cause, Effect, Exit, Logger } from 'effect'

import { bridgeHome, sshRuntime, type ConnectionPort } from './bridge'
import { homeTarget, savedHome } from '../main/homes/store'

interface ParentEvent {
  readonly data: unknown
  readonly ports: ReadonlyArray<ConnectionPort>
}
const parent = (
  process as unknown as {
    parentPort: { on: (event: 'message', listener: (event: ParentEvent) => void) => void; postMessage: (value: unknown) => void }
  }
).parentPort
let started = false
const stop = new AbortController()
process.once('SIGINT', () => stop.abort())
process.once('SIGTERM', () => stop.abort())
parent.on('message', ({ data, ports }) => {
  if (typeof data !== 'object' || data === null || !('type' in data)) return
  if (data.type === 'disconnect') {
    stop.abort()
    return
  }
  if ((data.type !== 'connect' && data.type !== 'inspect' && data.type !== 'pair') || started) return
  started = true
  void (async () => {
    let problem: string | undefined
    try {
      const Key = Schema.Struct({ publicKey: ClientPublicKey, privateKey: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{64}$/)) })
      if (
        data.type === 'pair' &&
        'code' in data &&
        'key' in data &&
        'name' in data &&
        typeof data.code === 'string' &&
        typeof data.name === 'string'
      ) {
        const key = Schema.decodeUnknownSync(Key)(data.key)
        const code = decodePairingCode(data.code)
        const name = data.name
        const result = await Effect.runPromiseExit(
          Effect.scoped(
            Effect.gen(function* () {
              const target = yield* completeDevicePairing(code, key, name)
              yield* apiClient(yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message)))
              return target
            }),
          ).pipe(Effect.provide(Logger.layer([]))),
          { signal: stop.signal },
        )
        if (Exit.isFailure(result)) throw Cause.squash(result.cause)
        parent.postMessage({ type: 'paired', target: result.value })
        process.exit(0)
      }
      if (data.type === 'inspect' && 'target' in data) {
        const result = await Effect.runPromiseExit(
          inspectSshHost(homeTarget(data.target), sshRuntime()).pipe(Effect.provide(Logger.layer([]))),
          {
            signal: stop.signal,
          },
        )
        if (Exit.isSuccess(result)) {
          parent.postMessage({ type: 'inspected', status: result.value })
          process.exit(0)
        }
        const error = Cause.squash(result.cause)
        problem = error instanceof TransportError ? error.message : 'The host did not answer its status check.'
        parent.postMessage({ type: 'disconnected', problem })
        process.exit(0)
      }
      if (!('home' in data)) throw new Error('Missing home')
      const home = savedHome(data.home)
      const port = ports[0]
      if (port === undefined) throw new Error('Missing connection port')
      const result = await Effect.runPromiseExit(
        bridgeHome(
          home,
          emitterPort(port),
          (identity) => parent.postMessage({ type: 'connected', identity }),
          'key' in data ? Schema.decodeUnknownSync(Key)(data.key) : undefined,
        ).pipe(Effect.provide(Logger.layer([]))),
        { signal: stop.signal },
      )
      if (Exit.isFailure(result) && !Cause.hasInterruptsOnly(result.cause)) {
        const error = Cause.squash(result.cause)
        problem = error instanceof TransportError ? error.message : 'The home connection closed. Check the host and reconnect.'
      }
    } catch (error) {
      problem =
        error instanceof TransportError ? error.message : 'This saved home connection is invalid. Check its settings and connect again.'
    }
    parent.postMessage({ type: 'disconnected', ...(problem === undefined ? {} : { problem }) })
    process.exit(0)
  })()
})
