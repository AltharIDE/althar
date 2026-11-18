import { Schema } from 'effect'
import type { DeviceKey } from '@althar/transport-node'
import { HttpsHomeTarget } from '@althar/contracts'
import { Effect, Option } from 'effect'

import type { RemoteHome, SshHomeTarget } from '../../homes'
import type { HostStatus } from './controller'

export interface HomeProcess {
  postMessage(message: unknown, ports?: ReadonlyArray<unknown>): void
  on(event: 'message' | 'exit', listener: (...args: ReadonlyArray<unknown>) => void): unknown
  kill(): boolean
}
export type ForkHomeProcess = () => HomeProcess
const closedProblem = 'The home connection closed. Check the host and reconnect.'

/** One SSH process owner per window, independent of the local runtime's lifecycle. */
export const connectHomeProcess = (
  fork: ForkHomeProcess,
  home: RemoteHome,
  port: unknown,
  events: { connected: (identity: unknown) => void; disconnected: (problem: string) => void },
  key?: DeviceKey,
) => {
  const child = fork()
  let stopping = false
  let reported = false
  let ended = false
  let connected = false
  let finish = () => {}
  const closed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const disconnected = (problem: string) => {
    if (!reported && !stopping) {
      reported = true
      events.disconnected(problem)
    }
  }
  child.on('exit', () => {
    ended = true
    disconnected(closedProblem)
    finish()
  })
  child.on('message', (message) => {
    if (stopping || reported || typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'connected' && 'identity' in message) {
      if (connected) return
      connected = true
      try {
        events.connected(message.identity)
      } catch {
        disconnected('The home returned an unexpected identity or authority.')
        try {
          child.postMessage({ type: 'disconnect' })
        } catch {
          child.kill()
        }
      }
    }
    if (message.type === 'disconnected')
      disconnected(
        'problem' in message && typeof message.problem === 'string' && message.problem.length <= 1024 ? message.problem : closedProblem,
      )
  })
  child.postMessage({ type: 'connect', home, ...(key === undefined ? {} : { key }) }, [port])
  return {
    stop: Effect.gen(function* () {
      if (ended) return
      if (!stopping) {
        stopping = true
        try {
          child.postMessage({ type: 'disconnect' })
        } catch {
          child.kill()
        }
      }
      const graceful = yield* Effect.promise(() => closed).pipe(Effect.timeoutOption('12 seconds'))
      if (Option.isNone(graceful) && !ended) child.kill()
    }),
  }
}

/** Discovery uses the same isolated utility entry, with no RPC port or database. Abort tears down its SSH scope. */
const requestHomeProcess = <A>(
  fork: ForkHomeProcess,
  request: unknown,
  read: (message: Record<string, unknown>) => A | undefined,
  signal: AbortSignal,
): Promise<A> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('The home check was cancelled.'))
      return
    }
    const child = fork()
    let finished = false
    let force: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(() => cancel('The host did not answer its check. Check its SSH configuration and service.'), 45_000)
    const finish = (status?: A, problem = 'The host did not answer its check. Check its SSH configuration and service.') => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', abort)
      if (status === undefined) reject(new Error(problem))
      else resolve(status)
    }
    const cancel = (problem: string) => {
      if (finished) return
      try {
        child.postMessage({ type: 'disconnect' })
      } catch {
        child.kill()
      }
      force = setTimeout(() => child.kill(), 12_000)
      finish(undefined, problem)
    }
    const abort = () => cancel('The home check was cancelled.')
    signal.addEventListener('abort', abort, { once: true })
    child.on('exit', () => {
      clearTimeout(force)
      finish()
    })
    child.on('message', (message) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return
      try {
        const value = read({ ...message })
        if (value !== undefined) finish(value)
      } catch {
        cancel('The home returned invalid connection information.')
      }
      if (message.type === 'disconnected')
        finish(
          undefined,
          'problem' in message && typeof message.problem === 'string' && message.problem.length <= 1024 ? message.problem : undefined,
        )
    })
    try {
      child.postMessage(request)
    } catch {
      cancel('The host check could not start.')
    }
  })

export const inspectHomeProcess = (fork: ForkHomeProcess, target: SshHomeTarget, signal: AbortSignal): Promise<HostStatus> =>
  requestHomeProcess(
    fork,
    { type: 'inspect', target },
    (message) => (message.type === 'inspected' ? (message.status as HostStatus) : undefined),
    signal,
  )

export const pairHomeProcess = (
  fork: ForkHomeProcess,
  code: string,
  key: DeviceKey,
  name: string,
  signal: AbortSignal,
): Promise<HttpsHomeTarget> =>
  requestHomeProcess(
    fork,
    { type: 'pair', code, key, name },
    (message) => (message.type === 'paired' ? Schema.decodeUnknownSync(HttpsHomeTarget)(message.target) : undefined),
    signal,
  )
