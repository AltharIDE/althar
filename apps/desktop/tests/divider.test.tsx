import { fireEvent, screen } from '@testing-library/react'
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
 * and keeps the width once the pointer lets go.
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

afterEach(() => window.localStorage.removeItem('althar.both'))

describe('the divider between the conversation and the board', () => {
  it('moves the conversation’s edge on each move, draws neither the thread nor the board again, and keeps where it is let go', async () => {
    window.localStorage.setItem('althar.both', '500')
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
    const divider = screen.getByRole('separator', { name: 'Width of the conversation' })
    const column = divider.parentElement as HTMLElement
    expect(column.style.width).toBe('500px')
    const thread = drawn.thread
    const board = drawn.board

    fireEvent.pointerDown(divider, { pointerId: 1, button: 0, clientX: 500 })
    for (const x of [480, 460, 440, 420]) {
      fireEvent.pointerMove(divider, { pointerId: 1, clientX: x })
      expect(column.style.width).toBe(`${x}px`)
      expect(divider.getAttribute('aria-valuenow')).toBe(String(x))
    }
    expect(window.localStorage.getItem('althar.both')).toBe('500')
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 420 })

    expect(drawn.thread - thread).toBe(0)
    expect(drawn.board - board).toBe(0)
    expect(window.localStorage.getItem('althar.both')).toBe('420')
    // Set on the column itself: a custom property there would have every element of the thread's style worked out again.
    expect(column.style.getPropertyValue('--talk-width')).toBe('')
  })
})
