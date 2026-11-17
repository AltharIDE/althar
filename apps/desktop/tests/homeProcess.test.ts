// @vitest-environment node
import { EventEmitter } from 'node:events'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { it as effectIt } from '@effect/vitest'
import { afterEach, expect, it, vi } from 'vitest'

import { connectHomeProcess, inspectHomeProcess, type HomeProcess } from '../src/main/homes/process'

const home = { id: `remote_${'1'.repeat(32)}`, name: 'Fixture', homeId: `home_${'2'.repeat(32)}`, ssh: { target: 'fixture' } }
const status = { homeId: home.homeId, hostDeviceId: `dev_${'3'.repeat(32)}`, version: 'fixture', apiVersion: 1 }
const fixture = () => {
  const events = new EventEmitter()
  const child = {
    on: (event: 'message' | 'exit', listener: (...args: ReadonlyArray<unknown>) => void) => events.on(event, listener),
    postMessage: vi.fn(),
    kill: vi.fn(() => true),
  } satisfies HomeProcess
  return { child, events, fork: () => child }
}
afterEach(() => vi.useRealTimers())

it('transfers one port, ignores duplicate ready messages, and reports a disconnect only once', async () => {
  const at = fixture()
  const connected = vi.fn()
  const disconnected = vi.fn()
  const port = {}
  const process = connectHomeProcess(at.fork, home, port, { connected, disconnected })
  expect(at.child.postMessage).toHaveBeenCalledWith({ type: 'connect', home }, [port])
  at.events.emit('message', { type: 'connected', identity: 'fixture' })
  at.events.emit('message', { type: 'connected', identity: 'duplicate' })
  expect(connected).toHaveBeenCalledExactlyOnceWith('fixture')
  at.events.emit('message', { type: 'disconnected', problem: 'Closed' })
  at.events.emit('exit')
  at.events.emit('message', { type: 'connected', identity: 'late' })
  expect(disconnected).toHaveBeenCalledExactlyOnceWith('Closed')
  await Effect.runPromise(process.stop)
  expect(at.child.kill).not.toHaveBeenCalled()
})
it('closes a tunnel with an invalid identity and bounds its public error', () => {
  const at = fixture()
  const disconnected = vi.fn()
  connectHomeProcess(
    at.fork,
    home,
    {},
    {
      connected: () => {
        throw new Error('private details')
      },
      disconnected,
    },
  )
  at.events.emit('message', { type: 'connected', identity: {} })
  expect(disconnected).toHaveBeenCalledExactlyOnceWith('The home returned an unexpected identity or authority.')
  expect(at.child.postMessage).toHaveBeenCalledWith({ type: 'disconnect' })
  at.events.emit('exit')
  expect(disconnected).toHaveBeenCalledTimes(1)
})
it('cancels discovery, discards a late result and kills a helper that ignores the close', async () => {
  vi.useFakeTimers()
  const at = fixture()
  const abort = new AbortController()
  const checking = inspectHomeProcess(at.fork, home.ssh, abort.signal)
  const rejected = expect(checking).rejects.toThrow('cancelled')
  abort.abort()
  at.events.emit('message', { type: 'inspected', status })
  await rejected
  expect(at.child.postMessage).toHaveBeenCalledWith({ type: 'disconnect' })
  await vi.advanceTimersByTimeAsync(12_000)
  expect(at.child.kill).toHaveBeenCalledOnce()
  at.events.emit('exit')
  expect(vi.getTimerCount()).toBe(0)
})
it('bounds an unanswered inspection and removes all timers when the helper exits', async () => {
  vi.useFakeTimers()
  const at = fixture()
  const checking = inspectHomeProcess(at.fork, home.ssh, new AbortController().signal)
  const rejected = expect(checking).rejects.toThrow('did not answer')
  await vi.advanceTimersByTimeAsync(45_000)
  await rejected
  at.events.emit('exit')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(at.child.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('does not fork an already cancelled check and cleans up a helper that cannot receive messages', async () => {
  vi.useFakeTimers()
  const at = fixture()
  const fork = vi.fn(at.fork)
  await expect(inspectHomeProcess(fork, home.ssh, AbortSignal.abort())).rejects.toThrow('cancelled')
  expect(fork).not.toHaveBeenCalled()
  at.child.postMessage.mockImplementation(() => {
    throw new Error('IPC closed')
  })
  await expect(inspectHomeProcess(at.fork, home.ssh, new AbortController().signal)).rejects.toThrow('could not start')
  at.events.emit('exit')
  expect(vi.getTimerCount()).toBe(0)
})

effectIt.effect('bounds tunnel shutdown and ignores late readiness once stopping', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const at = fixture()
      const connected = vi.fn()
      const disconnected = vi.fn()
      const process = connectHomeProcess(at.fork, home, {}, { connected, disconnected })
      const stopping = yield* Effect.forkScoped(process.stop)
      yield* TestClock.adjust('12 seconds')
      yield* Fiber.join(stopping)
      expect(at.child.kill).toHaveBeenCalledOnce()
      at.events.emit('message', { type: 'connected', identity: 'late' })
      at.events.emit('exit')
      expect(connected).not.toHaveBeenCalled()
      expect(disconnected).not.toHaveBeenCalled()
    }),
  ),
)
