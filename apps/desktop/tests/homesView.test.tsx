import { StrictMode } from 'react'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { CheckedHome, HomeState, HomesHost, HomesOverview, RemoteHome } from '../src/homes'
import { ConnectHome } from '../src/renderer/features/homes/ConnectHome'
import { Chip, HomeConnections } from '../src/renderer/features/homes/HomeConnections'
import { ManageHomes } from '../src/renderer/features/homes/ManageHomes'
import { HomeOpening } from '../src/renderer/features/homes/HomeOpening'
import { HomeReport } from '../src/renderer/features/homes/HomeReport'
import { homeProblem, homesUi, keyOf, livenessOf, openedAgo, useHomeState, useHomesOverview } from '../src/renderer/features/homes/useHomes'
import { hostForHome, receiveHomeConnection } from '../src/renderer/data/homeConnection'
import { fakeClient, fakeHost, home as snapshot, project } from './fixtures'
import { servicesFor, withServices } from './render'
import { ServicesProvider } from '../src/renderer/data/services'
import { reads } from '../src/renderer/data/reads'
import { StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { welcome } from '../src/renderer/features/start/welcome'

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

it('connects the first home from a visible chip, and names a remote home in its own window', async () => {
  const at = fixture()
  at.homes.overview.mockResolvedValue({ ...overview, homes: [] })
  const view = render(
    <>
      <Chip homes={at.homes} />
      <HomeConnections host={{ ...fakeHost(), homes: at.homes }} />
    </>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Homes' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Connect a home…' }))
  expect(await screen.findByRole('dialog', { name: 'Connect a home' })).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
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
  https: {
    origin: 'https://home.test:6769',
    homeId: home.homeId,
    deviceId: `dev_${'6'.repeat(32)}`,
    tlsKeyPin: '7'.repeat(64),
    tlsCertificate: 'certificate',
  },
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
  act(() => {
    window.dispatchEvent(new Event('althar:show-homes'))
  })
  expect(await screen.findByRole('dialog', { name: 'Connect a home' })).not.toBeNull()
  act(() => homesUi.set({ dialog: null }))
})

const manage = (at: ReturnType<typeof fixture>, given: HomesOverview = overview, here: HomeState | null = local) => {
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

it('closes Manage homes at once on project press but waits for Undo to finish before opening the restored connection', async () => {
  const at = fixture()
  const restoring = later<void>()
  at.homes.restore.mockImplementation(() => restoring.promise)
  const { close } = manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await userEvent.click(screen.getByRole('button', { name: /ledger/ }))
  expect(close).toHaveBeenCalledOnce()
  expect(at.homes.open).not.toHaveBeenCalled()
  await act(async () => restoring.resolve(undefined))
  await waitFor(() => expect(at.homes.open).toHaveBeenCalledExactlyOnceWith(home.id, 'prj_ledger'))
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

it('shows the connecting route before a remote API is ready, then offers retry and closing without local helpers', async () => {
  const at = fixture()
  at.homes.state.mockResolvedValue({ ...remote, connection: 'connecting' })
  const host = fakeHost()
  const view = render(<HomeOpening host={host} homes={at.homes} home={home} problem={null} />)
  expect(screen.getByText('Connecting over SSH…')).not.toBeNull()
  expect(screen.getByText('fixture')).not.toBeNull()
  at.homes.reconnect.mockRejectedValueOnce(new Error('Still offline'))
  view.rerender(<HomeOpening host={host} homes={at.homes} home={home} problem="The host is offline." />)
  expect(screen.getByRole('alert').textContent).toContain('The host is offline.')
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Close window' }))
  expect(host.window).toHaveBeenCalledExactlyOnceWith('close')
  expect(host.pickFolder).not.toHaveBeenCalled()
})

it('names HTTPS in the opening screen without inventing SSH connection settings', async () => {
  const at = fixture()
  at.homes.state.mockResolvedValue({ current: { kind: 'https', home: paired }, connection: 'connecting' })
  render(<HomeOpening host={fakeHost()} homes={at.homes} home={paired} problem={null} />)
  expect(screen.getByText('Connecting securely…')).not.toBeNull()
  expect(screen.getByText(paired.https!.origin)).not.toBeNull()
  expect(screen.queryByText('Connecting over SSH…')).toBeNull()
})

it('reports the project snapshot and live attention counts, and sends only changed glances to main', async () => {
  const at = fixture()
  const call = {
    id: 'ask_1',
    kind: 'permission' as const,
    title: 'Publish',
    reason: 'Publishing asks.',
    command: 'npm publish',
    stuck: null,
    createdAt: '2026-10-07T09:10:00.000Z',
    projectId: project.id,
    taskId: null,
    threadId: 'coordinator',
    taskTitle: null,
    taskSlug: null,
  }
  const second = { ...project, id: 'p2', name: 'second', ink: 'moss' as const, working: 0 }
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [{ ...project, working: 2 }, second] })),
    getHome: vi.fn(async () => snapshot({ calls: [call] })),
  })
  const services = servicesFor(client, fakeHost({ homes: at.homes }))
  render(
    <ServicesProvider value={services}>
      <HomeReport />
    </ServicesProvider>,
  )
  await waitFor(() =>
    expect(at.homes.report).toHaveBeenLastCalledWith([
      { id: project.id, name: project.name, ink: project.ink, working: 2, yours: 1 },
      { id: second.id, name: second.name, ink: second.ink, working: 0, yours: 0 },
    ]),
  )
  const before = at.homes.report.mock.calls.length
  act(() => {
    services.cache.setQueryData(reads(client).projects().queryKey, { cursor: 4, projects: [{ ...project, working: 2 }, { ...second }] })
  })
  await act(async () => {})
  expect(at.homes.report).toHaveBeenCalledTimes(before)
  act(() => {
    services.cache.setQueryData(reads(client).projects().queryKey, { cursor: 5, projects: [{ ...project, working: 3 }] })
  })
  await waitFor(() =>
    expect(at.homes.report).toHaveBeenLastCalledWith([{ id: project.id, name: project.name, ink: project.ink, working: 3, yours: 1 }]),
  )
})

