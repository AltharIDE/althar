import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Wait } from '../../foundations/vocabulary'
import { laneDecorator } from '../../storybook/lane'
import { NextRow } from '../NextRow/NextRow'
import { NextLine } from './NextLine'

const LINE = [
  { id: '431', title: 'Shorten long commands in running pills' },
  { id: '432', title: 'Stop the page jumping after answering a question' },
  { id: '433', title: 'Review ninemate’s pull request #88' },
]

const inLine = (place: number) => {
  if (place === 1) return 'Next in line'
  const suffix = place % 10 === 2 && place % 100 !== 12 ? 'nd' : place % 10 === 3 && place % 100 !== 13 ? 'rd' : 'th'
  return `${place}${suffix} in line`
}

/** The line, kept in the story's own state as the board keeps it in the runtime's. */
function Line({ rows, onMove }: { rows: typeof LINE; onMove: (id: string, to: number) => void }) {
  const [order, setOrder] = useState(rows)
  return (
    <NextLine
      rows={order}
      render={(id, place) => {
        const row = order.find((one) => one.id === id)
        return (
          <NextRow place={place} task={id} title={row?.title ?? ''} wait={Wait.Workers} reason={inLine(place)} text={{ task: () => '' }} />
        )
      }}
      onMove={(id, to) => {
        onMove(id, to)
        setOrder((now) => {
          const it = now.find((one) => one.id === id)
          if (it === undefined) return now
          const others = now.filter((one) => one !== it)
          return [...others.slice(0, to), it, ...others.slice(to)]
        })
      }}
    />
  )
}

const meta = {
  title: 'Board/NextLine',
  component: Line,
  decorators: [laneDecorator],
  args: { rows: LINE, onMove: fn() },
} satisfies Meta<typeof Line>
export default meta
type Story = StoryObj<typeof meta>

/** The rows' titles, in the order they show. */
const order = (canvas: HTMLElement) => Array.from(canvas.querySelectorAll('li [title]'), (title) => title.getAttribute('title'))

/** Three waiting for a free agent, in the order they start: pointing at one shows its grip in the margin. */
export const Default: Story = {}

/** One alone has nothing to move: no grip. */
export const One: Story = {
  args: { rows: LINE.slice(0, 1) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /in the line$/ })).toBeNull()
  },
}

/** Without dragging: Enter on a grip opens its moves, and the line takes the one chosen. */
export const FromTheMenu: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: `Move ${LINE[2]?.title ?? ''} in the line` }).focus()
    await userEvent.keyboard('{Enter}')
    const menu = within(await within(document.body).findByRole('menu', { name: 'Move in the line' }))
    await expect(menu.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(menu.getByRole('menuitem', { name: 'Move to the front of the line' }))
    await expect(args.onMove).toHaveBeenCalledWith('433', 0)
    await waitFor(() => expect(order(canvasElement)).toEqual([LINE[2]?.title, LINE[0]?.title, LINE[1]?.title]))
    await expect(canvas.getAllByText(/in line$/).map((one) => one.textContent)).toEqual(['Next in line', '2nd in line', '3rd in line'])
  },
}

/** Dragged by its grip: the row lifts, the others make room, and it lands where it is let go. */
export const Dragging: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const grip = canvas.getByRole('button', { name: `Move ${LINE[0]?.title ?? ''} in the line` })
    const from = grip.getBoundingClientRect()
    const last = canvasElement.querySelectorAll('li')[2]?.getBoundingClientRect()
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: grip, coords: { clientX: from.left + 4, clientY: from.top + 4 } },
      { coords: { clientX: from.left + 4, clientY: from.top + 20 } },
      { coords: { clientX: from.left + 4, clientY: (last?.bottom ?? 0) - 4 } },
      { keys: '[/MouseLeft]' },
    ])
    await expect(args.onMove).toHaveBeenCalledWith('431', 2)
    await expect(order(canvasElement)).toEqual([LINE[1]?.title, LINE[2]?.title, LINE[0]?.title])
  },
}
