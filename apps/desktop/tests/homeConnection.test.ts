import { afterEach, expect, it, vi } from 'vitest'

import type { HomeState } from '../src/homes'
import { receiveHomeConnection } from '../src/renderer/data/homeConnection'
import { fakeHost } from './fixtures'

const local: HomeState = { current: { kind: 'local' }, connection: 'local' }
const remote: HomeState = {
  current: { kind: 'ssh', home: { id: 'remote', homeId: 'home', name: 'Server', ssh: { target: 'box' } } },
  connection: 'connecting',
}
afterEach(() => vi.useRealTimers())
const fixture = (state: HomeState = local) => {
  const target = new EventTarget()
  let listener: ((state: HomeState) => void) | undefined
  const off = vi.fn()
  const host = {
    ...fakeHost(),
    homes: {
      state: vi.fn(async () => state),
      onState: (next: (state: HomeState) => void) => {
        listener = next
        return off
      },
    },
  }
  // Only state and its subscription are used during startup.
  const open = () => receiveHomeConnection(host as unknown as ReturnType<typeof fakeHost>, target as unknown as Window)
  const port = { postMessage: vi.fn() }
  const deliver = () => target.dispatchEvent(new MessageEvent('message', { data: 'althar:port', ports: [port as unknown as MessagePort] }))
  return { host, open, deliver, port, off, emit: (state: HomeState) => listener?.(state) }
}

it('opens local connections on older hosts without homes metadata', async () => {
  const target = new EventTarget()
  const port = { postMessage: vi.fn() }
  const oldHost = fakeHost()
  const next = receiveHomeConnection(oldHost, target as unknown as Window)
  target.dispatchEvent(new MessageEvent('message', { data: 'althar:port', ports: [port as unknown as MessagePort] }))
  expect(await next).toEqual({ port, home: local })
})

it.each([undefined, 'SSH lost'])('rejects disconnected metadata and closes a port already received (%s)', async (problem) => {
  const at = fixture({ ...remote, connection: 'disconnected', ...(problem === undefined ? {} : { problem }) })
  const opening = at.open()
  at.deliver()
  await expect(opening).rejects.toThrow(problem ?? 'The home disconnected.')
  expect(at.port.postMessage).toHaveBeenCalledWith([1])
  expect(at.off).toHaveBeenCalledOnce()
})

it.each(['connecting', 'connected'] as const)('refuses an unverified %s remote connection', async (connection) => {
  const at = fixture({ ...remote, connection })
  const opening = at.open()
  at.deliver()
  await expect(opening).rejects.toThrow('verified connection')
  expect(at.port.postMessage).toHaveBeenCalledWith([1])
  expect(at.off).toHaveBeenCalledOnce()
})

it.each([local, remote])('bounds startup when no port arrives ($connection)', async (state) => {
  vi.useFakeTimers()
  const at = fixture(state)
  const opening = at.open()
  const rejected = expect(opening).rejects.toThrow(state.current.kind === 'local' ? 'runtime didn’t start' : 'home did not connect')
  await vi.advanceTimersByTimeAsync(state.current.kind === 'local' ? 15_000 : 60_000)
  await rejected
  expect(at.off).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects a disconnect event without a problem while waiting for the port', async () => {
  const at = fixture(remote)
  const opening = at.open()
  at.emit({ ...remote, connection: 'disconnected' })
  await expect(opening).rejects.toThrow('The home disconnected.')
  expect(at.off).toHaveBeenCalledOnce()
})
