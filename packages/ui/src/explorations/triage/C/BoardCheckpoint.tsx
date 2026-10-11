import { useId, useState } from 'react'

import { Button } from '../../../primitives/Button/Button'
import { Caret } from '../../../primitives/Fold/Fold'
import { Phase, type CheckpointActions } from '../model'
import { Assumptions } from '../parts/Assumptions'
import { useFocusAfterFold } from '../parts/focus'
import { RunningCard, runningCardText, type RunningCardProps } from '../parts/RunningCard'
import s from './BoardCheckpoint.module.css'

/*
 * C. The checkpoint on the board. The running card's phase line opens, in
 * the card, to what the lead assumes, with No on each and Hold and Continue
 * now, so a checkpoint is settled from the board without opening the task.
 * Several tasks at their checkpoints can be read down one lane. Once it has
 * carried on, the foot's note opens the same list.
 */

export interface BoardCheckpointText {
  review: string
  hold: string
  continueNow: string
  continue: string
}

export const boardCheckpointText: BoardCheckpointText = {
  review: 'Review',
  hold: 'Hold',
  continueNow: 'Continue now',
  continue: 'Continue',
}

export type BoardCheckpointProps = Omit<RunningCardProps, 'toggle' | 'tray' | 'marker'> & {
  on: CheckpointActions
  defaultOpen?: boolean
  text?: Partial<BoardCheckpointText>
}

export function BoardCheckpoint({ on, defaultOpen = false, text, ...card }: BoardCheckpointProps) {
  const t = { ...boardCheckpointText, ...text }
  const { checkpoint: c, assumptions } = card
  const [open, setOpen] = useState(defaultOpen)
  const tray = useId()
  const n = assumptions.length
  const checking = (c.phase === Phase.Open || c.phase === Phase.Held) && n > 0
  const after = (c.phase === Phase.Continued || c.phase === Phase.Answered) && n > 0
  const shown = (open || c.correcting !== undefined) && (checking || after)
  const held = c.phase === Phase.Held
  /* carrying on closes the card back to its size; focus goes to the note that opens it again */
  const note = useFocusAfterFold<HTMLButtonElement>(after)
  const go = () => {
    setOpen(false)
    on.go()
  }

  const corrected = Object.keys(c.corrections).length
  return (
    <RunningCard
      {...card}
      toggle={
        checking ? (
          <button type="button" className={s.toggle} aria-expanded={shown} aria-controls={tray} onClick={() => setOpen(!shown)}>
            {t.review}
            <Caret open={shown} />
          </button>
        ) : undefined
      }
      marker={
        after ? (
          <button ref={note} type="button" className={s.note} aria-expanded={shown} aria-controls={tray} onClick={() => setOpen(!shown)}>
            {c.phase === Phase.Answered && `${runningCardText.answered} · `}
            {runningCardText.assumed(n, corrected)}
            <Caret open={shown} />
          </button>
        ) : undefined
      }
      tray={
        shown ? (
          <div id={tray} className={s.tray}>
            <Assumptions assumptions={assumptions} checkpoint={c} on={on} numbered compact why={false} />
            {checking && (
              <div className={s.acts}>
                {!held && (
                  <Button size="small" variant="quiet" onClick={on.hold}>
                    {t.hold}
                  </Button>
                )}
                <Button size="small" onClick={go}>
                  {held ? t.continue : t.continueNow}
                </Button>
              </div>
            )}
          </div>
        ) : undefined
      }
    />
  )
}
