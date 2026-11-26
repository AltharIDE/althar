import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ComputerState } from '@althar/runtime/computerBridge'

import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { ComputerUse } from '../src/renderer/features/task/ComputerUse'
import { fakeClient, fakeHost } from './fixtures'
import { servicesFor } from './render'

type Computer = NonNullable<Host['computer']>

const TASK = 'task_0123456789abcdef0123456789abcdef'
const OTHER = 'task_fedcba9876543210fedcba9876543210'
const REQUEST = '0b8e7c1e-5d4a-4f7a-9d1b-2c3e4f5a6b7c'
const WRITER = '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d'

const state = (overrides: Partial<ComputerState> = {}): ComputerState => ({
  taskId: TASK,
  threadId: 'thread_1',
  title: 'Verify the desktop report',
  phase: 'active',
  windows: [{ id: WRITER, app: 'Writer', title: 'Report' }],
  desktop: true,
  foreground: false,
  action: 'Using Writer.',
  ...overrides,
})

const picture = { data: 'iVBORw0KGgo=', mimeType: 'image/png' as const }

/** A session in main, as the window's bridge to it: its states as they stand, then each as it changes. */
const fakeComputer = (states: ReadonlyArray<ComputerState> | Promise<ReadonlyArray<ComputerState>> = []) => {
  const listeners = new Set<(next: ComputerState) => void>()
  const computer = {
    states: vi.fn(() => Promise.resolve(states)),
    allow: vi.fn(async () => true),
    control: vi.fn(async () => true),
    subscribe: vi.fn((listener: (next: ComputerState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  } satisfies Computer
  const push = (next: ComputerState) => act(() => listeners.forEach((listener) => listener(next)))
  return { computer, push, listening: () => listeners.size }
}

const shown = (computer: Computer | undefined, platform: Host['platform'] = 'darwin') => {
  const host = fakeHost({ platform, ...(computer === undefined ? {} : { computer }) })
  return render(
    <ServicesProvider value={servicesFor(fakeClient().client, host)}>
      <ComputerUse taskId={TASK} />
    </ServicesProvider>,
  )
}

const region = () => screen.findByRole('region', { name: 'Computer use' })

describe('computer use in a task', () => {
  it('shows nothing where this window has no computer, or the task no session', async () => {
    const none = shown(undefined)
    expect(none.container.innerHTML).toBe('')
    none.unmount()

    const fake = fakeComputer([state({ taskId: OTHER })])
    const other = shown(fake.computer)
    await waitFor(() => expect(fake.computer.states).toHaveBeenCalled())
    await act(async () => {})
    expect(other.container.innerHTML).toBe('')
    // Another task's session as it changes stays out of this one.
    fake.push(state({ taskId: OTHER, action: 'Using Reader.' }))
    expect(other.container.innerHTML).toBe('')
  })

  it('asks once, with its reason and the keys that stop it, and folds to the answer at once', async () => {
    const fake = fakeComputer([
      state({ phase: 'asking', action: 'Asking.', request: { id: REQUEST, primaryDisplay: true, reason: 'To move the note.' } }),
    ])
    shown(fake.computer)
    await region()
    expect(screen.getByText('To move the note.')).toBeTruthy()
    expect(screen.getByText(/see your screen/)).toBeTruthy()
    expect(screen.getByText('stops it')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Allow for this turn' }))
    expect(fake.computer.allow).toHaveBeenCalledWith(TASK, { requestId: REQUEST, allow: true })
    expect(await screen.findByText('Allowed for this turn')).toBeTruthy()

    // The session's next state takes its place.
    fake.push(state({ action: 'Using Writer in the foreground.' }))
    expect(await screen.findByText('Using Writer in the foreground.')).toBeTruthy()
    expect(screen.queryByText('Allowed for this turn')).toBeNull()
  })

  it('takes an answer back, with a line, where the session refuses it or can’t be reached', async () => {
    const fake = fakeComputer([state({ phase: 'asking', request: { id: REQUEST, primaryDisplay: false, reason: 'To move the note.' } })])
    fake.computer.allow.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('gone'))
    shown(fake.computer, 'linux')
    await region()
    expect(screen.queryByText(/see your screen/)).toBeNull()
    expect(screen.queryByText('stops it')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(fake.computer.allow).toHaveBeenCalledWith(TASK, { requestId: REQUEST, allow: false })
    expect(await screen.findByText('The computer session changed. Check its current state and try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Allow for this turn' }))
    expect(await screen.findByText('Althar could not reach the computer session.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow for this turn' })).toBeTruthy()
  })

  it('names its latest view by the window’s app, the display, or the task where it knows no window', async () => {
    const fake = fakeComputer([state({ preview: { target: WRITER, picture } })])
    shown(fake.computer)
    expect(await screen.findByText('Latest view of Writer')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Latest view of Writer' }).getAttribute('src')).toBe(`data:image/png;base64,${picture.data}`)

    fake.push(state({ preview: { target: 'desktop', picture } }))
    expect(await screen.findByText('Latest view of the primary display')).toBeTruthy()

    fake.push(state({ windows: [], preview: { target: WRITER, picture } }))
    expect(await screen.findByText('Latest view of Verify the desktop report')).toBeTruthy()
  })

  it('takes over, resumes and stops at once, and goes back with a line where the session refuses', async () => {
    const fake = fakeComputer([state({ preview: { target: WRITER, picture } })])
    shown(fake.computer)
    await screen.findByText('Using Writer.')

    await userEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(fake.computer.control).toHaveBeenCalledWith(TASK, 'pause')
    expect(screen.getByText('Taking over…')).toBeTruthy()
    expect(screen.queryByText('Latest view of Writer')).toBeNull()

    fake.push(state({ phase: 'paused', action: 'You have it.' }))
    expect(await screen.findByText('You have it.')).toBeTruthy()
    fake.computer.control.mockResolvedValueOnce(false)
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(fake.computer.control).toHaveBeenCalledWith(TASK, 'resume')
    // Refused: back to where it stood, saying so.
    expect(await screen.findByText('The computer session changed. Check its current state and try again.')).toBeTruthy()
    expect(screen.getByText('You have it.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: /^Stop/ }))
    expect(fake.computer.control).toHaveBeenCalledWith(TASK, 'stop')
    expect(screen.getByText('Stopping…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    fake.push(state({ phase: 'stopped', action: 'Stopped by you.' }))
    expect(await screen.findByText('Stopped by you.')).toBeTruthy()
  })

  it('keeps what the session said since over a stale press it refused', async () => {
    let refuse: (taken: boolean) => void = () => {}
    const fake = fakeComputer([state()])
    fake.computer.control.mockImplementationOnce(() => new Promise<boolean>((resolve) => (refuse = resolve)))
    shown(fake.computer)
    await screen.findByText('Using Writer.')
    await userEvent.click(screen.getByRole('button', { name: /^Stop/ }))
    fake.push(state({ phase: 'paused', action: 'You have it.' }))
    await act(async () => refuse(false))
    expect(screen.getByText('You have it.')).toBeTruthy()
  })

  it('takes a session’s change over the states it read before, and stops listening once gone', async () => {
    let read: (states: ReadonlyArray<ComputerState>) => void = () => {}
    const fake = fakeComputer(new Promise((resolve) => (read = resolve)))
    const view = shown(fake.computer)
    fake.push(state({ action: 'Using Reader.' }))
    expect(await screen.findByText('Using Reader.')).toBeTruthy()
    await act(async () => read([state({ action: 'Using Writer.' })]))
    expect(screen.getByText('Using Reader.')).toBeTruthy()

    view.unmount()
    expect(fake.listening()).toBe(0)
  })

  it('shows nothing where its states can’t be read, or arrive once it is gone', async () => {
    const failing = fakeComputer()
    failing.computer.states.mockRejectedValueOnce(new Error('gone'))
    const broken = shown(failing.computer)
    await act(async () => {})
    expect(broken.container.innerHTML).toBe('')
    broken.unmount()

    let read: (states: ReadonlyArray<ComputerState>) => void = () => {}
    const late = fakeComputer(new Promise((resolve) => (read = resolve)))
    const gone = shown(late.computer)
    gone.unmount()
    await act(async () => read([state()]))
    expect(late.listening()).toBe(0)
  })
})
