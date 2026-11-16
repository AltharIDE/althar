import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadSnapshot } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { fakeClient, snapshot, streamed } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * What a word typed, a word streamed or a second ticking draws again: the
 * composer it is typed in, the thread it streams in, what says the time; not
 * the screen around them, and nothing measures the page to see what moved
 * (docs/decisions/foundations.md, "The UI is instant", rule 6). Counted by
 * how often the board, a task's thread and the composer are drawn, and what
 * reads the moving items.
 */

const drawn = vi.hoisted(() => ({ board: 0, thread: 0, composer: 0 }))

vi.mock('../src/renderer/features/board/BoardView', async (load) => {
  const real = await load<typeof import('../src/renderer/features/board/BoardView')>()
  return {
    ...real,
    BoardView: (props: Parameters<typeof real.BoardView>[0]) => {
      drawn.board += 1
      return real.BoardView(props)
    },
  }
})

vi.mock('../src/renderer/shared/DraftComposer', async (load) => {
  const real = await load<typeof import('../src/renderer/shared/DraftComposer')>()
  return {
    ...real,
    DraftComposer: (props: Parameters<typeof real.DraftComposer>[0]) => {
      drawn.composer += 1
      return real.DraftComposer(props)
    },
  }
})

vi.mock('../src/renderer/features/task/TaskThread', async (load) => {
  const real = await load<typeof import('../src/renderer/features/task/TaskThread')>()
  return {
    ...real,
    TaskThread: (props: Parameters<typeof real.TaskThread>[0]) => {
      drawn.thread += 1
      return real.TaskThread(props)
    },
  }
})

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
    />
  )
}

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

/** How often, from now on, something reads where the moving items stand (ListMotion), as a browser that animates does. */
const measuring = () => {
  const found = vi.spyOn(Element.prototype, 'querySelectorAll')
  return () => found.mock.calls.filter(([selector]) => selector === '[data-move]').length
}

beforeEach(() => {
  drawn.board = 0
  drawn.thread = 0
  drawn.composer = 0
  // As in a browser, which animates: ListMotion takes where its items stand only then.
  Object.defineProperty(Element.prototype, 'animate', {
    value: () => ({ addEventListener: () => {}, cancel: () => {} }),
    configurable: true,
  })
})

afterEach(() => {
  delete (Element.prototype as Partial<Element>).animate
  vi.restoreAllMocks()
})

describe('a word typed', () => {
  it('in the coordinator’s composer draws the composer, not the board, and measures nothing', async () => {
    const { client } = fakeClient()
    withServices(<Project />, client)
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell the coordinator something' })
    await waitFor(() => expect(drawn.board).toBeGreaterThan(0))
    const board = drawn.board
    const measured = measuring()
    await userEvent.type(box, 'Plan the release')
    expect(box.value).toBe('Plan the release')
    expect(drawn.board).toBe(board)
    expect(measured()).toBe(0)
  })

  it('in a task’s composer draws the composer, not its thread, and measures nothing', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    withServices(<Task />, client)
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /^Tell .* something$/ })
    await waitFor(() => expect(drawn.thread).toBeGreaterThan(0))
    const thread = drawn.thread
    const measured = measuring()
    await userEvent.type(box, 'Add a retry')
    expect(box.value).toBe('Add a retry')
    expect(drawn.thread).toBe(thread)
    expect(measured()).toBe(0)
  })
})

describe('a word streamed', () => {
  it('on the coordinator’s thread draws the thread, not the board or the composer', async () => {
    const { client, emit } = fakeClient()
    withServices(<Project />, client)
    await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    await waitFor(() => expect(drawn.board).toBeGreaterThan(0))
    const { board, composer } = drawn
    const measured = measuring()
    for (const words of ['Planning', 'Planning the', 'Planning the release'])
      act(() => {
        emit(streamed('m1', words, 'thc'))
      })
    expect(await screen.findByText('Planning the release')).toBeTruthy()
    expect(drawn.board).toBe(board)
    expect(drawn.composer).toBe(composer)
    expect(measured()).toBe(0)
  })

  it('in a task draws its rounds, not its composer', async () => {
    const { client, emit } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    withServices(<Task />, client)
    await screen.findByRole('textbox', { name: /^Tell .* something$/ })
    await waitFor(() => expect(drawn.thread).toBeGreaterThan(0))
    const { thread, composer } = drawn
    for (const words of ['Adding', 'Adding a', 'Adding a retry'])
      act(() => {
        emit(streamed('m1', words))
      })
    expect(await screen.findByText('Adding a retry')).toBeTruthy()
    expect(drawn.thread).toBeGreaterThan(thread)
    expect(drawn.composer).toBe(composer)
  })
})

describe('a second ticking', () => {
  it('in a task at work draws what says the time, not its composer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const base = snapshot()
      const working: ThreadSnapshot = {
        ...base,
        task: { ...base.task, phase: 'running', startedAt: new Date().toISOString() },
        session: base.session === null ? null : { ...base.session, turnRunning: true, turnStartedAt: new Date().toISOString() },
      }
      const { client } = fakeClient({ getThread: vi.fn(async () => working) })
      withServices(<Task />, client)
      // At work, its composer adds to the queue.
      await screen.findByRole('textbox', { name: /interrupt the lead/ })
      await waitFor(() => expect(drawn.thread).toBeGreaterThan(0))
      const { thread, composer } = drawn
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })
      expect(drawn.thread).toBeGreaterThan(thread)
      expect(drawn.composer).toBe(composer)
    } finally {
      vi.useRealTimers()
    }
  })
})
