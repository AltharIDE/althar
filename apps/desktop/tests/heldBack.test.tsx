import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardSnapshot, type BoardTask, type Queued } from '@althar/contracts'

import { BoardView } from '../src/renderer/features/board/BoardView'
import { lanesOf } from '../src/renderer/features/board/lanes'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { atOnceWords, heldWhyWords, queuedOfWords, queuedWords } from '../src/renderer/shared/agents'
import { agents, card, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * While this computer's memory or CPU lets fewer agents work than the
 * person's number, Up next says which of its tasks are held back by it, until
 * what frees up, and how many may work of the number; each held one starts
 * anyway from its row, at once, and its own view says the same.
 */

const NOW = '2026-10-01T10:00:00.000Z'

/** One at work of the person's four, memory holding the rest back. */
const pace: Queued = { busy: 1, atOnce: 1, configured: 4 }
const held: Queued = { ...pace, held: 'memory' }

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const waiting = (taskId: string, place: number, queued: Queued, overrides: Partial<BoardTask> = {}) =>
  task({ taskId, threadId: `th-${taskId}`, title: `Waiting ${taskId}`, phase: 'running', queued, inLine: true, place, ...overrides })

/** A review going on and a task in line, both held back; one more in line, which would wait for an agent anyway. */
const board = (): BoardSnapshot => ({
  cursor: 3,
  tasks: [
    waiting('a', 1, held, {
      inLine: undefined,
      continues: true,
      step: 'review',
      startedAt: '2026-10-01T09:30:00.000Z',
      title: 'Going on a',
    }),
    waiting('b', 2, held),
    waiting('c', 3, pace),
    task({ taskId: 'w', threadId: 'th-w', title: 'At work', phase: 'running', step: 'implement', startedAt: '2026-10-01T09:00:00.000Z' }),
  ],
  calls: [],
  settledTotal: 0,
})

const region = (name: string) => within(screen.getByRole('region', { name }))
const rowOf = (title: string) => region('Up next').getByText(title).closest('article') as HTMLElement

describe('words for a task held back', () => {
  it('says it is held back until what frees up, not how many agents are busy, and why at length', () => {
    expect(queuedWords(pace)).toBe('Waiting · 1 agent busy')
    expect(queuedWords(held)).toBe('Held back until memory frees up')
    expect(queuedWords({ ...held, held: 'cpu' })).toBe('Held back until the CPU frees up')
    expect(heldWhyWords(pace)).toBeUndefined()
    expect(heldWhyWords(held, 'This Mac')).toBe('This Mac lets 1 agent work at a time, of your 4, until memory frees up.')
    expect(heldWhyWords({ busy: 2, atOnce: 2, held: 'cpu' }, 'This Mac')).toBe(
      'This Mac lets 2 agents work at a time, until the CPU frees up.',
    )
    expect(atOnceWords(held)).toBe('1 of 4 at a time')
    expect(atOnceWords({ busy: 1, atOnce: 1 })).toBe('1 at a time')
    expect(queuedOfWords(2, held)).toBe('2 waiting · held back until memory frees up')
    expect(queuedOfWords(1, pace)).toBe('Waiting · 1 agent busy')
  })
})

describe('Up next while tasks are held back', () => {
  const line = () => ({ move: vi.fn(async () => {}), oldestFirst: vi.fn(), cancelTurn: vi.fn(), startAnyway: vi.fn(), failed: null })

  it('heads the held rows with until when and how many may work, and the rest with that they wait anyway', async () => {
    const onPlaces = vi.fn()
    withServices(
      <BoardView lanes={lanesOf(board())} agents={agents} now={NOW} onOpen={vi.fn()} line={line()} onPlaces={onPlaces} />,
      fakeClient().client,
    )
    const lane = region('Up next')
    expect(lane.getByText('Held back until memory frees up')).toBeTruthy()
    // Its count opens this computer's load, where the bar shows it.
    await userEvent.click(lane.getByRole('button', { name: '1 of 4 at a time' }))
    expect(onPlaces).toHaveBeenCalled()
    // The heading over what waits anyway heads the row past those held back.
    const after = lane.getByText('Waiting for an agent to finish').closest('li') as HTMLElement
    expect(within(after).getByText('Waiting c')).toBeTruthy()
    // A row going on says its place, not one agent busy, which would read as room to spare under the number.
    expect(within(rowOf('Going on a')).getByText('Next in line')).toBeTruthy()
    expect(lane.queryByText('1 agent busy')).toBeNull()
  })

  it('says the count as words where the bar doesn’t show the load, and nothing at all while none is held back', () => {
    const { unmount } = withServices(
      <BoardView lanes={lanesOf(board())} agents={agents} now={NOW} onOpen={vi.fn()} line={line()} />,
      fakeClient().client,
    )
    expect(region('Up next').getByText('1 of 4 at a time')).toBeTruthy()
    expect(region('Up next').queryByRole('button', { name: '1 of 4 at a time' })).toBeNull()
    unmount()
    const calm = board()
    withServices(
      <BoardView
        lanes={lanesOf({ ...calm, tasks: calm.tasks.map((one) => (one.queued === null ? one : { ...one, queued: pace })) })}
        agents={agents}
        now={NOW}
        onOpen={vi.fn()}
        line={line()}
      />,
      fakeClient().client,
    )
    expect(screen.queryByText(/Held back/)).toBeNull()
    expect(screen.queryByText('Waiting for an agent to finish')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start anyway' })).toBeNull()
  })

  function Board() {
    const model = useBoard('p1')
    return model.board === null ? null : (
      <BoardView lanes={lanesOf(model.board)} agents={agents} now={NOW} onOpen={vi.fn()} line={model.line} />
    )
  }

  it('starts a held row anyway from its line: in Running at once, as the runtime starts it', async () => {
    let answer: (started: boolean) => void = () => {}
    const startAnyway = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()), startAnyway })
    withServices(<Board />, client)
    await userEvent.click(within(await waitFor(() => rowOf('Waiting b'))).getByRole('button', { name: 'Start anyway' }))
    expect(startAnyway).toHaveBeenCalledWith('b')
    // Before the runtime answers, it is at work and out of the line.
    expect(region('Running').getByText('Waiting b')).toBeTruthy()
    expect(region('Up next').queryByText('Waiting b')).toBeNull()
    await act(async () => answer(true))
    expect(region('Running').getByText('Waiting b')).toBeTruthy()
  })

  it('puts it back in line, saying why, where the runtime refuses it', async () => {
    const startAnyway = vi.fn(async () => Promise.reject(new ApiError({ reason: 'Restarting', message: 'The runtime is restarting.' })))
    const { client } = fakeClient({ getBoard: vi.fn(async () => board()), startAnyway })
    withServices(<Board />, client)
    await userEvent.click(within(await waitFor(() => rowOf('Waiting b'))).getByRole('button', { name: 'Start anyway' }))
    await waitFor(() => expect(region('Up next').getByText('Waiting b')).toBeTruthy())
    // Up next says why, at its top.
    expect(region('Up next').getByText('The runtime is restarting.')).toBeTruthy()
  })
})

describe('a held task’s own view', () => {
  function Task() {
    return <TaskView model={useTask('th1')} onBack={vi.fn()} />
  }

  it('says it is held back in its header and over its composer, and starts it anyway from there', async () => {
    const base = snapshot()
    // The runtime's answer, held: what shows before it is the press's own.
    const startAnyway = vi.fn(() => new Promise<boolean>(() => {}))
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ session: null, task: { ...base.task, queued: held, place: 1 } })),
      startAnyway,
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Held back until memory frees up')).toBeTruthy()
    const chip = screen.getByRole('button', { name: /^Held back, until memory frees up, First in Up next/ })
    await userEvent.click(chip)
    await userEvent.click(await screen.findByRole('button', { name: 'Start anyway' }))
    expect(startAnyway).toHaveBeenCalledWith('t1')
    // At once, it no longer says it is held back, nor offers to start.
    await waitFor(() => expect(screen.queryByText(/Held back/)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Start anyway' })).toBeNull()
  })
})
