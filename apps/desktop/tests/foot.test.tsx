import { ApiError, type Launch, type ShownTerminal, type WatchEvent } from '@althar/contracts'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageOpenerProvider } from '../src/renderer/features/browser/opener'
import { Foot, terminalNames, toggleTerminal } from '../src/renderer/features/foot/Foot'
import { setFootShown } from '../src/renderer/features/foot/shown'
import { makeFootStore } from '../src/renderer/features/foot/store'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * The status line's store: a terminal opened is there at once and its keys
 * wait for its shell, then go in order; one closed or a run dismissed is
 * gone at once, and comes back with a line where the runtime couldn't close
 * or stop it; the runtime's lists keep it as they say it.
 */

const feed = () => {
  const listeners = new Set<(event: WatchEvent) => void>()
  return {
    listen: (listener: (event: WatchEvent) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    say: (event: WatchEvent) => {
      for (const listener of listeners) listener(event)
    },
  }
}

const launch = (more: Partial<Launch>): Launch => ({
  id: 'launch_ios',
  command: 'bunx expo run:ios',
  label: 'iOS simulator',
  url: null,
  startedAt: '2026-11-18T22:00:00.000Z',
  ended: null,
  taskId: null,
  runnableId: 'rnbl_ios',
  where: 'main',
  ...more,
})

const shell = (more: Partial<ShownTerminal>): ShownTerminal => ({
  id: 'term_000001',
  projectId: 'proj_1',
  taskId: null,
  launchId: null,
  folder: '/repo',
  where: 'althar',
  title: 'zsh',
  busy: false,
  startedAt: '2026-11-18T22:00:00.000Z',
  exited: null,
  ...more,
})

const renderFoot = (overrides: Parameters<typeof fakeClient>[0], handlesRerun = false) => {
  const { client } = fakeClient(overrides)
  const onHelp = vi.fn<React.ComponentProps<typeof Foot>['onHelp']>()
  const onRunAgain = vi.fn(() => handlesRerun)
  const openRun = vi.fn()
  withServices(
    <PageOpenerProvider value={{ run: openRun, link: vi.fn(), links: 'beside' }}>
      <Foot projectId="proj_1" taskId="task_1" where="A task" onHelp={onHelp} onRunAgain={onRunAgain} />
    </PageOpenerProvider>,
    client,
  )
  return { client, onHelp, onRunAgain, openRun }
}

describe('the status line and drawer', () => {
  afterEach(() => act(() => setFootShown(true)))

  it('opens a running preview alongside the conversation and can stop the run from its drawer', async () => {
    const url = 'http://localhost:4321/'
    const { label: _label, ...run } = launch({ url, branch: 'preview' })
    const { client, openRun } = renderFoot({ listLaunches: vi.fn(async () => [run]) })

    await userEvent.click(await screen.findByRole('button', { name: /bunx expo run:ios/i, pressed: false }))
    const drawer = within(screen.getByRole('region', { name: 'Runs and terminals drawer' }))
    expect(drawer.getByText('preview')).toBeTruthy()
    await userEvent.click(drawer.getByRole('button', { name: 'Open localhost:4321' }))
    expect(openRun).toHaveBeenCalledWith(url)
    await userEvent.click(drawer.getByRole('button', { name: 'Stop' }))
    expect(client.stopLaunch).toHaveBeenCalledWith(run.id)
    expect(screen.queryByRole('region', { name: 'Runs and terminals drawer' })).toBeNull()
  })

  it('lowers a failed run’s drawer before offering its command, exit status and output to the composer', async () => {
    const ended = { at: '2026-11-18T22:01:00.000Z', code: 1 }
    const run = launch({ ended })
    const { onHelp } = renderFoot({ listLaunches: vi.fn(async () => [run]) })

    await userEvent.click(await screen.findByRole('button', { name: /iOS simulator/i, pressed: false }))
    await userEvent.click(screen.getByRole('button', { name: 'Help me fix it' }))

    expect(screen.queryByRole('region', { name: 'Runs and terminals drawer' })).toBeNull()
    expect(onHelp).toHaveBeenCalledWith(
      { name: run.label, command: run.command, ended: { ...ended, stopped: false, last: null } },
      expect.any(Function),
    )
    const output = onHelp.mock.calls[0]?.[1]
    await expect(output?.()).resolves.toContain('VITE ready')
  })

  it.each([false, true])('reruns a finished task command and lets its card handle it when available (%s)', async (handlesRerun) => {
    const run = launch({ ended: { at: '2026-11-18T22:01:00.000Z', code: 0 }, taskId: 'task_1' })
    const { client, onRunAgain } = renderFoot({ listLaunches: vi.fn(async () => [run]) }, handlesRerun)

    await userEvent.click(await screen.findByRole('button', { name: /iOS simulator/i, pressed: false }))
    await userEvent.click(screen.getByRole('button', { name: 'Run again' }))

    expect(onRunAgain).toHaveBeenCalledWith(run)
    if (handlesRerun) expect(client.runProject).not.toHaveBeenCalled()
    else expect(client.runProject).toHaveBeenCalledWith('proj_1', 'task_1', null, run.runnableId)
  })

  it('leaves a worker’s finished branch run to its own card and clears it from the line', async () => {
    const run = launch({ ended: { at: '2026-11-18T22:01:00.000Z', code: 0 }, branch: 'preview', workerId: 'worker_1' })
    const { client } = renderFoot({ listLaunches: vi.fn(async () => [run]) })

    await userEvent.click(await screen.findByRole('button', { name: /iOS simulator/i, pressed: false }))
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open a terminal where it ran' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: /iOS simulator/i, pressed: true }), { key: 'Delete' })
    expect(client.clearLaunch).toHaveBeenCalledWith(run.id)
  })

  it('opens a terminal in the run’s folder and can start another one in the same place', async () => {
    const run = launch({ taskId: 'task_1', branch: 'preview' })
    const { client } = renderFoot({ listLaunches: vi.fn(async () => [run]) })

    await userEvent.click(await screen.findByRole('button', { name: /iOS simulator/i, pressed: false }))
    await userEvent.click(screen.getByRole('button', { name: 'Open a terminal where it ran' }))
    await waitFor(() => expect(client.openTerminal).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole('button', { name: 'New terminal here' }))
    await waitFor(() => expect(client.openTerminal).toHaveBeenCalledTimes(2))

    const location = { projectId: 'proj_1', taskId: 'task_1', launchId: run.id }
    expect(client.openTerminal).toHaveBeenNthCalledWith(1, expect.objectContaining(location))
    expect(client.openTerminal).toHaveBeenNthCalledWith(2, expect.objectContaining(location))
  })

  it('drops the starting label when a command keeps running without a URL', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    try {
      const run = launch({ startedAt: new Date().toISOString() })
      renderFoot({ listLaunches: vi.fn(async () => [run]) })

      await screen.findByRole('button', { name: /^iOS simulator.*Starting/, pressed: false })
      act(() => {
        vi.advanceTimersByTime(11_000)
      })
      expect(screen.getByRole('button', { name: 'iOS simulator', pressed: false })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a hidden bar and raises its existing terminal with the terminal shortcut', async () => {
    setFootShown(false)
    const { client } = renderFoot({ listTerminals: vi.fn(async () => [shell({ busy: true, title: 'bun' })]) })
    await waitFor(() => expect(client.listTerminals).toHaveBeenCalledWith('proj_1'))

    fireEvent.keyDown(window, { key: '`', metaKey: true })
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.keyDown(window, { code: 'Backquote', ctrlKey: true })

    const drawer = within(screen.getByRole('region', { name: 'Runs and terminals drawer' }))
    expect(drawer.getByText('bun')).toBeTruthy()
    expect(client.attachTerminal).toHaveBeenCalledWith('term_000001', expect.any(Function), expect.any(Function))
    expect(client.openTerminal).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(screen.queryByRole('region', { name: 'Runs and terminals drawer' })).toBeNull()
  })
})

describe('the status line’s store', () => {
  it('shows a terminal at once, raised, and sends what is typed to its shell in order once it has started', async () => {
    let started: (shown: ShownTerminal) => void = () => {}
    const { client } = fakeClient({
      openTerminal: vi.fn((input) => new Promise<ShownTerminal>((resolve) => (started = () => resolve(shell({ id: input.id }))))),
    })
    const store = makeFootStore(client, feed(), {}, 'proj_1')
    const id = store.openTerminal({ taskId: 'task_1', where: 'A task' })
    expect(store.get()).toMatchObject({ raised: true, chosen: { kind: 'terminal', id } })
    expect(store.get().terminals).toMatchObject([{ id, where: 'A task', opening: true, taskId: 'task_1' }])
    // Typed before its shell started: it waits.
    const session = store.sessionOf(id)
    session.term.input('ls', true)
    session.term.input('\r', true)
    await waitFor(() => expect(client.openTerminal).toHaveBeenCalledOnce())
    expect(client.openTerminal).toHaveBeenCalledWith(expect.objectContaining({ id, projectId: 'proj_1', taskId: 'task_1' }))
    expect(client.writeTerminal).not.toHaveBeenCalled()
    started(shell({ id }))
    await waitFor(() => expect(client.writeTerminal).toHaveBeenCalledWith(id, 'ls\r'))
    expect(client.attachTerminal).toHaveBeenCalledWith(id, expect.any(Function), expect.any(Function))
    // The runtime's list, said before it opened, doesn't drop it.
    expect(store.get().terminals.map((one) => [one.id, one.opening])).toEqual([[id, false]])
  })

  it('says why a terminal couldn’t start, in it, and keeps it to close', async () => {
    const { client } = fakeClient({
      openTerminal: vi.fn(async () =>
        Promise.reject(new ApiError({ reason: 'NotFound', message: 'Althar couldn’t start zsh: no such folder' })),
      ),
    })
    const store = makeFootStore(client, feed(), {}, 'proj_1')
    const id = store.openTerminal({ taskId: null, where: 'althar' })
    await waitFor(() => expect(store.get().terminals[0]?.failed).toBe('Althar couldn’t start zsh: no such folder'))
    store.dismiss({ kind: 'terminal', id })
    expect(store.get().terminals).toEqual([])
    expect(client.closeTerminal).not.toHaveBeenCalled()
  })

  it('closes a terminal at once, and lowers the drawer once nothing is left to show', async () => {
    const { client } = fakeClient({ listTerminals: vi.fn(async () => [shell({})]) })
    const store = makeFootStore(client, feed(), {}, 'proj_1')
    await waitFor(() => expect(store.get().terminals).toHaveLength(1))
    store.press({ kind: 'terminal', id: 'term_000001' })
    expect(store.get().raised).toBe(true)
    store.dismiss({ kind: 'terminal', id: 'term_000001' })
    expect(store.get()).toMatchObject({ terminals: [], raised: false, chosen: null })
    expect(client.closeTerminal).toHaveBeenCalledWith('term_000001')
  })

  it('brings a terminal back with a line, drawn again from what it kept, where the runtime didn’t close it', async () => {
    const { client } = fakeClient({
      listTerminals: vi.fn(async () => [shell({ busy: true, title: 'bun' })]),
      closeTerminal: vi.fn(async () =>
        Promise.reject(new ApiError({ reason: 'Unavailable', message: 'Althar’s runtime isn’t answering.' })),
      ),
    })
    const store = makeFootStore(client, feed(), {}, 'proj_1')
    await waitFor(() => expect(store.get().terminals).toHaveLength(1))
    const was = store.sessionOf('term_000001')
    store.dismiss({ kind: 'terminal', id: 'term_000001' })
    expect(store.get().terminals).toEqual([])
    await waitFor(() => expect(store.get().problem).toBe('Althar’s runtime isn’t answering.'))
    expect(store.get().terminals.map((one) => [one.id, one.busy])).toEqual([['term_000001', true]])
    // Its old session went with the close: shown again, it attaches afresh, and the runtime sends what it kept.
    expect(store.sessionOf('term_000001')).not.toBe(was)
    expect(client.attachTerminal).toHaveBeenCalledTimes(2)
  })

  it('keeps a terminal closed where the runtime closed it, or had no such shell', async () => {
    const said = feed()
    const { client } = fakeClient({ listTerminals: vi.fn(async () => [shell({})]) })
    const store = makeFootStore(client, said, {}, 'proj_1')
    await waitFor(() => expect(store.get().terminals).toHaveLength(1))
    store.dismiss({ kind: 'terminal', id: 'term_000001' })
    await waitFor(() => expect(client.closeTerminal).toHaveBeenCalledWith('term_000001'))
    // A list said before the runtime closed it still names it: it stays closed here.
    said.say({ _tag: 'Terminals', projectId: 'proj_1', terminals: [shell({})] })
    expect(store.get()).toMatchObject({ terminals: [], problem: null })
    said.say({ _tag: 'Terminals', projectId: 'proj_1', terminals: [] })
    expect(store.get()).toMatchObject({ terminals: [], problem: null })
  })

  it('stops a running run and clears one that ended, at once, and brings one back with a line where the runtime said no', async () => {
    const said = feed()
    const { client } = fakeClient({
      stopLaunch: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: 'It had already stopped.' }))),
    })
    const store = makeFootStore(client, said, {}, 'proj_1')
    said.say({ _tag: 'Launches', projectId: 'proj_1', launches: [launch({}), launch({ id: 'launch_sb', ended: { at: 'x', code: 1 } })] })
    said.say({ _tag: 'Launches', projectId: 'other', launches: [] })
    expect(store.get().launches).toHaveLength(2)
    store.dismiss({ kind: 'run', id: 'launch_sb' })
    expect(client.clearLaunch).toHaveBeenCalledWith('launch_sb')
    store.dismiss({ kind: 'run', id: 'launch_ios' })
    expect(store.get().launches).toEqual([])
    expect(client.stopLaunch).toHaveBeenCalledWith('launch_ios')
    await waitFor(() => expect(store.get().problem).toBe('It had already stopped.'))
    expect(store.get().launches.map((one) => one.id)).toEqual(['launch_ios'])
  })

  it('raises what is pressed, and lowers it pressed again', () => {
    const store = makeFootStore(fakeClient().client, feed(), {}, 'proj_1')
    store.press({ kind: 'run', id: 'launch_ios' })
    expect(store.get()).toMatchObject({ raised: true, chosen: { kind: 'run', id: 'launch_ios' } })
    store.press({ kind: 'run', id: 'launch_ios' })
    expect(store.get().raised).toBe(false)
    store.setHeight(420)
    expect(store.get().height).toBe(420)
  })

  it('Ctrl+` opens a terminal, raises the last one, and lowers it; with Shift, a new one always', async () => {
    const { client } = fakeClient({ listTerminals: vi.fn(async () => [shell({})]) })
    const store = makeFootStore(client, feed(), {}, 'proj_1')
    await waitFor(() => expect(store.get().terminals).toHaveLength(1))
    toggleTerminal(store, { taskId: null, where: 'althar' }, false)
    expect(store.get()).toMatchObject({ raised: true, chosen: { kind: 'terminal', id: 'term_000001' } })
    toggleTerminal(store, { taskId: null, where: 'althar' }, false)
    expect(store.get().raised).toBe(false)
    toggleTerminal(store, { taskId: null, where: 'althar' }, true)
    expect(store.get().terminals).toHaveLength(2)
  })
})

describe('terminals’ names', () => {
  it('names each by where it is, numbered where two are in the same place', () => {
    expect([
      ...terminalNames([
        { id: 'a', where: 'althar' },
        { id: 'b', where: 'A task' },
        { id: 'c', where: 'althar' },
      ]).values(),
    ]).toEqual(['althar', 'A task', 'althar 2'])
  })
})
