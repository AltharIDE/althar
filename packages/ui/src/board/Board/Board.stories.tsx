import type { Meta, StoryObj } from '@storybook/react-vite'
import { type CSSProperties, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

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
import { BoardLane, Outcome, TaskStatus, Wait } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { States, statesOn } from '../../storybook/States'
import { AcceptCard } from '../AcceptCard/AcceptCard'
import { BoardCard } from '../BoardCard/BoardCard'
import { CallCard } from '../CallCard/CallCard'
import { KeptRow } from '../KeptRow/KeptRow'
import { NextLine } from '../NextLine/NextLine'
import { NextRow } from '../NextRow/NextRow'
import { SettledRow } from '../SettledRow/SettledRow'
import { SettleWays } from '../SettleWays/SettleWays'
import { WorkCard } from '../WorkCard/WorkCard'
import { Board, BoardColumn, BoardDivider, type BoardFolds, BoardList, boardText } from './Board'

/* Meridian's board, with the one you open ringed, as it is while the dock shows it; with lanes collapsed where the person did. */
function Meridian({
  empty = false,
  defaultFolds,
  onPointerLane,
}: {
  empty?: boolean
  defaultFolds?: BoardFolds
  onPointerLane?: (lane: BoardLane | null) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const next = empty ? [] : NEXT
  const running = empty ? [] : RUNNING
  const calls = empty ? [] : CALLS
  const settled = empty ? [] : SETTLED
  return (
    <Board
      label="Meridian’s work"
      {...(defaultFolds === undefined ? {} : { defaultFolds })}
      {...(onPointerLane === undefined ? {} : { onPointerLane })}
    >
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

const BUSY = '6 of 6 agents busy on this Mac'

/* The line on a busy machine: new work, in the person's order. */
const LINE = [
  { id: 'l1', title: 'Shorten long commands in running pills' },
  { id: 'l2', title: 'Review ninemate’s pull request #88', kind: 'Review' },
]

const inLine = (place: number) => (place === 3 ? '3rd in line' : `${place}th in line`)

/*
 * Up next on a busy machine, in the order its work goes on: first what is
 * under way and continues, which isn't dragged; then the line, the person's
 * to order; then what is paused, and a plan on its countdown. Running holds
 * only what an agent works on now.
 */
function BusyUpNext() {
  const [line, setLine] = useState(LINE)
  const continuing = 2
  return (
    <Board label="Meridian’s work">
      <BoardColumn lane={BoardLane.Next} count={continuing + line.length + 2}>
        <BoardList>
          <NextRow
            place={1}
            task=""
            text={UNNAMED}
            kind="Change"
            continues="Follow-up"
            title="Plan usage: every agent, steer work, and prototypes"
            wait={Wait.Workers}
            reason={BUSY}
            onOpen={() => undefined}
          />
          <NextRow
            place={2}
            task=""
            text={UNNAMED}
            kind="Change"
            continues="Implement"
            title="Fix the failing CI"
            wait={Wait.Workers}
            reason={BUSY}
            onOpen={() => undefined}
          />
        </BoardList>
        <BoardDivider end={<button type="button">Back to oldest first</button>}>Starts when an agent is free</BoardDivider>
        <NextLine
          rows={line}
          render={(id, place) => {
            const row = line.find((one) => one.id === id)
            return (
              <NextRow
                place={continuing + place}
                task=""
                text={UNNAMED}
                {...(row?.kind === undefined ? {} : { kind: row.kind })}
                title={row?.title ?? ''}
                wait={Wait.Workers}
                reason={inLine(continuing + place)}
                onOpen={() => undefined}
              />
            )
          }}
          onMove={(id, to) =>
            setLine((now) => {
              const it = now.find((one) => one.id === id)
              if (it === undefined) return now
              const others = now.filter((one) => one !== it)
              return [...others.slice(0, to), it, ...others.slice(to)]
            })
          }
        />
        <BoardDivider>Paused</BoardDivider>
        <BoardList>
          <NextRow
            place={5}
            task=""
            text={UNNAMED}
            kind="Change"
            continues="Review"
            title="Stop the page jumping after answering a question"
            wait={Wait.Workers}
            reason="Codex is out of usage until 13:40"
            onOpen={() => undefined}
          />
        </BoardList>
        <BoardDivider>Planned</BoardDivider>
        <BoardList>
          <NextRow
            place={6}
            task=""
            text={UNNAMED}
            kind="Change"
            title="Add a retry"
            wait={Wait.Workers}
            reason="Starts in 20s"
            onOpen={() => undefined}
          />
        </BoardList>
      </BoardColumn>
      <BoardColumn lane={BoardLane.Running} count={2}>
        {[CHANGE_RUNNING, CHANGE_RUNNING_PR].map((card) => (
          <BoardCard key={card.title} {...card} onOpen={() => undefined} />
        ))}
      </BoardColumn>
      <BoardColumn lane={BoardLane.Yours} count={0} />
      <BoardColumn lane={BoardLane.Settled} count={0} />
    </Board>
  )
}

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

/* What moves on the board, a press each: a task starting, finishing and merged, one more up next, the line put in another order. */
interface Moved {
  readonly id: string
  readonly title: string
  readonly lane: BoardLane
}

const MOVING: ReadonlyArray<Moved> = [
  { id: 'm1', title: 'Shorten long commands in running pills', lane: BoardLane.Next },
  { id: 'm2', title: 'Keep the composer’s draft across restarts', lane: BoardLane.Next },
  { id: 'm3', title: 'Let a long dictation finish while you work', lane: BoardLane.Next },
  { id: 'm4', title: 'Find why the dock flickers on resize', lane: BoardLane.Running },
  { id: 'm5', title: 'Name the branch after the task', lane: BoardLane.Running },
  { id: 'm6', title: 'Fix the failing CI', lane: BoardLane.Yours },
  { id: 'm7', title: 'Plan usage: every agent, steer work, and prototypes', lane: BoardLane.Settled },
]

function MovingBoard() {
  const [tasks, setTasks] = useState(MOVING)
  const [made, setMade] = useState(0)
  const of = (lane: BoardLane) => tasks.filter((one) => one.lane === lane)
  // Into its new lane: at the foot, but Settled, where the latest is at the head.
  const send = (from: BoardLane, lane: BoardLane) =>
    setTasks((all) => {
      const task = all.find((one) => one.lane === from)
      if (task === undefined) return all
      const rest = all.filter((one) => one !== task)
      return lane === BoardLane.Settled ? [{ ...task, lane }, ...rest] : [...rest, { ...task, lane }]
    })
  const ways = [
    { label: 'Start the next', act: () => send(BoardLane.Next, BoardLane.Running) },
    { label: 'Finish one', act: () => send(BoardLane.Running, BoardLane.Yours) },
    { label: 'Merge one', act: () => send(BoardLane.Yours, BoardLane.Settled) },
    {
      label: 'Add one up next',
      act: () => {
        setMade(made + 1)
        setTasks((all) => [...all, { id: `new${made}`, title: `A new task, ${made + 1}`, lane: BoardLane.Next }])
      },
    },
    {
      label: 'Put the last up next first',
      act: () =>
        setTasks((all) => {
          const last = all.findLast((one) => one.lane === BoardLane.Next)
          return last === undefined ? all : [last, ...all.filter((one) => one !== last)]
        }),
    },
    {
      label: 'Clear one settled',
      act: () => setTasks((all) => all.filter((one) => one !== all.find((it) => it.lane === BoardLane.Settled))),
    },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
        {ways.map((way) => (
          <Button key={way.label} size="small" onClick={way.act}>
            {way.label}
          </Button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Board label="Meridian’s work">
          <BoardColumn lane={BoardLane.Next} count={of(BoardLane.Next).length}>
            {/* Its grip's menu, or ⌥⇧↑ and ⌥⇧↓ on it, moves a row in the line. */}
            <NextLine
              rows={of(BoardLane.Next)}
              render={(id, place) => (
                <NextRow
                  data-move={id}
                  place={place}
                  task=""
                  text={UNNAMED}
                  title={tasks.find((one) => one.id === id)?.title ?? ''}
                  wait={Wait.Workers}
                  reason="Starts when an agent is free"
                />
              )}
              onMove={(id, to) =>
                setTasks((all) => {
                  const task = all.find((one) => one.id === id)!
                  const line = of(BoardLane.Next).filter((one) => one !== task)
                  const rest = all.filter((one) => one.lane !== BoardLane.Next)
                  return [...line.slice(0, to), task, ...line.slice(to), ...rest]
                })
              }
            />
          </BoardColumn>
          <BoardColumn lane={BoardLane.Running} count={of(BoardLane.Running).length}>
            {of(BoardLane.Running).map((one) => (
              <BoardCard key={one.id} data-move={one.id} status={TaskStatus.Running} word="Implement" title={one.title} />
            ))}
          </BoardColumn>
          <BoardColumn lane={BoardLane.Yours} count={of(BoardLane.Yours).length}>
            {of(BoardLane.Yours).map((one) => (
              <BoardCard key={one.id} data-move={one.id} status={TaskStatus.Yours} word="Ready to accept" title={one.title} />
            ))}
          </BoardColumn>
          <BoardColumn lane={BoardLane.Settled} count={of(BoardLane.Settled).length}>
            <BoardList>
              {of(BoardLane.Settled).map((one) => (
                <SettledRow key={one.id} data-move={one.id} outcome={Outcome.Merged} task="" text={UNNAMED} title={one.title} at="now" />
              ))}
            </BoardList>
          </BoardColumn>
        </Board>
      </div>
    </div>
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

/**
 * Up next on a busy machine: what continues first, its rows with no grip,
 * then the line, which the person drags, then what is paused, and a plan.
 */
export const UpNextOnABusyMachine: Story = {
  render: () => <BusyUpNext />,
  play: async ({ canvasElement }) => {
    const next = within(within(canvasElement).getByRole('region', { name: 'Up next' }))
    await expect(next.getByText('Continues · Follow-up')).toBeInTheDocument()
    await expect(next.getByText('Continues · Implement')).toBeInTheDocument()
    await expect(next.getByText('Continues · Review')).toBeInTheDocument()
    // Only the line's rows have a grip: what continues keeps its order.
    await expect(next.getAllByRole('button', { name: /^Move .* in the line$/ })).toHaveLength(2)
    await expect(next.queryByRole('button', { name: /^Move Fix the failing CI/ })).not.toBeInTheDocument()
    await expect(next.getByText('3rd in line')).toBeInTheDocument()
  },
}

/** The board says which lane the pointer is in, so a consumer can keep a card from moving under it. */
export const PointingAtALane: Story = {
  args: { onPointerLane: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.hover(within(c.getByRole('region', { name: 'Up next' })).getByRole('heading'))
    await expect(args.onPointerLane).toHaveBeenLastCalledWith(BoardLane.Next)
    await userEvent.hover(within(c.getByRole('region', { name: 'Running' })).getByRole('heading'))
    await expect(args.onPointerLane).toHaveBeenLastCalledWith(BoardLane.Running)
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

/**
 * What moves, a press each: a card slides to its new place, travels to another
 * lane above the board, comes in and fades out (ListMotion); up next, a row's
 * grip moves it in the line. Nothing is pressed for you here, so each can be
 * watched.
 */
export const Moving: Story = { render: () => <MovingBoard /> }

/** Merged, a card ends in Settled; one more up next, and it is in the line; moved by key, a row takes its new place. */
export const MovingByAPress: Story = {
  render: () => <MovingBoard />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Merge one' }))
    const settled = canvasElement.querySelector<HTMLElement>(`[data-lane="${BoardLane.Settled}"]`)!
    await expect(within(settled).getByText('Fix the failing CI')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add one up next' }))
    await expect(c.getByText('A new task, 1')).toBeInTheDocument()
    // Moved by key on its grip, a row takes its new place in the line.
    c.getByRole('button', { name: 'Move Shorten long commands in running pills in the line' }).focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}')
    const next = canvasElement.querySelector<HTMLElement>(`[data-lane="${BoardLane.Next}"]`)!
    await expect([...next.querySelectorAll<HTMLElement>('[data-row]')].map((one) => one.dataset.row)).toEqual(['m2', 'm1', 'm3', 'new0'])
  },
}
