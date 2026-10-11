import { CallCard } from '../../../board/CallCard/CallCard'
import { Prose } from '../../../thread/Turn/Turn'
import { Phase } from '../model'
import { RunningCard } from '../parts/RunningCard'
import { WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH_SAID, ASKED, BRIEF, DUE, TASK } from '../world'
import { Brief } from './Brief'

/*
 * D. On the brief. What the lead assumes is mostly a reading of what you
 * asked for, so it is shown on your words: the phrases it read into are
 * marked, and its readings sit under the brief at the head of the thread,
 * each with the words it reads, or the file it is about, and No.
 */

const noop = () => {}

export const draw: Draw =
  ({ assumptions, still }) =>
  (c, on) => {
    const asking = c.phase === Phase.Asking || c.phase === Phase.Answered
    const turn = (() => {
      if (c.phase === Phase.Looking) return null
      if (asking) return <Asked answered={c.phase === Phase.Answered} onAnswer={on.answer} />
      return (
        <>
          <Prose>{APPROACH_SAID}</Prose>
          {c.phase === Phase.Continued && <CarriesOn />}
        </>
      )
    })()
    return {
      running: <RunningCard {...TASK} checkpoint={c} assumptions={assumptions} wait={WAIT} due={DUE} still={still} onOpen={noop} />,
      yours: c.phase === Phase.Asking ? <CallCard {...ASKED.call} onOpen={noop} /> : undefined,
      thread: (
        <>
          <Brief
            task={TASK.task}
            brief={BRIEF}
            unread={c.phase === Phase.Looking}
            assumptions={assumptions}
            checkpoint={c}
            on={on}
            wait={WAIT}
            due={DUE}
            still={still}
            also={asking}
            /* while it waits, its readings are open on the brief; once it has carried on, they fold */
            defaultOpen={c.phase === Phase.Open || c.phase === Phase.Held || c.phase === Phase.Asking}
          />
          <FirstStep />
          <Groundwork busy={c.phase === Phase.Looking}>{turn}</Groundwork>
        </>
      ),
    }
  }

export const NOTES = {
  looking: 'Your words, unmarked: the lead hasn’t said how it reads them yet.',
  empty: 'Nothing is marked. The brief reads as you wrote it.',
  three: 'Two readings mark your words; the third is about a file, not the brief. Point at a reading to see its words.',
  ranOut: 'The marks stay on the brief; the readings fold to a line under it.',
  asking: 'The question is in the lead’s turn and in Needs you. What it also takes your words to mean stays marked above.',
}
