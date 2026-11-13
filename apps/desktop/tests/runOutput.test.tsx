import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServicesProvider } from '../src/renderer/data/services'
import { RunOf } from '../src/renderer/shared/RunOf'
import type { RunContent } from '../src/renderer/shared/thread'
import { fakeClient, NOW } from './fixtures'
import { servicesFor } from './render'

const run: RunContent = {
  launchId: 'proc_1',
  taskId: null,
  where: 'main',
  command: 'npm run dev',
  url: 'http://localhost:4173/',
  startedAt: NOW,
  ended: null,
}

const mount = (readLaunchOutput: ReturnType<typeof fakeClient>['client']['readLaunchOutput']) => {
  const { client } = fakeClient({ readLaunchOutput })
  const services = servicesFor(client)
  const show = (value: RunContent) => <RunOf run={value} onStop={vi.fn()} onRunAgain={vi.fn()} />
  const view = render(show(run), { wrapper: ({ children }) => <ServicesProvider value={services}>{children}</ServicesProvider> })
  return { end: (ended: NonNullable<RunContent['ended']>) => view.rerender(show({ ...run, ended })) }
}

afterEach(() => vi.useRealTimers())

describe('a run’s open console as it ends', () => {
  it.each([
    { code: 1, stopped: false, last: 'Error: final failure' },
    { code: 0, stopped: false, last: 'Final result' },
    { code: null, stopped: true, last: 'Final shutdown' },
  ])('reads the final snapshot on exit ($code, stopped $stopped), then stops polling', async ({ code, stopped, last }) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let text = 'Server ready\n'
    const read = vi.fn(async () => ({ text, dropped: 0 }))
    const view = mount(read)
    expect(read).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Output' }))
    const output = within(await screen.findByRole('dialog', { name: 'Output of npm run dev' }))
    expect(await output.findByText('Server ready')).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(1)

    // It prints and ends between polls, with the console still open.
    text += `${last}\n`
    view.end({ at: NOW, code, stopped, last })
    expect(await output.findByText(last)).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not read on exit with the console closed, and reads the final snapshot when reopened', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let text = 'Server ready\n'
    const read = vi.fn(async () => ({ text, dropped: 0 }))
    const view = mount(read)
    await userEvent.click(screen.getByRole('button', { name: 'Output' }))
    expect(await screen.findByText('Server ready')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    text += 'Final result\n'
    view.end({ at: NOW, code: 0, stopped: false, last: 'Final result' })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(read).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Output' }))
    expect(await screen.findByText('Final result')).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads the final snapshot even with a running poll in flight, and keeps it when that older poll arrives', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const pending = Promise.withResolvers<{ text: string; dropped: number }>()
    const read = vi
      .fn(async () => ({ text: 'Server ready\n', dropped: 0 }))
      .mockImplementationOnce(async () => ({ text: 'Server ready\n', dropped: 0 }))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ text: 'Server ready\nFinal result\n', dropped: 0 })
    const view = mount(read)
    await userEvent.click(screen.getByRole('button', { name: 'Output' }))
    expect(await screen.findByText('Server ready')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(read).toHaveBeenCalledTimes(2)
    view.end({ at: NOW, code: 0, stopped: false, last: 'Final result' })
    expect(await screen.findByText('Final result')).toBeTruthy()
    await act(async () => pending.resolve({ text: 'Server ready\nOld poll\n', dropped: 0 }))
    expect(screen.getByText('Final result')).toBeTruthy()
    expect(screen.queryByText('Old poll')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(read).toHaveBeenCalledTimes(3)
  })
})
