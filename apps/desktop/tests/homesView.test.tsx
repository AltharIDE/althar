import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { CheckedHome, HomeState, HomesHost } from '../src/homes'
import { HomesDialog } from '../src/renderer/features/homes/HomesDialog'
import { HomeConnections } from '../src/renderer/features/homes/HomeConnections'
import { useHomeState } from '../src/renderer/features/homes/useHomes'
import { hostForHome, receiveHomeConnection } from '../src/renderer/data/homeConnection'
import { fakeHost } from './fixtures'

const home = { id: `remote_${'1'.repeat(32)}`, name: 'My server', homeId: `home_${'2'.repeat(32)}`, ssh: { target: 'fixture' } }
const checked: CheckedHome = {
  checkId: 'opaque-confirmation',
  homeId: home.homeId,
  hostDeviceId: `dev_${'3'.repeat(32)}`,
  version: 'fixture',
  apiVersion: 1,
  target: 'fixture',
}
const local: HomeState = { current: { kind: 'local' }, connection: 'local' }
const remote: HomeState = {
  current: { kind: 'ssh', home },
  connection: 'connected',
  identity: { homeId: home.homeId, actorId: `act_${'4'.repeat(32)}`, deviceId: checked.hostDeviceId, role: 'socket' },
}
const fixture = () => {
  const listeners = new Set<(state: HomeState) => void>()
  const homes = {
    state: vi.fn(async () => local),
    list: vi.fn(async () => [home]),
    inspect: vi.fn(async () => checked),
    connect: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    cancelCheck: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    onState: (listener: (state: HomeState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onOpen: () => () => {},
  } satisfies HomesHost
  return {
    homes,
    listeners,
    emit: (state: HomeState) => {
      for (const listener of listeners) listener(state)
    },
  }
}
const later = <A,>() => {
  let resolve!: (value: A) => void
  return {
    promise: new Promise<A>((done) => {
      resolve = done
    }),
    resolve: (value: A) => resolve(value),
  }
}

it('checks a host then confirms its opaque identity, including under StrictMode', async () => {
  const at = fixture()
  const close = vi.fn()
  render(
    <StrictMode>
      <HomesDialog homes={at.homes} onClose={close} />
    </StrictMode>,
  )
  expect(await screen.findByText('My server')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Connect a host…' }))
  await userEvent.type(screen.getByLabelText('Name'), 'Production')
  await userEvent.type(screen.getByLabelText('SSH host'), 'fixture')
  expect((screen.getByRole('button', { name: 'Connect to this home' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect(await screen.findByText(home.homeId)).not.toBeNull()
  expect(at.homes.inspect).toHaveBeenCalledExactlyOnceWith({ target: 'fixture' })
  await userEvent.click(screen.getByRole('button', { name: 'Connect to this home' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(at.homes.connect).toHaveBeenCalledExactlyOnceWith('opaque-confirmation', 'Production')
})
it('discards a late check when settings change and cancels discovery when the dialog closes', async () => {
  const at = fixture()
  const checkedLater = later<CheckedHome>()
  at.homes.inspect.mockImplementation(() => checkedLater.promise)
  const view = render(<HomesDialog homes={at.homes} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect a host…' }))
  await userEvent.type(screen.getByLabelText('SSH host'), 'fixture')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.type(screen.getByLabelText('SSH host'), '-changed')
  await act(async () => checkedLater.resolve(checked))
  expect(screen.queryByText(home.homeId)).toBeNull()
  expect((screen.getByRole('button', { name: 'Connect to this home' }) as HTMLButtonElement).disabled).toBe(true)
  view.unmount()
  expect(at.homes.cancelCheck).toHaveBeenCalled()
})
it('keeps a newer connection event when an older initial read arrives, and unsubscribes on unmount', async () => {
  const at = fixture()
  const initial = later<HomeState>()
  at.homes.state.mockImplementation(() => initial.promise)
  function State() {
    const state = useHomeState(at.homes)
    return <output>{state?.connection}</output>
  }
  const view = render(<State />)
  act(() => at.emit(remote))
  await act(async () => initial.resolve(local))
  expect(screen.getByRole('status').textContent).toBe('connected')
  view.unmount()
  expect(at.listeners.size).toBe(0)
})
it('shows disconnection without replaying work and makes reconnect explicit', async () => {
  const at = fixture()
  render(<HomeConnections host={{ ...fakeHost(), homes: at.homes }} ready />)
  act(() => at.emit({ ...remote, connection: 'disconnected', problem: 'Network closed' }))
  expect(await screen.findByRole('dialog', { name: 'Disconnected from My server' })).not.toBeNull()
  expect(at.homes.reconnect).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
})
it('removes desktop-local capabilities from a remote window without calling native helpers', async () => {
  const original = fakeHost()
  const localHost = hostForHome(original, local)
  expect(localHost).toBe(original)
  const host = hostForHome(original, remote)
  expect(host.pages).toBeUndefined()
  expect(host.canvases).toBeUndefined()
  expect(host.dictation).toBeUndefined()
  await expect(host.pickFolder()).rejects.toThrow('not available')
  await expect(host.attachPasted()).rejects.toThrow('not available')
  expect(await host.clipboardToken()).toBeNull()
  expect(original.pickFolder).not.toHaveBeenCalled()
})
it('catches a fast port while metadata is pending, and cleans listeners after a connection failure', async () => {
  const at = fixture()
  const host = { ...fakeHost(), homes: at.homes }
  const initial = later<HomeState>()
  at.homes.state.mockReturnValueOnce(initial.promise).mockResolvedValue(remote)
  const target = new EventTarget()
  const port = {} as MessagePort
  const opening = receiveHomeConnection(host, target as unknown as Window)
  target.dispatchEvent(new MessageEvent('message', { data: 'althar:port', ports: [port] }))
  initial.resolve(remote)
  expect(await opening).toEqual({ port, home: remote })
  expect(at.listeners.size).toBe(0)
  at.homes.state.mockResolvedValue(remote)
  const failing = receiveHomeConnection(host, target as unknown as Window)
  at.emit({ ...remote, connection: 'disconnected', problem: 'Lost SSH' })
  await expect(failing).rejects.toThrow('Lost SSH')
  expect(at.listeners.size).toBe(0)
})

it('keeps errors on the connection form and requires a fresh check after a refused confirmation', async () => {
  const at = fixture()
  at.homes.inspect.mockRejectedValueOnce(new Error("Error invoking remote method 'althar:homes-inspect': Error: Host unavailable"))
  at.homes.connect.mockRejectedValueOnce(new Error('This home check expired.'))
  render(<HomesDialog homes={at.homes} onClose={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect a host…' }))
  await userEvent.type(screen.getByLabelText('Name'), 'Production')
  await userEvent.type(screen.getByLabelText('SSH host'), 'fixture')
  await userEvent.click(screen.getByRole('button', { name: 'Connection options' }))
  await userEvent.type(screen.getByLabelText('Profile on the host'), '/home/fixture/profile')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Host unavailable')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect(await screen.findByText(home.homeId)).not.toBeNull()
  expect(screen.queryByLabelText('Profile on the host')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Connect to this home' }))
  expect((await screen.findByRole('alert')).textContent).toContain('expired')
  expect((screen.getByRole('button', { name: 'Connect to this home' }) as HTMLButtonElement).disabled).toBe(true)
  expect(at.homes.inspect).toHaveBeenLastCalledWith({ target: 'fixture', profile: '/home/fixture/profile' })
})

it('forgets saved metadata without disconnecting another home and can still open the local window', async () => {
  const at = fixture()
  const close = vi.fn()
  at.homes.list.mockResolvedValueOnce([home]).mockResolvedValue([])
  render(<HomesDialog homes={at.homes} onClose={close} />)
  expect(await screen.findByText('My server')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
  await waitFor(() => expect(screen.queryByText('My server')).toBeNull())
  expect(at.homes.forget).toHaveBeenCalledExactlyOnceWith(home.id)
  expect(at.homes.reconnect).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(at.homes.open).toHaveBeenCalledExactlyOnceWith('local')
})

it('fails startup on disconnect even if the initial metadata read never answers', async () => {
  const at = fixture()
  at.homes.state.mockReturnValue(new Promise(() => {}))
  const target = new EventTarget()
  const opening = receiveHomeConnection({ ...fakeHost(), homes: at.homes }, target as unknown as Window)
  at.emit({ ...remote, connection: 'disconnected', problem: 'Host went away' })
  await expect(opening).rejects.toThrow('Host went away')
  expect(at.listeners.size).toBe(0)
})
