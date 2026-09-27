import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { CALLS, NEXT, READY, RUNNING, SETTLED } from '../../fixtures/board'
import { BoardLane } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { AcceptCard } from '../AcceptCard/AcceptCard'
import { CallCard } from '../CallCard/CallCard'
import { NextRow } from '../NextRow/NextRow'
import { SettledRow } from '../SettledRow/SettledRow'
import { WorkCard } from '../WorkCard/WorkCard'
import { Board, BoardColumn, BoardList } from './Board'

/* Meridian's board, with the one you open ringed, as it is while the dock shows it. */
function Meridian({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const next = empty ? [] : NEXT
  const running = empty ? [] : RUNNING
  const calls = empty ? [] : CALLS
  const settled = empty ? [] : SETTLED
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={next.length}>
        <BoardList>
          {next.map((x, i) => (
            <NextRow key={x.task} {...x} place={i + 1} current={open === x.task} onOpen={() => setOpen(x.task)} />
          ))}
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={running.length}>
        {running.map((x) => (
          <WorkCard key={x.task} {...x} current={open === x.task} onOpen={() => setOpen(x.task)} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={empty ? 0 : calls.length + 1}>
        {calls.map((x) => (
          <CallCard key={x.title} {...x} current={open === x.title} onOpen={() => setOpen(x.title)} />
        ))}
        {!empty && <AcceptCard {...READY} current={open === READY.task} onOpen={() => setOpen(READY.task)} />}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Settled} count={settled.length}>
        <BoardList>
          {settled.map((x) => (
            <SettledRow key={x.task} {...x} current={open === `s${x.task}`} onOpen={() => setOpen(`s${x.task}`)} />
          ))}
        </BoardList>
      </BoardColumn>
    </Board>
  )
}

const meta = {
  title: 'Board/Board',
  component: Meridian,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: '100vh' }}>{Story()}</div>],
} satisfies Meta<typeof Meridian>
export default meta
type Story = StoryObj<typeof meta>

/** A project's work in four lanes, in the order it moves. */
export const Default: Story = {}
/** A new project: every lane says it is empty. */
export const Empty: Story = { args: { empty: true } }

/** Opening a card rings it, as the dock beside the board shows it. */
export const OpeningACard: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const title = RUNNING[0]!.title
    await userEvent.click(c.getByRole('button', { name: title }))
    await expect(c.getByRole('button', { name: title }).closest('article')).toHaveAttribute('aria-current', 'true')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={Object.values(BoardLane).flatMap((lane) => [{ state: `${lane}, empty`, node: <BoardColumn lane={lane} count={0} /> }])}
    />
  ),
}
