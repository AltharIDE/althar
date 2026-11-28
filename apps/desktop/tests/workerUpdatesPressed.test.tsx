import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HomeWorker, HomeWorkers } from '@althar/contracts'

import { keys } from '../src/renderer/data/reads'
import { useServices } from '../src/renderer/data/services'
import {
  forgetPressed,
  updateText,
  updatingWorkersOf,
  usePressed,
  useWorkerUpdates,
  withIntents,
} from '../src/renderer/shared/workerUpdates'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * An update pressed holds over the reads until one the home answered after
 * taking it says so: a read that went out before the home recorded it (the
 * poll, a refresh) can't put Update back, for each of several workers asked
 * at once; and a Cancel the home refused, as the update had started, says so
 * on it.
 */

const worker = (workerId: string, more: Partial<HomeWorker> = {}): HomeWorker => ({
  workerId,
  name: workerId,
  connected: true,
  busy: false,
  providers: ['codex'],
  projects: [],
  task: null,
  release: '0.2.2',
  updatesOnRequest: true,
  ...more,
})
const home = (...workers: HomeWorker[]): HomeWorkers => ({ enabled: true, workers })

/** Settled from outside: a read or a command the test answers when it likes. */
const later = <T,>() => {
  let settle: (value: T) => void = () => undefined
  let refuse: (error: Error) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    refuse = reject
  })
  return { promise, settle, refuse }
}

function Probe() {
  const { client } = useServices()
  const read = useQuery({ queryKey: keys.workers, queryFn: () => client.getWorkers(), staleTime: 0, retry: false })
  const pressed = usePressed()
  const updates = useWorkerUpdates()
  return (
    <div>
      {updatingWorkersOf(read.data ?? null, '0.3.0', pressed).map((one) => (
        <p key={one.id} data-testid={one.id}>
          {one.update?.state ?? 'none'}
          {one.update?.state === 'running' && one.update.note !== undefined ? `: ${one.update.note}` : ''}
        </p>
      ))}
      <button type="button" onClick={() => updates.update(['a', 'b'])}>
        Update both
      </button>
      <button type="button" onClick={() => updates.cancel('a')}>
        Cancel a
      </button>
      <button type="button" onClick={() => void read.refetch()}>
        Read
      </button>
    </div>
  )
}

const state = (id: string) => screen.getByTestId(id).textContent

beforeEach(() => act(() => forgetPressed()))

describe('what was pressed, over the reads', () => {
  it('lays an update asked over a read that doesn’t say it yet, and a Cancel over one that still does', () => {
    const read = home(worker('a'), worker('b', { update: { state: 'asked' } }), worker('c', { update: { state: 'started' } }))
    const laid = withIntents(
      read,
      new Map([
        ['a', 'update'],
        ['b', 'cancel'],
        ['c', 'cancel'],
      ] as const),
    )
    expect(laid?.workers.map((one) => one.update?.state)).toEqual(['asked', undefined, 'started'])
    expect(withIntents(read, new Map())).toBe(read)
  })

  it('keeps several workers asked through a read sent before the home recorded them, until fresh reads say so', async () => {
    const reads = [later<HomeWorkers>(), later<HomeWorkers>(), later<HomeWorkers>(), later<HomeWorkers>()]
    let call = 0
    const asks = { a: later<void>(), b: later<void>() }
    const { client } = fakeClient({
      getWorkers: vi.fn(() => (reads[call++] ?? later<HomeWorkers>()).promise),
      updateWorker: vi.fn((id: string) => asks[id as 'a' | 'b'].promise),
    })
    withServices(<Probe />, client)
    act(() => reads[0]?.settle(home(worker('a'), worker('b'))))
    await waitFor(() => expect(state('a')).toBe('offer'))

    await userEvent.click(screen.getByRole('button', { name: 'Update both' }))
    expect([state('a'), state('b')]).toEqual(['running', 'running'])
    // The poll goes out before the home has recorded either, and comes back saying neither: both stay asked.
    await userEvent.click(screen.getByRole('button', { name: 'Read' }))
    await act(async () => reads[1]?.settle(home(worker('a'), worker('b'))))
    expect([state('a'), state('b')]).toEqual(['running', 'running'])

    // The home took a's: a read sent after says it; b's still holds as pressed, though that read doesn't have it.
    await act(async () => asks.a.settle())
    await act(async () => reads[2]?.settle(home(worker('a', { update: { state: 'started' } }), worker('b'))))
    expect([state('a'), state('b')]).toEqual(['running', 'running'])
    await act(async () => asks.b.settle())
    await act(async () =>
      reads[3]?.settle(home(worker('a', { update: { state: 'started' } }), worker('b', { update: { state: 'started' } }))),
    )
    await waitFor(() => expect(client.getWorkers).toHaveBeenCalledTimes(4))
    expect([state('a'), state('b')]).toEqual(['running', 'running'])
  })

  it('says on the update under way that a Cancel came too late, where it was pressed', async () => {
    let read = home(
      worker('a', { busy: true, task: { taskId: 't', threadId: 'th', title: 'Payout export', project: 'P' }, update: { state: 'asked' } }),
    )
    const { client } = fakeClient({
      getWorkers: vi.fn(async () => read),
      cancelWorkerUpdate: vi.fn(async () => {
        // Its task ended and the home told it meanwhile.
        read = home(worker('a', { update: { state: 'started' } }))
        throw new Error('Its update has started already, or wasn’t asked for.')
      }),
    })
    withServices(<Probe />, client)
    await waitFor(() => expect(state('a')).toBe('afterTask'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel a' }))
    await waitFor(() => expect(state('a')).toBe(`running: ${updateText.cancelRefused}`))
  })
})
