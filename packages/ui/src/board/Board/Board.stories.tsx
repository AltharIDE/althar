import type { Meta, StoryObj } from '@storybook/react-vite'
import { type CSSProperties, useState } from 'react'
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
import { States, statesOn } from '../../storybook/States'
import { AcceptCard } from '../AcceptCard/AcceptCard'
import { BoardCard } from '../BoardCard/BoardCard'
import { CallCard } from '../CallCard/CallCard'
import { KeptRow } from '../KeptRow/KeptRow'
import { NextRow } from '../NextRow/NextRow'
import { SettledRow } from '../SettledRow/SettledRow'
import { SettleWays } from '../SettleWays/SettleWays'
import { WorkCard } from '../WorkCard/WorkCard'
import { Board, BoardColumn, type BoardFolds, BoardList, boardText } from './Board'

/* Meridian's board, with the one you open ringed, as it is while the dock shows it; with lanes collapsed where the person did. */
function Meridian({ empty = false, defaultFolds }: { empty?: boolean; defaultFolds?: BoardFolds }) {
  const [open, setOpen] = useState<string | null>(null)
  const next = empty ? [] : NEXT
  const running = empty ? [] : RUNNING
  const calls = empty ? [] : CALLS
  const settled = empty ? [] : SETTLED
  return (
    <Board label="Meridian’s work" {...(defaultFolds === undefined ? {} : { defaultFolds })}>
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

/*
 * Finished tasks that aren't changes, waiting on the person: Done and Keep for later in each card's corner, shown on
 * hover; what was kept named beside Settled in its head, and shown in its place once pressed.
 */
function Finishing() {
  const [shelf, setShelf] = useState('settled')
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={0} />
      <BoardColumn lane={BoardLane.Running} count={1}>
        <BoardCard {...PLAIN_WORKING} onOpen={() => undefined} />
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={2}>
        <BoardCard {...PLAIN_PICTURES} corner={<SettleWays onDone={() => undefined} onKeep={() => undefined} />} onOpen={() => undefined} />
        <BoardCard {...REVIEW_DRAFTED} corner={<SettleWays onKeep={() => undefined} />} onOpen={() => undefined} />
      </BoardColumn>
      <BoardColumn
        lane={BoardLane.Settled}
        count={2}
        shelves={{
          label: 'Settled or kept for later',
          value: shelf,
          onChange: setShelf,
          options: [
            { value: 'settled', label: 'Settled', count: 2 },
            { value: 'kept', label: 'Kept', count: 2, icon: 'pin' },
          ],
        }}
      >
        {shelf === 'kept' ? (
          <BoardList>
            <KeptRow
              title="Prototype: link cards that belong to their messages"
              at="kept 2d ago"
              onDone={() => undefined}
              onOpen={() => undefined}
            />
            <KeptRow
              title="Spike: can Althar read Codex’s rate limits"
              at="kept 5h ago"
              onDone={() => undefined}
              onOpen={() => undefined}
            />
          </BoardList>
        ) : (
          <BoardList>
            <SettledRow
              outcome={Outcome.Done}
              task=""
              text={UNNAMED}
              title="Release 0.3 from this Mac"
              at="2d ago"
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
          </BoardList>
        )}
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

/** Up next and Settled collapsed by the person: rails with their glyph, count and name, each the button that opens it. */
/** Finished work that isn't a change: Done and Keep for later on hover, and what was kept beside Settled in its head. */
export const Finished: Story = {
  render: () => <Finishing />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Kept 2' }))
    await expect(c.getByText('kept 2d ago')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Kept 2', pressed: true })).toBeInTheDocument()
  },
}

export const Collapsed: Story = { args: { defaultFolds: { collapsed: [BoardLane.Next, BoardLane.Settled], opened: [] } } }

/** The chevron a lane's head shows on hover collapses it, and its rail opens it again; the focus goes with it each way. */
export const Collapsing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Collapse Settled' }))
    const rail = c.getByRole('button', { name: `Expand Settled, ${SETTLED.length}` })
    await expect(rail).toHaveFocus()
    await expect(rail).toHaveAttribute('aria-expanded', 'false')
    await expect(c.queryByText(SETTLED[0]!.title)).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('button', { name: 'Collapse Settled' })).toHaveFocus()
    await expect(c.getByText(SETTLED[0]!.title)).toBeInTheDocument()
  },
}

/** Needs you can't be collapsed while something waits in it, even where the person collapsed it while it was empty: its chevron says why. */
export const NeedsYouStaysOpen: Story = {
  args: { defaultFolds: { collapsed: [BoardLane.Yours], opened: [] } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const chevron = c.getByRole('button', { name: boardText.stays })
    await expect(chevron).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(chevron)
    await expect(c.queryByRole('button', { name: /^Expand Needs you/ })).not.toBeInTheDocument()
    await expect(c.getByText(READY.title)).toBeInTheDocument()
  },
}

/** A window too narrow for four lanes: the board collapses Settled by itself, rather than scrolling sideways. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 880, height: '100%' }}>{Story()}</div>],
}

/** Beside the conversation, where lanes narrow to 186 px: Settled and Up next collapse, Running and Needs you keep the room. */
export const BesideTheConversation: Story = {
  decorators: [(Story) => <div style={{ width: 470, height: '100%', '--lane-min': '186px' } as CSSProperties}>{Story()}</div>],
}

/** A board of one lane, in a cell: collapsed where the person did. */
const OneLane = ({ lane, count, collapsed = false }: { lane: BoardLane; count: number; collapsed?: boolean }) => (
  <div style={{ height: 190 }}>
    <Board label="Meridian’s work" defaultFolds={{ collapsed: collapsed ? [lane] : [], opened: [] }}>
      <BoardColumn lane={lane} count={count} />
    </Board>
  </div>
)

export const AllStates: Story = {
  parameters: statesOn({ hover: 'header', focus: '[data-fold="collapse"]', pressed: 'header' }),
  render: () => (
    <States
      size="wide"
      cells={[
        ...Object.values(BoardLane).map((lane) => ({ state: `${lane}, empty`, node: <BoardColumn lane={lane} count={0} /> })),
        ...Object.values(BoardLane).map((lane) => ({
          state: `${lane}, collapsed`,
          // Needs you collapses only while nothing waits in it.
          node: <OneLane lane={lane} count={lane === BoardLane.Yours ? 0 : 3} collapsed />,
        })),
        { state: 'hover', node: <OneLane lane={BoardLane.Running} count={0} /> },
        { state: 'focus', node: <OneLane lane={BoardLane.Running} count={0} /> },
        { state: 'needs you, something waits, hover', force: 'hover', node: <OneLane lane={BoardLane.Yours} count={2} /> },
      ]}
    />
  ),
}
