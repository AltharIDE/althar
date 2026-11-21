import { ApiError, type Launch, type ShownTerminal, type WatchEvent } from '@althar/contracts'
import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { terminalNames, toggleTerminal } from '../src/renderer/features/foot/Foot'
import { makeFootStore } from '../src/renderer/features/foot/store'
import { fakeClient } from './fixtures'

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
