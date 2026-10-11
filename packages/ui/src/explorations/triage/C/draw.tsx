import { CallCard } from '../../../board/CallCard/CallCard'
import { Prose } from '../../../thread/Turn/Turn'
import { CheckpointLine } from '../B/CheckpointLine'
import { Phase } from '../model'
import { WAIT, type Draw } from '../parts/sheet'
import { Asked, CarriesOn, FirstStep, Groundwork } from '../parts/Threads'
import { APPROACH_SAID, ASKED, DUE, TASK } from '../world'
import { BoardCheckpoint } from './BoardCheckpoint'

/*
 * C. Board-first. The checkpoint lives mostly on the running card: its
 * phase line opens, in the card, to the assumptions with No on each, and
 * Hold and Continue now, so it is settled without opening the task. The
 * thread keeps B's quiet line, so it reads the same from inside.
 */

const noop = () => {}

export const draw: Draw =
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

export const NOTES = {
  three: 'Closed, the card is as tall as any running card. Review opens it in place.',
  correcting: 'Written on the board, in the card. The card grows while you write.',
  ranOut: 'The foot’s note opens what it assumed, on the card.',
  asking: 'A real question is not answered on the running card: it is a call, in Needs you, like every other.',
}