it('does not publish an unread project list, and reports an empty home without asking for a task snapshot', async () => {
  const at = fixture()
  const waiting = later<{ cursor: number; projects: (typeof project)[] }>()
  const { client } = fakeClient({ listProjects: vi.fn(() => waiting.promise) })
  const services = servicesFor(client, fakeHost({ homes: at.homes }))
  render(
    <ServicesProvider value={services}>
      <HomeReport />
    </ServicesProvider>,
  )
  expect(at.homes.report).not.toHaveBeenCalled()
  expect(client.getHome).not.toHaveBeenCalled()
  await act(async () => waiting.resolve({ cursor: 1, projects: [] }))
  await waitFor(() => expect(at.homes.report).toHaveBeenCalledExactlyOnceWith([]))
  expect(client.getHome).not.toHaveBeenCalled()
})

it('allows the same project reporting component without a native homes bridge', async () => {
  const { client } = fakeClient()
  const services = servicesFor(client, fakeHost())
  render(
    <ServicesProvider value={services}>
      <HomeReport />
    </ServicesProvider>,
  )
  await waitFor(() => expect(client.getHome).toHaveBeenCalled())
})

it('keeps a newer overview event when an old read completes, and stops listening on unmount', async () => {
  const at = fixture()
  const initial = later<HomesOverview>()
  at.homes.overview.mockReturnValueOnce(initial.promise)
  const hook = renderHook(() => useHomesOverview(at.homes))
  expect(hook.result.current).toBeNull()
  const next = { ...overview, homes: [{ ...home, name: 'Renamed elsewhere' }] }
  act(() => at.tell(next))
  await act(async () => initial.resolve(overview))
  expect(hook.result.current).toBe(next)
  hook.unmount()
  act(() => at.tell(overview))
  expect(hook.result.current).toBe(next)
})

it('stays usable without a native homes bridge or when its initial state read fails', async () => {
  const absent = renderHook(() => useHomeState(undefined))
  expect(absent.result.current).toBeNull()
  absent.unmount()
  const at = fixture()
  at.homes.state.mockRejectedValueOnce(new Error('Window closed'))
  const hook = renderHook(() => useHomeState(at.homes))
  await act(async () => {})
  expect(hook.result.current).toBeNull()
  act(() => at.emit(local))
  expect(hook.result.current).toBe(local)
  hook.unmount()
  expect(at.listeners.size).toBe(0)
})

