import { CallCard } from '../../../board/CallCard/CallCard'
import { Prose } from '../../../thread/Turn/Turn'
import { Phase } from '../model'
import { RunningCard } from '../parts/RunningCard'
import { WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH_SAID, ASKED, DUE, TASK } from '../world'
import { CheckpointLine } from './CheckpointLine'

/*
 * B. Inline, minimal. The lead says its approach in its own words, as it
 * would anyway, and the checkpoint is one quiet line after it: how many
 * things it is assuming, and when it carries on. Review opens the list. The
 * running card carries most of the signal.
 */

const noop = () => {}

export const draw: Draw =
  ({ assumptions, still, open }) =>
  (c, on) => {
    const line = (
      <CheckpointLine
        assumptions={assumptions}
        checkpoint={c}
        on={on}
        wait={WAIT}
        due={DUE}
        still={still}
        defaultOpen={open}
        also={c.phase === Phase.Asking || c.phase === Phase.Answered}
      />
    )
    const turn = (() => {
      if (c.phase === Phase.Looking) return null
      if (c.phase === Phase.Asking || c.phase === Phase.Answered)
        return <Asked answered={c.phase === Phase.Answered} onAnswer={on.answer} also={line} />
      return (
        <>
          <Prose>{APPROACH_SAID}</Prose>
          {line}
          {c.phase === Phase.Continued && <CarriesOn />}
        </>
      )
    })()
    return {
      running: <RunningCard {...TASK} checkpoint={c} assumptions={assumptions} wait={WAIT} due={DUE} still={still} onOpen={noop} />,
      yours: c.phase === Phase.Asking ? <CallCard {...ASKED.call} onOpen={noop} /> : undefined,
      thread: (
        <>
          <FirstStep />
          <Groundwork busy={c.phase === Phase.Looking}>{turn}</Groundwork>
        </>
      ),
    }
  }

export const NOTES = {
  empty: 'Nothing is added: the approach is in the lead’s own words, and the card goes from looking around to Implement.',
  one: 'Shown opened with Review. Closed, it is the same line as with three.',
  three: 'One line in the thread. The card on the board says the same, so it is seen from either.',
}
