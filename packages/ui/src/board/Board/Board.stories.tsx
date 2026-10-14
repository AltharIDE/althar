import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { CALLS, NEXT, READY, RUNNING, SETTLED } from '../../fixtures/board'
import {
  CHANGE_PERMISSION,
  CHANGE_READY,
  CHANGE_RUNNING,
  CHANGE_RUNNING_PR,
  PLAIN_PICTURES,
  PLAIN_WORKING,
  REVIEW_DRAFTED,
  REVIEW_RUNNING,
} from '../../fixtures/kinds'
import { BoardLane, Outcome, Wait } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { AcceptCard } from '../AcceptCard/AcceptCard'
import { BoardCard } from '../BoardCard/BoardCard'
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

/* A row names its task by its title alone, as the desktop's board does. */
const UNNAMED = { task: () => '' }

/* The same board, every card one button with nothing to press, by its task's kind: an afternoon's mix. */
function Kinds() {
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={2}>
        <BoardList>
          <NextRow
            place={1}
            task=""
            text={UNNAMED}
            kind="Change"
            title="Push button leaves commits behind"
            wait={Wait.You}
            reason="Held. Starts when you say"
            onOpen={() => undefined}
          />
          <NextRow
            place={2}
            task=""
            text={UNNAMED}
            title="Release 0.4 from this Mac"
            wait={Wait.After}
            reason="Starts after the copy button merges"
            onOpen={() => undefined}
          />
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={4}>
        {[CHANGE_RUNNING, PLAIN_WORKING, REVIEW_RUNNING, CHANGE_RUNNING_PR].map((card) => (
          <BoardCard key={card.title} {...card} onOpen={() => undefined} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={4}>
        {[REVIEW_DRAFTED, PLAIN_PICTURES, CHANGE_PERMISSION, CHANGE_READY].map((card) => (
          <BoardCard key={card.title} {...card} onOpen={() => undefined} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Settled} count={3}>
        <BoardList>
          <SettledRow
            outcome={Outcome.Done}
            task=""
            text={UNNAMED}
            title="Where can each agent’s usage limits be read?"
            at="1h ago"
            onOpen={() => undefined}
          />
          <SettledRow
            outcome={Outcome.Merged}
            task=""
            text={UNNAMED}
            kind="Change"
            title="Let a long dictation scroll in the composer"
            meta="PR #1184 merged"
            at="2h ago"
            onOpen={() => undefined}
          />
          <SettledRow
            outcome={Outcome.Done}
            task=""
            text={UNNAMED}
            title="Release 0.3 from this Mac"
            at="2d ago"
            onOpen={() => undefined}
          />
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
/** Cards with nothing to press, by kind: a change, a review and plain tasks, in the lanes each reaches. */
export const ByKind: Story = {
  render: () => <Kinds />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    // Each card is one button, its title: nothing else on the board's cards is pressed.
    for (const article of c.getAllByRole('article')) await expect(within(article).getAllByRole('button')).toHaveLength(1)
    await expect(c.getByText('Ready to accept')).toBeInTheDocument()
  },
}

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
