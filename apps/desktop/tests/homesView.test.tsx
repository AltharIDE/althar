import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { CheckedHome, HomeState, HomesHost, HomesOverview, RemoteHome } from '../src/homes'
import { ConnectHome } from '../src/renderer/features/homes/ConnectHome'
import { Chip, HomeConnections } from '../src/renderer/features/homes/HomeConnections'
import { ManageHomes } from '../src/renderer/features/homes/ManageHomes'
import { homesUi, useHomeState } from '../src/renderer/features/homes/useHomes'
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
const overview: HomesOverview = {
  homes: [home],
  windows: { local: 'local', [home.homeId]: 'connected' },
  projects: {
    local: { live: true, list: [{ id: 'prj_althar', name: 'althar', ink: 'clay', working: 0, yours: 0 }] },
    [home.homeId]: { live: true, list: [{ id: 'prj_ledger', name: 'ledger', ink: 'moss', working: 2, yours: 1 }] },
  },
  opened: { [home.id]: Date.now() - 40 * 60_000 },
}
const fixture = () => {
  const listeners = new Set<(state: HomeState) => void>()
  const overviews = new Set<(overview: HomesOverview) => void>()
  const homes = {
    state: vi.fn(async () => local),
    list: vi.fn(async () => [home]),
    overview: vi.fn(async () => overview),
    inspect: vi.fn(async () => checked),
    connect: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    change: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    cancelCheck: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    report: vi.fn(),
    onState: (listener: (state: HomeState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onOverview: (listener: (overview: HomesOverview) => void) => {
      overviews.add(listener)
      return () => {
        overviews.delete(listener)
      }
    },
    onOpen: () => () => {},
    onProject: () => () => {},
  } satisfies HomesHost
  return {
    homes,
    listeners,
    emit: (state: HomeState) => {
      for (const listener of listeners) listener(state)
    },
    tell: (next: HomesOverview) => {
      for (const listener of overviews) listener(next)
    },
  }
}

it('previews a pairing destination, keeps the code private and pairs without SSH discovery', async () => {
  const at = fixture()
  const pair = vi.fn(async () => {})
  const homes = {
    ...at.homes,
    pair,
    pairingInfo: vi.fn(async () => ({ origin: 'https://my-vps.test:6769', homeId: home.homeId, expiresAt: Number.MAX_SAFE_INTEGER })),
  }
  const close = vi.fn()
  render(<ConnectHome homes={homes} onClose={close} />)
  expect(screen.queryByLabelText('SSH host')).toBeNull()
  await userEvent.type(screen.getByLabelText('Name'), 'My VPS')
  await userEvent.type(screen.getByLabelText('Pairing code'), 'opaque-code')
  expect(screen.getByLabelText('Pairing code').getAttribute('type')).toBe('password')
  expect(await screen.findByText('https://my-vps.test:6769')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Pair and open' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(pair).toHaveBeenCalledExactlyOnceWith('opaque-code', 'My VPS')
  expect(at.homes.inspect).not.toHaveBeenCalled()
})

it('discards an obsolete pairing preview and cancels pairing when its form is left', async () => {
  const at = fixture()
  const old = later<{ origin: string; homeId: string; expiresAt: number }>()
  const homes = { ...at.homes, pair: vi.fn(async () => {}), pairingInfo: vi.fn(() => old.promise) }
  render(<ConnectHome homes={homes} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText('Name'), 'My VPS')
  await userEvent.type(screen.getByLabelText('Pairing code'), 'old-code')
  await userEvent.clear(screen.getByLabelText('Pairing code'))
  await act(async () => old.resolve({ origin: 'https://old.test', homeId: home.homeId, expiresAt: Number.MAX_SAFE_INTEGER }))
  expect(screen.queryByText('https://old.test')).toBeNull()
  expect(screen.getByRole('button', { name: 'Pair and open' }).getAttribute('disabled')).not.toBeNull()
  await userEvent.click(screen.getByRole('radio', { name: 'SSH' }))
  expect(screen.getByLabelText('SSH host')).not.toBeNull()
  expect(at.homes.cancelCheck).toHaveBeenCalled()
})
const later = <A,>() => {
  let resolve!: (value: A) => void
  return {
    promise: new Promise<A>((done) => {
      resolve = done
    }),
    resolve: (value: A) => resolve(value),
  }
}

it('checks a host, shows its identity to compare, then connects under the host’s name, including under StrictMode', async () => {
  const at = fixture()
  const close = vi.fn()
  render(
    <StrictMode>
      <ConnectHome homes={at.homes} onClose={close} />
    </StrictMode>,
  )
  await userEvent.type(screen.getByLabelText('SSH host'), 'me@fixture.example.com')
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect(await screen.findByText(home.homeId)).not.toBeNull()
  expect(at.homes.inspect).toHaveBeenCalledExactlyOnceWith({ target: 'me@fixture.example.com' })
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('fixture')
  await userEvent.clear(screen.getByLabelText('Name'))
  await userEvent.type(screen.getByLabelText('Name'), 'Production')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(at.homes.connect).toHaveBeenCalledExactlyOnceWith('opaque-confirmation', 'Production')
})

it('discards a late check when the host changes, and cancels discovery when the dialog closes', async () => {
  const at = fixture()
  const checkedLater = later<CheckedHome>()
  at.homes.inspect.mockImplementation(() => checkedLater.promise)
  const view = render(<ConnectHome homes={at.homes} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText('SSH host'), 'fixture')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.type(screen.getByLabelText('SSH host'), '-changed')
  await act(async () => checkedLater.resolve(checked))
  expect(screen.queryByText(home.homeId)).toBeNull()
  expect(screen.getByRole('button', { name: 'Check host' })).not.toBeNull()
  view.unmount()
  expect(at.homes.cancelCheck).toHaveBeenCalled()
})

it('keeps errors at the host and needs a fresh check after a refused confirmation', async () => {
  const at = fixture()
  at.homes.inspect.mockRejectedValueOnce(new Error("Error invoking remote method 'althar:homes-inspect': Error: Host unavailable"))
  at.homes.connect.mockRejectedValueOnce(new Error('This home check expired.'))
  render(<ConnectHome homes={at.homes} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText('SSH host'), 'fixture')
  await userEvent.click(screen.getByRole('button', { name: 'Connection options' }))
  await userEvent.type(screen.getByLabelText('Home’s profile on the host'), '/home/fixture/profile')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Host unavailable')
  expect((screen.getByLabelText('SSH host') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true')
  await userEvent.click(screen.getByRole('button', { name: 'Check host' }))
  expect(await screen.findByText(home.homeId)).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect((await screen.findByRole('alert')).textContent).toContain('expired')
  expect(screen.getByRole('button', { name: 'Check host' })).not.toBeNull()
  expect(at.homes.inspect).toHaveBeenLastCalledWith({ target: 'fixture', profile: '/home/fixture/profile' })
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

it('draws no chip in this computer’s window before a home is saved, a plug once one is, and the home’s name in its own', async () => {
  const at = fixture()
  at.homes.overview.mockResolvedValue({ ...overview, homes: [] })
  const view = render(<Chip homes={at.homes} />)
  await act(async () => {})
  expect(screen.queryByRole('button')).toBeNull()
  act(() => at.tell(overview))
  expect(await screen.findByRole('button', { name: /Homes/ })).not.toBeNull()
  view.unmount()
  at.homes.state.mockResolvedValue(remote)
  render(<Chip homes={at.homes} />)
  expect(await screen.findByRole('button', { name: 'My server, over SSH. Homes' })).not.toBeNull()
})

it('shows a dropped connection in the chip, readable, with an explicit Reconnect', async () => {
  const at = fixture()
  at.homes.state.mockResolvedValue(remote)
  render(<Chip homes={at.homes} />)
  await screen.findByRole('button', { name: 'My server, over SSH. Homes' })
  act(() => at.emit({ ...remote, connection: 'disconnected', problem: 'Network closed' }))
  expect(await screen.findByText('Disconnected')).not.toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(at.homes.reconnect).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
})

const paired: RemoteHome = {
  id: `remote_${'5'.repeat(32)}`,
  name: 'Secure server',
  homeId: home.homeId,
  https: { origin: 'https://home.test:6769', homeId: home.homeId, deviceId: `dev_${'6'.repeat(32)}`, tlsKeyPin: '7'.repeat(64) },
}

it('names a paired home in the chip and keeps an HTTPS disconnect explicit', async () => {
  const at = fixture()
  const state: HomeState = { ...remote, current: { kind: 'https', home: paired } }
  at.homes.state.mockResolvedValue(state)
  at.homes.overview.mockResolvedValue({ ...overview, homes: [paired] })
  render(<Chip homes={at.homes} />)
  expect(await screen.findByRole('button', { name: 'Secure server, connected. Homes' })).not.toBeNull()
  act(() => at.emit({ ...state, connection: 'disconnected', problem: 'Host stopped' }))
  expect(await screen.findByRole('button', { name: 'Secure server, disconnected. Homes' })).not.toBeNull()
  expect(at.homes.reconnect).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
})

it('opens the chip’s menu from File › Homes… where there is a chip, and Connect a home where there is none', async () => {
  const at = fixture()
  at.homes.overview.mockResolvedValue({ ...overview, homes: [] })
  render(<HomeConnections host={{ ...fakeHost(), homes: at.homes }} />)
  await act(async () => {})
  act(() => window.dispatchEvent(new Event('althar:show-homes')))
  expect(await screen.findByRole('dialog', { name: 'Connect a home' })).not.toBeNull()
  act(() => homesUi.set({ dialog: null }))
})

const manage = (at: ReturnType<typeof fixture>, given: HomesOverview = overview, here: HomeState = local) => {
  const close = vi.fn()
  const view = render(<ManageHomes homes={at.homes} overview={given} here={here} onClose={close} onConnect={() => {}} />)
  return { close, view }
}

it('shows each home by its projects, live while its window is connected, and opens one there', async () => {
  const at = fixture()
  const { close } = manage(at)
  const dialog = await screen.findByRole('dialog', { name: 'Homes' })
  expect(within(dialog).getByText('This computer')).not.toBeNull()
  expect(within(dialog).getByText('2 running, needs you')).not.toBeNull()
  expect(within(dialog).getByText('Open')).not.toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: /ledger/ }))
  expect(at.homes.open).toHaveBeenCalledExactlyOnceWith(home.id, 'prj_ledger')
  expect(close).toHaveBeenCalledOnce()
})

it('manages paired homes by their origin and offers a new pairing instead of SSH edits', async () => {
  const at = fixture()
  manage(at, { ...overview, homes: [paired] })
  expect(await screen.findByText(paired.https!.origin)).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Secure server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
  expect(screen.queryByLabelText('SSH host')).toBeNull()
  expect(screen.getByText(paired.homeId)).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Pair a new connection…' }))
  expect(homesUi.get().dialog).toBe('connect')
  expect(at.homes.change).not.toHaveBeenCalled()
  act(() => homesUi.set({ dialog: null }))
})

it('shows a resting home’s projects quietly, as last read, with when it was last opened', async () => {
  const at = fixture()
  manage(at, {
    ...overview,
    windows: { local: 'local' },
    projects: {
      ...overview.projects,
      [home.homeId]: { live: false, list: [{ id: 'prj_ledger', name: 'ledger', ink: 'moss', working: 0, yours: 0 }] },
    },
  })
  const ledger = await screen.findByRole('button', { name: 'ledger' })
  expect(ledger.textContent).toBe('ledger')
  expect(screen.getByText('40 minutes ago')).not.toBeNull()
})

it('forgets a home at once, and Undo puts it back', async () => {
  const at = fixture()
  manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  expect(screen.queryByText('My server')).toBeNull()
  expect(at.homes.forget).toHaveBeenCalledExactlyOnceWith(home.id)
  expect(screen.getByText('Forgot My server.')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByText('My server')).not.toBeNull()
  await waitFor(() => expect(at.homes.restore).toHaveBeenCalledExactlyOnceWith(home.id))
})

it('renames a home in place, at once, and puts the old name back where main refuses it', async () => {
  const at = fixture()
  at.homes.rename.mockRejectedValueOnce(new Error('Give the home a name of at most 120 characters, without control characters.'))
  manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  const field = await screen.findByLabelText('Name')
  await userEvent.clear(field)
  await userEvent.type(field, 'Hetzner box{Enter}')
  expect(at.homes.rename).toHaveBeenCalledExactlyOnceWith(home.id, 'Hetzner box')
  expect((await screen.findByRole('alert')).textContent).toContain('120 characters')
  expect(screen.getByText('My server')).not.toBeNull()
})

it('keeps a changed connection only where the check finds the same home, and offers another home as a new one', async () => {
  const at = fixture()
  manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
  const field = await screen.findByLabelText('SSH host')
  await userEvent.clear(field)
  await userEvent.type(field, 'root@fixture.example.com{Enter}')
  expect(await screen.findByText('Same home as before')).not.toBeNull()
  expect(at.homes.change).toHaveBeenCalledExactlyOnceWith(home.id, 'opaque-confirmation')
  at.homes.inspect.mockResolvedValueOnce({ ...checked, checkId: 'other-check', homeId: `home_${'9'.repeat(32)}`, target: 'other-box' })
  await userEvent.clear(field)
  await userEvent.type(field, 'other-box{Enter}')
  expect(await screen.findByText('other-box has a different home. My server stays on fixture.')).not.toBeNull()
  expect(at.homes.change).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Save as a new home' }))
  expect(at.homes.save).toHaveBeenCalledExactlyOnceWith('other-check', 'other-box')
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

it('fails startup on disconnect even if the initial metadata read never answers', async () => {
  const at = fixture()
  at.homes.state.mockReturnValue(new Promise(() => {}))
  const target = new EventTarget()
  const opening = receiveHomeConnection({ ...fakeHost(), homes: at.homes }, target as unknown as Window)
  at.emit({ ...remote, connection: 'disconnected', problem: 'Host went away' })
  await expect(opening).rejects.toThrow('Host went away')
  expect(at.listeners.size).toBe(0)
})
