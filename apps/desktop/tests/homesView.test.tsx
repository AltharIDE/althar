import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { CheckedHome, HomeState, HomesHost, HomesOverview } from '../src/homes'
import { ConnectHome } from '../src/renderer/features/homes/ConnectHome'
import { Chip, HomeConnections } from '../src/renderer/features/homes/HomeConnections'
import { ManageHomes } from '../src/renderer/features/homes/ManageHomes'
import { homesUi, useHomeState } from '../src/renderer/features/homes/useHomes'
import { hostForHome, receiveHomeConnection } from '../src/renderer/data/homeConnection'
import { fakeHost, fakeClient, project, home as snapshot } from './fixtures'
import { withServices } from './render'
import { HomeOpening } from '../src/renderer/features/homes/HomeOpening'
import { HomeReport } from '../src/renderer/features/homes/HomeReport'

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

it('restores connection edits on Escape, and rolls back a refused change or saving another home', async () => {
  const at = fixture()
  at.homes.change.mockRejectedValueOnce(new Error('Change refused'))
  manage(at)
  await userEvent.click(screen.getByRole('button', { name: 'My server, more' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit connection' }))
  const field = await screen.findByLabelText('SSH host')
  await userEvent.type(field, '-edited{Escape}')
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