it.each([
  [undefined, 'Not opened yet'],
  [0, 'Just now'],
  [3, '3 minutes ago'],
  [60, 'An hour ago'],
  [120, '2 hours ago'],
  [25 * 60, 'Yesterday'],
  [3 * 24 * 60, '3 days ago'],
  [-10, 'Just now'],
] as const)('describes when a home was last opened (%s minutes) as %s', (minutes, words) => {
  const now = Date.UTC(2026, 10, 17, 12)
  expect(openedAgo(minutes === undefined ? undefined : now - minutes * 60_000, now)).toBe(words)
})

it('keeps public home keys stable and describes connection status independently of saved connection ids', () => {
  expect(keyOf('local')).toBe('local')
  expect(keyOf({ id: 'local', homeId: home.homeId })).toBe('local')
  expect(keyOf(home)).toBe(home.homeId)
  expect(keyOf({ id: 'legacy' })).toBe('legacy')
  expect(livenessOf(null, 'local')).toBe('live')
  expect(livenessOf(null, home)).toBe('rest')
  for (const [connection, status] of [
    ['connected', 'live'],
    ['connecting', 'connecting'],
    ['disconnected', 'down'],
    ['local', 'rest'],
  ] as const)
    expect(livenessOf({ ...overview, windows: { [home.homeId]: connection } }, home)).toBe(status)
  expect(homeProblem(new Error("Error invoking remote method 'althar:homes-connect': Error: Host is offline"))).toBe('Host is offline')
  expect(homeProblem(new Error('Still offline'))).toBe('Still offline')
  expect(homeProblem(null)).toContain('could not be changed')
})

it('keeps malformed or expired pairing codes out of a connection, and accepts a replacement code', async () => {
  const at = fixture()
  const pair = vi.fn(async () => {})
  const pairingInfo = vi.fn(async () => ({ origin: 'https://replacement.test', homeId: home.homeId, expiresAt: Number.MAX_SAFE_INTEGER }))
  pairingInfo.mockRejectedValueOnce(new Error('This pairing code expired.'))
  render(<ConnectHome homes={{ ...at.homes, pair, pairingInfo }} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText('Name'), 'My VPS')
  await userEvent.type(screen.getByLabelText('Pairing code'), 'x')
  expect((await screen.findByRole('alert')).textContent).toContain('expired')
  expect(screen.getByRole('button', { name: 'Pair and open' }).getAttribute('disabled')).not.toBeNull()
  expect(pair).not.toHaveBeenCalled()
  await userEvent.clear(screen.getByLabelText('Pairing code'))
  await userEvent.type(screen.getByLabelText('Pairing code'), 'new-code')
  expect(await screen.findByText('https://replacement.test')).not.toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Pair and open' }))
  await waitFor(() => expect(pair).toHaveBeenCalledExactlyOnceWith('new-code', 'My VPS'))
})

it('retains the private pairing code and name on failure, shows busy immediately, and retries explicitly', async () => {
  const at = fixture()
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_resolve, refuse) => {
    reject = refuse
  })
  const pair = vi.fn(async () => {}).mockImplementationOnce(() => pending)
  const close = vi.fn()
  const pairingInfo = vi.fn(async () => ({ origin: 'https://home.test', homeId: home.homeId, expiresAt: Number.MAX_SAFE_INTEGER }))
  render(<ConnectHome homes={{ ...at.homes, pair, pairingInfo }} onClose={close} />)
  await userEvent.type(screen.getByLabelText('Name'), 'My VPS')
  await userEvent.type(screen.getByLabelText('Pairing code'), 'same-code')
  await screen.findByText('https://home.test')
  await userEvent.click(screen.getByRole('button', { name: 'Pair and open' }))
  expect(screen.getByLabelText('Pairing code').getAttribute('disabled')).not.toBeNull()
  expect(screen.getByLabelText('Name').getAttribute('disabled')).not.toBeNull()
  await act(async () => reject(new Error('Unlock the keyring.')))
  expect((await screen.findByRole('alert')).textContent).toContain('Unlock the keyring')
  expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('same-code')
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My VPS')
  expect(close).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Pair and open' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(pair).toHaveBeenNthCalledWith(2, 'same-code', 'My VPS')
})

