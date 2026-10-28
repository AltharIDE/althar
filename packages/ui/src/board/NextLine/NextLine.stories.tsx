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

/** Rows of every height: a short title, a title that runs to two lines, and one with a fact at its foot. */
const MIXED = [
  { id: '441', title: 'Fix the typo' },
  {
    id: '442',
    title: 'Make the board’s lanes fold away on their own when nothing in them has changed for a while and the window is narrow',
    foot: 'Waits for 419 to merge',
  },
  { id: '443', title: 'Rename the Settled lane' },
  {
    id: '444',
    title: 'Stop the page jumping after answering a question, and keep the scroll where the person left it',
    foot: 'Started by Ada',
  },
  { id: '445', title: 'Bump the toolchain' },
]

/** Fourteen: more than a lane shows without scrolling. */
const MANY = Array.from({ length: 14 }, (_, i) => ({
  id: String(451 + i),
  title: i % 3 === 1 ? `Task ${451 + i}: a longer title, to run onto a second line in a lane this narrow` : `Task ${451 + i}`,
}))

type Entry = { id: string; title: string; foot?: string }

const inLine = (place: number) => {
  if (place === 1) return 'Next in line'
  const suffix = place % 10 === 2 && place % 100 !== 12 ? 'nd' : place % 10 === 3 && place % 100 !== 13 ? 'rd' : 'th'
  return `${place}${suffix} in line`
}

/**
 * The line, kept in the story's own state as the board keeps it in the
 * runtime's, in a lane `height` pixels tall that scrolls when it is given.
 */
function Line({ rows, onMove, height }: { rows: Entry[]; onMove: (id: string, to: number) => void; height?: number }) {
  const [order, setOrder] = useState(rows)
  const line = (
    <NextLine
      rows={order}
      render={(id, place) => {
        const row = order.find((one) => one.id === id)
        return (
          <NextRow
            place={place}
            task={id}
            title={row?.title ?? ''}
            wait={Wait.Workers}
            reason={inLine(place)}
            {...(row?.foot === undefined ? {} : { foot: row.foot })}
            text={{ task: () => '' }}
          />
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
  // The lane scrolls on its own, as the board's lanes do; the line itself is only the rows.
  return height === undefined ? line : <div style={{ height, overflowY: 'auto', padding: '0 20px' }}>{line}</div>
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

const rows = (canvas: HTMLElement) => Array.from(canvas.querySelectorAll('li'))
const lift = (li: HTMLElement | undefined) => Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(li?.style.transform ?? '')?.[1] ?? '0')
const middle = (li: HTMLElement | undefined) => {
  const box = li?.getBoundingClientRect()
  return { clientX: (box?.left ?? 0) + 120, clientY: (box?.top ?? 0) + (box?.height ?? 0) / 2 }
}

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

/** With the keys: ⌥⇧↓ on a row’s grip moves it a place, and the grip keeps the focus. */
export const FromTheKeys: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: `Move ${LINE[0]?.title ?? ''} in the line` }).focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}')
    await expect(args.onMove).toHaveBeenCalledWith('431', 1)
    await waitFor(() => expect(order(canvasElement)).toEqual([LINE[1]?.title, LINE[0]?.title, LINE[2]?.title]))
    await expect(canvas.getByRole('button', { name: `Move ${LINE[0]?.title ?? ''} in the line` })).toHaveFocus()
  },
}

/** Dragged by any part of the row: it follows the pointer, the others slide aside, and it settles where it is let go. */
export const Dragging: Story = {
  play: async ({ args, canvasElement }) => {
    const user = userEvent.setup()
    const [first, , last] = rows(canvasElement)
    const from = middle(first)
    const to = middle(last)
    await user.pointer([
      { keys: '[MouseLeft>]', target: first, coords: from },
      { coords: { ...from, clientY: from.clientY + 20 } },
      { coords: to },
    ])
    // Mid-drag the document keeps its order: the row is shifted by the pointer, and the rows it passed give way.
    await expect(order(canvasElement)).toEqual(LINE.map((one) => one.title))
    await expect(lift(first)).toBeCloseTo(to.clientY - from.clientY, 0)
    await expect(lift(rows(canvasElement)[1])).toBeLessThan(0)
    await user.pointer({ keys: '[/MouseLeft]' })
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('431', 2))
    await expect(order(canvasElement)).toEqual([LINE[1]?.title, LINE[2]?.title, LINE[0]?.title])
    await expect(canvasElement.querySelectorAll('li[style*="transform"]')).toHaveLength(0)
  },
}

/** Rows of every height: the others give way by the height of the one held, and it lands exactly in its place. */
export const DifferentHeights: Story = {
  args: { rows: MIXED },
  play: async ({ args, canvasElement }) => {
    const user = userEvent.setup()
    const [first, second, third] = rows(canvasElement)
    const height = first?.getBoundingClientRect().height ?? 0
    const from = middle(first)
    const past = middle(third)
    await user.pointer([
      { keys: '[MouseLeft>]', target: first, coords: from },
      { coords: { ...from, clientY: from.clientY + 12 } },
      { coords: past },
    ])
    // Each row it passed gives way by its own height, not by theirs.
    await expect(lift(second)).toBeCloseTo(-height, 0)
    await expect(lift(third)).toBeCloseTo(-height, 0)
    await user.pointer({ keys: '[/MouseLeft]' })
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('441', 2))
    await expect(order(canvasElement).slice(0, 3)).toEqual([MIXED[1]?.title, MIXED[2]?.title, MIXED[0]?.title])
  },
}

/** A long line in a lane that scrolls: held at the lane’s bottom edge, it scrolls on, the row held going with it. */
export const Scrolling: Story = {
  args: { rows: MANY, height: 360 },
  decorators: [(Story) => <div style={{ paddingBlock: 12 }}>{Story()}</div>],
  play: async ({ args, canvasElement }) => {
    const user = userEvent.setup()
    const lane = canvasElement.querySelector<HTMLElement>('div[style*="overflow"]')
    const first = rows(canvasElement)[0]
    const box = lane?.getBoundingClientRect()
    const from = middle(first)
    const edge = { clientX: from.clientX, clientY: (box?.bottom ?? 0) - 8 }
    await user.pointer([
      { keys: '[MouseLeft>]', target: first, coords: from },
      { coords: { ...from, clientY: from.clientY + 20 } },
      { coords: edge },
    ])
    await waitFor(() => expect(lane?.scrollTop ?? 0).toBeGreaterThan(60))
    // The row is still under the pointer, though the lane has moved.
    const held = first?.getBoundingClientRect()
    await expect(held?.bottom ?? 0).toBeGreaterThan((box?.bottom ?? 0) - 60)
    await waitFor(() => expect((lane?.scrollTop ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual((lane?.scrollHeight ?? 0) - 1), {
      timeout: 5000,
    })
    await user.pointer({ keys: '[/MouseLeft]' })
    await waitFor(() => expect(args.onMove).toHaveBeenCalledWith('451', 13))
  },
}
