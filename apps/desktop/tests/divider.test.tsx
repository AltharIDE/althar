import { act, fireEvent, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardTask } from '@althar/contracts'
import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { card, coordinatorSnapshot, fakeClient, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * The divider between the conversation and the board: a drag moves it and
 * draws nothing else again, neither the thread, however long, nor the board,
 * and keeps the width once the pointer lets go; within the window, by the
 * keys, and back as it was after a switch of room.
 */

const drawn = vi.hoisted(() => ({ thread: 0, board: 0 }))

vi.mock('../src/renderer/shared/ThreadBlocks', async (actual) => {
  const real = await actual<typeof import('../src/renderer/shared/ThreadBlocks')>()
  return {
    ...real,
    ThreadBlocks: (props: ComponentProps<typeof real.ThreadBlocks>) => {
      drawn.thread += 1
      return <real.ThreadBlocks {...props} />
    },
  }
})

vi.mock('../src/renderer/features/board/BoardView', async (actual) => {
  const real = await actual<typeof import('../src/renderer/features/board/BoardView')>()
  return {
    ...real,
    BoardView: (props: ComponentProps<typeof real.BoardView>) => {
      drawn.board += 1
      return <real.BoardView {...props} />
    },
  }
})

const settled = (n: number): BoardTask => ({
  ...card({ taskId: `t${n}`, threadId: `th${n}`, title: `Settled ${n}`, slug: `settled-${n}`, plan: null }),
  phase: 'settled',
  state: 'done',
  createdAt: '2026-10-01T09:00:00.000Z',
  settledAt: `2026-10-01T08:${String(n).padStart(2, '0')}:00.000Z`,
  changed: null,
  here: [],
})

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      room={Room.Both}
    />
  )
}

/** The conversation hidden, or shown again beside the board, by its toggle. */
const toggleConversation = () => fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))

const WINDOW = window.innerWidth
const widen = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  act(() => void window.dispatchEvent(new Event('resize')))
}

/** The project's Home, its conversation and board read: the divider, and the column it is the edge of. */
const open = async () => {
  const { client } = fakeClient({
    getCoordinator: vi.fn(async () =>
      coordinatorSnapshot({
        items: [items.you('Where does the ledger stand?'), items.says('| Task | Lane |\n| --- | --- |\n| Ledger | Running |')],
      }),
    ),
    getBoard: vi.fn(async () => ({ cursor: 3, tasks: [1, 2, 3].map(settled), calls: [], settledTotal: 3 })),
  })
  withServices(<Project />, client)
  await screen.findByText('Where does the ledger stand?')
  await screen.findByText('Settled 3')
  const divider = () => screen.getByRole('separator', { name: 'Width of the conversation' })
  return { divider, column: () => divider().parentElement as HTMLElement, width: () => Number(divider().getAttribute('aria-valuenow')) }
}

afterEach(() => {
  window.localStorage.removeItem('althar.both')
  vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { value: WINDOW, configurable: true })
})

describe('the divider between the conversation and the board', () => {
  it('moves the conversation’s edge on each move, draws neither the thread nor the board again, and keeps where it is let go', async () => {
    window.localStorage.setItem('althar.both', '500')
    const { divider: handle } = await open()
    const divider = handle()
    const column = divider.parentElement as HTMLElement
    expect(column.style.width).toBe('500px')
    const thread = drawn.thread
    const board = drawn.board

    fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 500 })
    // The column dragged is marked, so its thread lays out only what is on screen; nothing else in the page is.
    expect(column.hasAttribute('data-resizing')).toBe(true)
    expect(document.documentElement.hasAttribute('data-resizing')).toBe(false)
    for (const x of [480, 460, 440, 420]) {
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: x })
      expect(column.style.width).toBe(`${x}px`)
      expect(divider.getAttribute('aria-valuenow')).toBe(String(x))
    }
    expect(window.localStorage.getItem('althar.both')).toBe('500')
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 420 })

    expect(column.hasAttribute('data-resizing')).toBe(false)
    expect(drawn.thread - thread).toBe(0)
    expect(drawn.board - board).toBe(0)
    expect(window.localStorage.getItem('althar.both')).toBe('420')
    // Set on the column itself: a custom property there would have every element of the thread's style worked out again.
    expect(column.style.getPropertyValue('--talk-width')).toBe('')
  })

  it('goes no wider than leaves the board its room, and the window narrowing takes it in', async () => {
    widen(1400)
    window.localStorage.setItem('althar.both', '800')
    const { divider, column, width } = await open()
    // 1400 wide, the board keeps 480 of it.
    expect(divider().getAttribute('aria-valuemax')).toBe('920')
    fireEvent.pointerDown(divider(), { pointerId: 1, button: 0, clientX: 800 })
    fireEvent.pointerMove(divider(), { pointerId: 1, clientX: 1300 })
    expect(width()).toBe(920)
    fireEvent.pointerMove(divider(), { pointerId: 1, clientX: 0 })
    expect(width()).toBe(340)
    fireEvent.pointerUp(divider(), { pointerId: 1, clientX: 0 })
    expect(window.localStorage.getItem('althar.both')).toBe('340')

    window.localStorage.setItem('althar.both', '900')
    fireEvent.keyDown(divider(), { key: 'End' })
    expect(width()).toBe(920)
    widen(1100)
    expect(width()).toBe(620)
    expect(column().style.width).toBe('620px')
    expect(divider().getAttribute('aria-valuemax')).toBe('620')
  })

  it('moves a step by the arrow keys, to its ends by Home and End, and back to where it starts by a double click, kept each time', async () => {
    widen(1400)
    window.localStorage.setItem('althar.both', '500')
    const { divider, width } = await open()
    const kept = () => window.localStorage.getItem('althar.both')
    fireEvent.keyDown(divider(), { key: 'ArrowRight' })
    expect([width(), kept()]).toEqual([516, '516'])
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    expect([width(), kept()]).toEqual([484, '484'])
    fireEvent.keyDown(divider(), { key: 'Home' })
    expect([width(), kept()]).toEqual([340, '340'])
    fireEvent.keyDown(divider(), { key: 'End' })
    expect([width(), kept()]).toEqual([920, '920'])
    fireEvent.doubleClick(divider())
    expect([width(), kept()]).toEqual([560, '560'])
  })

  it('is as it was left after the conversation is hidden and shown again, where storage won’t keep it too', async () => {
    widen(1400)
    window.localStorage.setItem('althar.both', '500')
    const refused = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage refused')
    })
    const { divider, width } = await open()
    fireEvent.pointerDown(divider(), { pointerId: 1, button: 0, clientX: 500 })
    fireEvent.pointerMove(divider(), { pointerId: 1, clientX: 420 })
    fireEvent.pointerUp(divider(), { pointerId: 1, clientX: 420 })
    expect(width()).toBe(420)
    toggleConversation()
    expect(screen.queryByRole('separator', { name: 'Width of the conversation' })).toBeNull()
    toggleConversation()
    expect(width()).toBe(420)

    // Taken by storage again, it is storage's once more.
    refused.mockRestore()
    fireEvent.doubleClick(divider())
    window.localStorage.setItem('althar.both', '600')
    toggleConversation()
    toggleConversation()
    expect(width()).toBe(600)
  })
})