it('cancels an in-flight pairing when the dialog closes and ignores its late reply', async () => {
  const at = fixture()
  const waiting = later<void>()
  const close = vi.fn()
  const pair = vi.fn(() => waiting.promise)
  const pairingInfo = vi.fn(async () => ({ origin: 'https://home.test', homeId: home.homeId, expiresAt: Number.MAX_SAFE_INTEGER }))
  const view = render(<ConnectHome homes={{ ...at.homes, pair, pairingInfo }} onClose={close} />)
  await userEvent.type(screen.getByLabelText('Name'), 'My VPS')
  await userEvent.type(screen.getByLabelText('Pairing code'), 'pending-code')
  await screen.findByText('https://home.test')
  await userEvent.click(screen.getByRole('button', { name: 'Pair and open' }))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  view.unmount()
  await act(async () => waiting.resolve(undefined))
  expect(close).toHaveBeenCalledOnce()
  expect(at.homes.cancelCheck).toHaveBeenCalled()
})

it('brings a home back after Forget fails and does not pretend it was removed', async () => {
  const at = fixture()
  at.homes.forget.mockRejectedValueOnce(new Error('Saved connections are read-only.'))
  manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  expect((await screen.findByRole('alert')).textContent).toContain('read-only')
  expect(screen.getByText('My server')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
})

it('keeps a failed Undo forgotten after the committed removal is reported', async () => {
  const at = fixture()
  at.homes.restore.mockRejectedValueOnce(new Error('The connection key could not be restored.'))
  const { view } = manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  view.rerender(<ManageHomes homes={at.homes} overview={{ ...overview, homes: [] }} here={local} onClose={() => {}} onConnect={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect((await screen.findByRole('alert')).textContent).toContain('could not be restored')
  expect(screen.queryByText('My server')).toBeNull()
})

it('preserves the order of Forget, Undo and Forget again while persistence is held', async () => {
  const at = fixture()
  const writing = later<void>()
  const restoring = later<void>()
  const order: string[] = []
  at.homes.forget
    .mockImplementationOnce(() => {
      order.push('forget')
      return writing.promise
    })
    .mockImplementation(async () => {
      order.push('forget')
    })
  at.homes.restore.mockImplementation(() => {
    order.push('restore')
    return restoring.promise
  })
  manage(at)
  const forget = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  }
  await forget()
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await forget()
  expect(order).toEqual(['forget'])
  await act(async () => writing.resolve(undefined))
  expect(order).toEqual(['forget', 'restore'])
  await act(async () => restoring.resolve(undefined))
  await waitFor(() => expect(order).toEqual(['forget', 'restore', 'forget']))
  expect(screen.queryByText('My server')).toBeNull()
})

it('cancels a rename on Escape and ignores an empty name on blur', async () => {
  const at = fixture()
  const { close } = manage(at)
  const rename = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  }
  await rename()
  await userEvent.type(await screen.findByLabelText('Name'), 'discard{Escape}')
  expect(at.homes.rename).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  await rename()
  await userEvent.clear(await screen.findByLabelText('Name'))
  await userEvent.click(screen.getByRole('heading', { name: 'Homes' }))
  expect(at.homes.rename).not.toHaveBeenCalled()
  expect(screen.getByText('My server')).not.toBeNull()
})

it('settles an optimistic rename when main reports it and opens this computer’s own project on its home', async () => {
  const at = fixture()
  const { view, close } = manage(at)
  await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  const name = await screen.findByLabelText('Name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Saved server{Enter}')
  view.rerender(
    <ManageHomes
      homes={at.homes}
      overview={{ ...overview, homes: [{ ...home, name: 'Saved server' }] }}
      here={local}
      onClose={close}
      onConnect={() => {}}
    />,
  )
  expect(screen.getByText('Saved server')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /althar/ }))
  await waitFor(() => expect(at.homes.open).toHaveBeenCalledExactlyOnceWith('local', 'prj_althar'))
})

it.each(['connecting', 'disconnected', 'connected'] as const)(
  'shows a saved home as %s while its projects have not been read',
  async (connection) => {
    const at = fixture()
    manage(at, { ...overview, windows: { [home.homeId]: connection }, projects: {} }, null)
    expect(
      screen.getByText(connection === 'connecting' ? 'Connecting…' : connection === 'disconnected' ? 'Disconnected' : 'Open'),
    ).not.toBeNull()
    expect(screen.getByText('Open it to see its projects here.')).not.toBeNull()
    expect(screen.getByText('Its projects show here once a window on it opens.')).not.toBeNull()
  },
)

