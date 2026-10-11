import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { AcceptCard } from '../../../board/AcceptCard/AcceptCard'
import { Board, BoardColumn, BoardList } from '../../../board/Board/Board'
import { CallCard } from '../../../board/CallCard/CallCard'
import { NextRow } from '../../../board/NextRow/NextRow'
import { SettledRow } from '../../../board/SettledRow/SettledRow'
import { WorkCard } from '../../../board/WorkCard/WorkCard'
import { CALLS, NEXT, READY, RUNNING, SETTLED } from '../../../fixtures/board'
import { BoardLane } from '../../../foundations/vocabulary'
import { Prose } from '../../../thread/Turn/Turn'
import { CheckpointLine } from '../B/CheckpointLine'
import { checkpoint, Phase, useCheckpoint, type Assumption, type Checkpoint } from '../model'
import { Moments } from '../parts/Moments'
import { Scheme } from '../parts/Scheme'
import { liveOf, momentsOf, WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH_SAID, ASKED, DUE, SECOND, TASK, THREE } from '../world'
import { BoardCheckpoint } from './BoardCheckpoint'

/*
 * C. Board-first. The checkpoint lives mostly on the running card: its
 * phase line opens, in the card, to the assumptions with No on each, and
 * Hold and Continue now, so it is settled without opening the task. The
 * thread keeps B's quiet line, so it reads the same from inside.
 */

const noop = () => {}

const draw: Draw =
  ({ assumptions, still, open }) =>
  (c, on) => {
    const asking = c.phase === Phase.Asking || c.phase === Phase.Answered
    const line = <CheckpointLine assumptions={assumptions} checkpoint={c} on={on} wait={WAIT} due={DUE} still={still} also={asking} />
    const turn = (() => {
      if (c.phase === Phase.Looking) return null
      if (asking) return <Asked answered={c.phase === Phase.Answered} onAnswer={on.answer} also={line} />
      return (
        <>
          <Prose>{APPROACH_SAID}</Prose>
          {line}
          {c.phase === Phase.Continued && <CarriesOn />}
        </>
      )
    })()
    return {
      running: (
        <BoardCheckpoint
          {...TASK}
          checkpoint={c}
          assumptions={assumptions}
          on={on}
          wait={WAIT}
          due={DUE}
          still={still}
          defaultOpen={open || c.correcting !== undefined || Object.keys(c.corrections).length > 0}
          onOpen={noop}
        />
      ),
      yours: c.phase === Phase.Asking ? <CallCard {...ASKED.call} onOpen={noop} /> : undefined,
      thread: (
        <>
          <FirstStep />
          <Groundwork busy={c.phase === Phase.Looking}>{turn}</Groundwork>
        </>
      ),
    }
  }

const NOTES = {
  three: 'Closed, the card is as tall as any running card. Review opens it in place.',
  correcting: 'Written on the board, in the card. The card grows while you write.',
  ranOut: 'The foot’s note opens what it assumed, on the card.',
  asking: 'A real question is not answered on the running card: it is a call, in Needs you, like every other.',
}

/** A task's card at its checkpoint, holding its own clock. */
function Live({ task, assumptions, start }: { task: typeof TASK; assumptions: readonly Assumption[]; start: Checkpoint }) {
  const [c, on] = useCheckpoint(start, true)
  return <BoardCheckpoint {...task} checkpoint={c} assumptions={assumptions} on={on} wait={WAIT} due={DUE} onOpen={noop} />
}

/** Meridian's board with two tasks at their checkpoints, among the rest of the work. */
function OnBoard({ dark = false }: { dark?: boolean }) {
  return (
    <Scheme dark={dark}>
      <div style={{ height: 720 }}>
        <Board label="Meridian’s work">
          <BoardColumn lane={BoardLane.Next} count={2}>
            <BoardList>
              {NEXT.slice(0, 2).map((x, i) => (
                <NextRow key={x.task} {...x} place={i + 1} onOpen={noop} />
              ))}
            </BoardList>
          </BoardColumn>
          <BoardColumn lane={BoardLane.Running} count={3}>
            <Live task={TASK} assumptions={THREE} start={checkpoint(Phase.Open, { left: WAIT })} />
            <Live task={SECOND} assumptions={SECOND.assumptions} start={checkpoint(Phase.Open, { left: 75 })} />
            {RUNNING[1] && <WorkCard {...RUNNING[1]} onOpen={noop} />}
          </BoardColumn>
          <BoardColumn lane={BoardLane.Yours} count={2}>
            {CALLS[0] && <CallCard {...CALLS[0]} onOpen={noop} />}
            <AcceptCard {...READY} onOpen={noop} />
          </BoardColumn>
          <BoardColumn lane={BoardLane.Settled} count={3}>
            <BoardList>
              {SETTLED.slice(0, 3).map((x) => (
                <SettledRow key={x.task} {...x} onOpen={noop} />
              ))}
            </BoardList>
          </BoardColumn>
        </Board>
      </div>
    </Scheme>
  )
}

const meta = {
  title: 'Explorations/Triage checkpoint/C · Board-first',
  parameters: { layout: 'padded', controls: { disable: true } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The clock runs: open it on the card, correct one, hold it, carry on; then answer the question. */
export const Try: Story = {
  render: () => <Moments moments={liveOf(draw)} live />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const live = within(c.getByRole('region', { name: 'Try it' }))
    const card = within(live.getByRole('button', { name: TASK.title }).closest('article') ?? document.body)
    await userEvent.click(card.getByRole('button', { name: /Review/ }))
    await userEvent.click(card.getByRole('button', { name: 'No, correct assumption 1' }))
    await userEvent.type(card.getByRole('textbox', { name: /instead/ }), 'Refunds get their own budget{Enter}')
    await expect(card.getByText('Checkpoint · 1 of 3 corrected')).toBeInTheDocument()
    await userEvent.click(card.getByRole('button', { name: 'Hold' }))
    await expect(card.getByText('Checkpoint · held by you')).toBeInTheDocument()
    await userEvent.click(card.getByRole('button', { name: 'Continue' }))
    await expect(card.getByRole('button', { name: /3 assumed · 1 corrected/ })).toHaveAttribute('aria-expanded', 'false')
  },
}

/** On Meridian's board, with two tasks at their checkpoints at once. */
export const OnTheBoard: Story = { render: () => <OnBoard /> }
export const OnTheBoardDark: Story = { render: () => <OnBoard dark /> }

/** Every moment, on paper. */
export const Light: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} /> }

/** Every moment, in the exploration's provisional dark. */
export const Dark: Story = { render: () => <Moments moments={momentsOf(draw, NOTES)} dark /> }
