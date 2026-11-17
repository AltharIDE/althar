import { emitterPort } from '@althar/contracts'
import { inspectSshHost, TransportError } from '@althar/transport-node'
import { Cause, Effect, Exit, Logger } from 'effect'

import { bridgeHome, type ConnectionPort } from './bridge'
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
  if ((data.type !== 'connect' && data.type !== 'inspect') || started) return
  started = true
  void (async () => {
    let problem: string | undefined
    try {
      if (data.type === 'inspect' && 'target' in data) {
        const result = await Effect.runPromiseExit(inspectSshHost(homeTarget(data.target)).pipe(Effect.provide(Logger.layer([]))), {
          signal: stop.signal,
        })
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
        bridgeHome(home, emitterPort(port), (identity) => parent.postMessage({ type: 'connected', identity })).pipe(
          Effect.provide(Logger.layer([])),
        ),
        { signal: stop.signal },
      )
      if (Exit.isFailure(result) && !Cause.hasInterruptsOnly(result.cause)) {
        const error = Cause.squash(result.cause)
        problem = error instanceof TransportError ? error.message : 'The home connection closed. Check the host and reconnect.'
      }
    } catch {
      problem = 'This saved home connection is invalid. Check its settings and connect again.'
    }
    parent.postMessage({ type: 'disconnected', ...(problem === undefined ? {} : { problem }) })
    process.exit(0)
  })()
})