it('offers setup for empty project shelves and uses the Connect a home action without opening a folder', async () => {
  const at = fixture()
  const connect = vi.fn()
  render(
    <ManageHomes
      homes={at.homes}
      overview={{ ...overview, projects: { local: { live: true, list: [] }, [home.homeId]: { live: true, list: [] } } }}
      here={local}
      onClose={() => {}}
      onConnect={connect}
    />,
  )
  expect(screen.getByText('Add a project and it shows here.')).not.toBeNull()
  expect(screen.getByText('Add a project on the host and it shows here.')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Connect a home' }))
  expect(connect).toHaveBeenCalledOnce()
})

it.each([
  [0, 1, 'Needs you'],
  [0, 0, 'Nothing running'],
  [3, 0, '3 running'],
] as const)('reports a live project with %s working and %s waiting as %s', (working, yours, words) => {
  const at = fixture()
  manage(at, {
    ...overview,
    projects: { [home.homeId]: { live: true, list: [{ id: 'p', name: 'A project', ink: 'clay', working, yours }] } },
  })
  expect(screen.getByText(words)).not.toBeNull()
})

it('keeps a stale home-menu selection from becoming an unhandled native rejection', async () => {
  const at = fixture()
  at.homes.open.mockRejectedValueOnce(new Error('This saved home was forgotten.'))
  render(
    <>
      <Chip homes={at.homes} />
      <HomeConnections host={{ ...fakeHost(), homes: at.homes }} />
    </>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Homes' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'My server' }))
  await waitFor(() => expect(at.homes.open).toHaveBeenCalledExactlyOnceWith(home.id))
  expect(screen.queryByRole('menu')).toBeNull()
})

it('opens management through the native Homes action before a chip is mounted and lets the person connect another home', async () => {
  const at = fixture()
  const opened = new Set<() => void>()
  const homes = {
    ...at.homes,
    onOpen: (listener: () => void) => {
      opened.add(listener)
      return () => void opened.delete(listener)
    },
  }
  const view = render(<HomeConnections host={{ ...fakeHost(), homes }} />)
  await act(async () => {})
  act(() => {
    for (const listener of opened) listener()
  })
  const dialog = await screen.findByRole('dialog', { name: 'Homes' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Connect a home' }))
  expect(await screen.findByRole('dialog', { name: 'Connect a home' })).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  view.unmount()
  expect(opened.size).toBe(0)
})

it('renders no connection controls without a native homes bridge', () => {
  const view = render(<HomeConnections host={fakeHost()} />)
  expect(view.container.textContent).toBe('')
})

it.each([false, true])(
  'keeps the correct saved target after a connection edit fails (another window changed it: %s)',
  async (changedElsewhere) => {
    const at = fixture()
    let refuse!: (error: Error) => void
    at.homes.change.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = reject
        }),
    )
    const { view } = manage(at)
    await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
    const field = await screen.findByLabelText('SSH host')
    await userEvent.clear(field)
    await userEvent.type(field, 'new-host{Enter}')
    await screen.findByText('Same home as before')
    if (changedElsewhere)
      view.rerender(
        <ManageHomes
          homes={at.homes}
          overview={{ ...overview, homes: [{ ...home, ssh: { target: 'external-host' } }] }}
          here={local}
          onClose={() => {}}
          onConnect={() => {}}
        />,
      )
    await act(async () => refuse(new Error('The connection could not be saved.')))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((screen.getByLabelText('SSH host') as HTMLInputElement).value).toBe(changedElsewhere ? 'external-host' : 'fixture')
    expect(screen.queryByRole('alert')).toBeNull()
  },
)

it('keeps the original home when saving another checked home fails', async () => {
  const at = fixture()
  at.homes.inspect.mockResolvedValueOnce({ ...checked, homeId: `home_${'9'.repeat(32)}`, target: 'other-host' })
  at.homes.save.mockRejectedValueOnce(new Error('Saved connections are full.'))
  manage(at)
  await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
  const field = await screen.findByLabelText('SSH host')
  await userEvent.clear(field)
  await userEvent.type(field, 'other-host{Enter}')
  await userEvent.click(await screen.findByRole('button', { name: 'Save as a new home' }))
  expect((await screen.findByRole('alert')).textContent).toContain('connections are full')
  expect((screen.getByLabelText('SSH host') as HTMLInputElement).value).toBe('fixture')
  expect(screen.getByText('My server')).not.toBeNull()
  expect(at.homes.change).not.toHaveBeenCalled()
})

it('closes an early port when the final home state is not authenticated', async () => {
  const at = fixture()
  at.homes.state.mockResolvedValueOnce({ ...remote, connection: 'connecting' }).mockResolvedValueOnce({ ...remote, identity: undefined })
  const postMessage = vi.fn()
  const port = { postMessage } as unknown as MessagePort
  const target = new EventTarget()
  const opening = receiveHomeConnection({ ...fakeHost(), homes: at.homes }, target as unknown as Window)
  target.dispatchEvent(new MessageEvent('message', { data: 'althar:port', ports: [port] }))
  await expect(opening).rejects.toThrow('verified connection')
  expect(postMessage).toHaveBeenCalledWith([1])
  expect(at.listeners.size).toBe(0)
})

it('receives a local runtime without a native homes bridge', async () => {
  const port = {} as MessagePort
  const target = new EventTarget()
  const opening = receiveHomeConnection(fakeHost(), target as unknown as Window)
  target.dispatchEvent(new MessageEvent('message', { data: 'althar:port', ports: [port] }))
  expect(await opening).toEqual({ port, home: local })
})

it.each([false, true])('bounds startup when a runtime never sends its port (remote: %s)', async (away) => {
  vi.useFakeTimers()
  try {
    const at = fixture()
    at.homes.state.mockResolvedValue(away ? remote : local)
    const opening = receiveHomeConnection({ ...fakeHost(), homes: at.homes }, new EventTarget() as unknown as Window)
    const failure = expect(opening).rejects.toThrow(away ? 'service and network' : 'runtime didn’t start')
    await vi.advanceTimersByTimeAsync(away ? 60_000 : 15_000)
    await failure
    expect(at.listeners.size).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

function RemoteStart() {
  const model = useStart()
  return <StartView model={model} accounts={useAccountSignIn(model)} onProject={() => {}} home={() => <p>Projects on the remote home</p>} />
}

it.each([remote, { current: { kind: 'https' as const, home: paired }, connection: 'connected' as const }])(
  'names an empty remote home, then opens its projects without running local onboarding (%s)',
  async (here) => {
    const at = fixture()
    at.homes.state.mockResolvedValue(here)
    const listed = later<{ cursor: number; projects: (typeof project)[] }>()
    const { client } = fakeClient({
      connection: {
        identity: remote.identity!,
        hostDeviceId: checked.hostDeviceId,
        apiVersion: 1,
        appVersion: 'test',
        position: { homeId: home.homeId, cursor: 0, checkpoint: null },
      },
      listProjects: vi.fn(() => listed.promise),
    })
    const host = fakeHost({ homes: at.homes })
    const services = servicesFor(client, host)
    // A local welcome left on show must not replace the remote host’s first screen.
    welcome.begin()
    render(
      <ServicesProvider value={services}>
        <RemoteStart />
      </ServicesProvider>,
    )
    expect(screen.queryByText('Projects on the remote home')).toBeNull()
    expect(screen.queryByRole('heading', { name: /No projects/ })).toBeNull()
    await act(async () => listed.resolve({ cursor: 0, projects: [] }))
    const name = here.current.kind === 'local' ? '' : here.current.home.name
    expect(await screen.findByRole('heading', { name: `No projects on ${name} yet` })).not.toBeNull()
    expect(host.findRepositories).not.toHaveBeenCalled()
    expect(host.pickFolders).not.toHaveBeenCalled()
    act(() => {
      services.cache.setQueryData(reads(client).projects().queryKey, { cursor: 1, projects: [project] })
    })
    expect(await screen.findByText('Projects on the remote home')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: /No projects/ })).toBeNull()
  },
)

it('rolls back a refused Forget and a refused Undo, keeping the error visible', async () => {
  const at = fixture()
  at.homes.forget.mockRejectedValueOnce(new Error('Cannot forget'))
  const { view } = manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot forget')
  expect(screen.getByText('My server')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  view.unmount()
  at.homes.restore.mockRejectedValueOnce(new Error('Undo expired'))
  const next = manage(at)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Forget' }))
  next.view.rerender(
    <ManageHomes homes={at.homes} overview={{ ...overview, homes: [] }} here={local} onClose={() => {}} onConnect={() => {}} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Undo expired')
  expect(screen.queryByText('My server')).toBeNull()
})

it('keeps renames on blur, cancels with Escape, ignores blank names and settles an acknowledged rename', async () => {
  const at = fixture()
  const { view } = manage(at)
  const rename = async () => {
    await userEvent.click(screen.getByRole('button', { name: /, more/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    return screen.findByLabelText('Name')
  }
  const field = await rename()
  await userEvent.type(field, 'New name{Escape}')
  expect(screen.getByText(home.name)).not.toBeNull()
  expect(at.homes.rename).not.toHaveBeenCalled()
  await userEvent.clear(await rename())
  await userEvent.keyboard('{Enter}')
  expect(at.homes.rename).not.toHaveBeenCalled()
  const production = await rename()
  await userEvent.clear(production)
  await userEvent.type(production, 'Production')
  await userEvent.tab()
  expect(at.homes.rename).toHaveBeenCalledExactlyOnceWith(home.id, 'Production')
  expect(screen.getByText('Production')).not.toBeNull()
  view.rerender(
    <ManageHomes
      homes={at.homes}
      overview={{ ...overview, homes: [{ ...home, name: 'Production' }] }}
      here={local}
      onClose={() => {}}
      onConnect={() => {}}
    />,
  )
  expect(screen.getByText('Production')).not.toBeNull()
})

it.each(['connecting', 'disconnected', 'connected'] as const)(
  'shows %s homes and opens them without a project from their menu',
  async (connection) => {
    const at = fixture()
    const { close } = manage(at, { ...overview, windows: { [home.homeId]: connection } })
    expect(
      await screen.findByText(connection === 'connecting' ? 'Connecting…' : connection === 'disconnected' ? 'Disconnected' : 'Open'),
    ).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open' }))
    await waitFor(() => expect(at.homes.open).toHaveBeenCalledExactlyOnceWith(home.id, undefined))
    expect(close).toHaveBeenCalledOnce()
  },
)

it('identifies its own remote window and offers Connect even when projects are not known yet', async () => {
  const at = fixture()
  const connect = vi.fn()
  render(<ManageHomes homes={at.homes} overview={{ ...overview, projects: {} }} here={remote} onClose={() => {}} onConnect={connect} />)
  expect(screen.getByText('This window')).not.toBeNull()
  expect(screen.getByText('Its projects show here once a window on it opens.')).not.toBeNull()
  expect(screen.getByText('Open it to see its projects here.')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
  expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Connect a home' }))
  expect(connect).toHaveBeenCalledOnce()
})

it('distinguishes empty homes and live projects that are idle, running, or waiting on the person', async () => {
  const at = fixture()
  const { view } = manage(at, { ...overview, projects: { local: { live: true, list: [] }, [home.homeId]: { live: true, list: [] } } })
  expect(screen.getByText('Add a project and it shows here.')).not.toBeNull()
  expect(screen.getByText('Add a project on the host and it shows here.')).not.toBeNull()
  view.rerender(
    <ManageHomes
      homes={at.homes}
      overview={{
        ...overview,
        projects: {
          local: {
            live: true,
            list: [
              { id: 'idle', name: 'Idle', ink: 'clay', working: 0, yours: 0 },
              { id: 'running', name: 'Running', ink: 'clay', working: 2, yours: 0 },
              { id: 'waiting', name: 'Waiting', ink: 'clay', working: 0, yours: 1 },
            ],
          },
        },
      }}
      here={local}
      onClose={() => {}}
      onConnect={() => {}}
    />,
  )
  expect(screen.getByText('Nothing running')).not.toBeNull()
  expect(screen.getByText('2 running')).not.toBeNull()
  expect(screen.getByText('Needs you')).not.toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Idle/ }))
  await waitFor(() => expect(at.homes.open).toHaveBeenCalledWith('local', 'idle'))
})

it('cancels connection edits, and rolls back a refused change or saving another home', async () => {
  const at = fixture()
  at.homes.change.mockRejectedValueOnce(new Error('Change refused'))
  manage(at)
  await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
  const field = await screen.findByLabelText('SSH host')
  await userEvent.type(field, '-edited')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect((field as HTMLInputElement).value).toBe('fixture')
  await userEvent.type(field, '-new{Enter}')
  expect((await screen.findByRole('alert')).textContent).toContain('Change refused')
  expect(screen.getByRole('button', { name: 'Check and save' })).not.toBeNull()
  at.homes.inspect.mockResolvedValueOnce({ ...checked, homeId: 'other-home' })
  await userEvent.click(screen.getByRole('button', { name: 'Check and save' }))
  await screen.findByRole('button', { name: 'Save as a new home' })
  at.homes.save.mockRejectedValueOnce(new Error('Save refused'))
  await userEvent.click(screen.getByRole('button', { name: 'Save as a new home' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Save refused')
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByLabelText('SSH host')).toBeNull()
})

it('shows connection progress, then the failure with explicit retry and close actions', async () => {
  const at = fixture()
  const host = { ...fakeHost(), homes: at.homes }
  const view = render(<HomeOpening host={host} homes={at.homes} home={home} problem={null} />)
  expect(screen.getByText('Connecting over SSH…')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  view.rerender(<HomeOpening host={host} homes={at.homes} home={home} problem="SSH refused" />)
  expect(screen.getByText('SSH refused')).not.toBeNull()
  at.homes.reconnect.mockRejectedValueOnce(new Error('Still down'))
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Close window' }))
  expect(host.window).toHaveBeenCalledWith('close')
})

it('reports known project activity to the other home windows, after its project read answers', async () => {
  const at = fixture()
  const projects = later<Awaited<ReturnType<ReturnType<typeof fakeClient>['client']['listProjects']>>>()
  const { client } = fakeClient({ listProjects: vi.fn(() => projects.promise), getHome: vi.fn(async () => snapshot()) })
  const host = { ...fakeHost(), homes: at.homes }
  withServices(<HomeReport />, client, host)
  expect(at.homes.report).not.toHaveBeenCalled()
  await act(async () => projects.resolve({ cursor: 3, projects: [{ ...project, working: 2 }] }))
  await waitFor(() =>
    expect(at.homes.report).toHaveBeenCalledWith([{ id: project.id, name: project.name, ink: project.ink, working: 2, yours: 0 }]),
  )
  expect(client.getHome).toHaveBeenCalled()
})

it('reports an empty home without reading its task activity', async () => {
  const at = fixture()
  const { client } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 3, projects: [] })) })
  withServices(<HomeReport />, client, { ...fakeHost(), homes: at.homes })
  await waitFor(() => expect(at.homes.report).toHaveBeenCalledWith([]))
  expect(client.getHome).not.toHaveBeenCalled()
})

it('opens local and saved homes from the menu, and reaches Manage and Connect from File › Homes', async () => {
  const at = fixture()
  render(
    <>
      <Chip homes={at.homes} />
      <HomeConnections host={{ ...fakeHost(), homes: at.homes }} />
    </>,
  )
  const show = async () => {
    act(() => {
      window.dispatchEvent(new Event('althar:show-homes'))
    })
    await screen.findByRole('menuitem', { name: /This computer/ })
  }
  await screen.findByRole('button', { name: 'Homes' })
  await show()
  await userEvent.click(screen.getByRole('menuitem', { name: /This computer/ }))
  expect(at.homes.open).toHaveBeenCalledWith('local')
  await show()
  await userEvent.click(screen.getByRole('menuitem', { name: /My server/ }))
  expect(at.homes.open).toHaveBeenCalledWith(home.id)
  await show()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Manage homes…' }))
  await screen.findByRole('dialog', { name: 'Homes' })
  await userEvent.click(screen.getByRole('button', { name: 'Connect a home' }))
  await screen.findByRole('dialog', { name: 'Connect a home' })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps a forgotten home in its own window’s menu while reconnecting and disconnected', async () => {
  const at = fixture()
  at.homes.state.mockResolvedValue({ ...remote, connection: 'connecting' })
  at.homes.overview.mockResolvedValue({ ...overview, homes: [], windows: {} })
  render(<Chip homes={at.homes} />)
  await userEvent.click(await screen.findByRole('button', { name: 'My server, reconnecting. Homes' }))
  expect(await screen.findByRole('menuitem', { name: /My server/ })).not.toBeNull()
  expect(screen.getByText('This window')).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  act(() => at.emit({ ...remote, connection: 'disconnected', problem: 'SSH lost' }))
  await userEvent.click(screen.getByRole('button', { name: 'My server, disconnected. Homes' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Reconnect/ }))
  expect(at.homes.reconnect).toHaveBeenCalledOnce()
})

it('opens Manage from File › Homes when saved homes exist but no chip is drawn', async () => {
  const at = fixture()
  render(<HomeConnections host={{ ...fakeHost(), homes: at.homes }} />)
  await act(async () => {})
  act(() => {
    window.dispatchEvent(new Event('althar:show-homes'))
  })
  await screen.findByRole('dialog', { name: 'Homes' })
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
