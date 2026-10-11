import { CallCard } from '../../../board/CallCard/CallCard'
import { Phase } from '../model'
import { RunningCard } from '../parts/RunningCard'
import { WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH, ASKED, DUE, TASK } from '../world'
import { AlsoCard, CheckpointCard } from './CheckpointCard'

/*
 * A. Plan-like card. The checkpoint is a card in the thread, drawn like the
 * plan card the coordinator shows before a task starts: approach, numbered
 * assumptions with No on each, the plan's clock with Hold and Continue now.
 * The running card says where it is and how long is left.
 */

const noop = () => {}

export const draw: Draw =
  ({ assumptions, still }) =>
  (c, on) => {
    const asking = c.phase === Phase.Asking || c.phase === Phase.Answered
    const card = (
      <CheckpointCard
        approach={APPROACH}
        assumptions={assumptions}
        checkpoint={c}
        on={on}
        step={TASK.steps[0] ?? ''}
        lead={TASK.lead}
        wait={WAIT}
        due={DUE}
        still={still}
      />
    )
    let turn = card
    if (c.phase === Phase.Looking) turn = <></>
    else if (asking)
      turn = (
        <Asked
          answered={c.phase === Phase.Answered}
          onAnswer={on.answer}
          also={c.phase === Phase.Asking ? <AlsoCard assumptions={assumptions} checkpoint={c} on={on} /> : card}
        />
      )
    return {
      running: <RunningCard {...TASK} checkpoint={c} assumptions={assumptions} wait={WAIT} due={DUE} still={still} onOpen={noop} />,
      yours: c.phase === Phase.Asking ? <CallCard {...ASKED.call} onOpen={noop} /> : undefined,
      thread: (
        <>
          <FirstStep />
          <Groundwork busy={c.phase === Phase.Looking}>
            {turn}
            {c.phase === Phase.Continued && <CarriesOn />}
          </Groundwork>
        </>
      ),
    }
  }

export const NOTES = {
  empty: 'No card at all: one quiet line, the same one a checkpoint folds to, so an empty one looks finished rather than blank.',
  three: 'The most visible of the four: a card with three rows and a clock, beside the plan card the coordinator already showed.',
}
