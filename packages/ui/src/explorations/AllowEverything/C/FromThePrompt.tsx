import { Button } from '../../../primitives/Button/Button'
import { Popover, PopoverClose } from '../../../primitives/Popover/Popover'
import { MarkButton } from '../parts/Mark'
import type { Escalation } from '../parts/PromptCard'
import s from './FromThePrompt.module.css'

/*
 * Path C: no setting to find first. Where asking gets in the way, on the
 * card itself, one more answer allows the request and stops asking on the
 * task, with what it does said under it before you press: the requests
 * waiting behind it go too, and Never still holds. The task then says in
 * its bar that it allows everything, and since when, with Ask again; the
 * rules page lists it, and offers allowing everything as a mode, as now.
 */

export interface EscalationText {
  option: string
  /** What it does, by how many wait behind the card. */
  note: (waiting: number) => string
  submit: string
}

const allows = (waiting: number) => {
  if (waiting === 0) return 'Allows this'
  if (waiting === 1) return 'Allows this and the request waiting behind it'
  return `Allows this and the ${waiting} requests waiting behind it`
}

export const escalationText: EscalationText = {
  option: 'Yes, and stop asking on this task',
  note: (waiting) =>
    `${allows(waiting)}, and whatever this task asks after. Never still holds, and no agent reads your credentials or reaches the code host except through Althar.`,
  submit: 'Allow, and stop asking',
}

/** The card's answer beyond its own, for a card with `waiting` behind it. */
export const escalation = (waiting: number, text?: Partial<EscalationText>): Escalation => {
  const t = { ...escalationText, ...text }
  return { option: t.option, note: t.note(waiting), submit: t.submit }
}

export interface StoppedAskingText {
  word: string
  since: (at: string) => string
  label: string
  said: (at: string, what: string) => string
  fixed: string
  again: string
}

export const stoppedAskingText: StoppedAskingText = {
  word: 'Allows everything',
  since: (at) => `since ${at}`,
  label: 'This task allows everything',
  said: (at, what) => `You stopped asking on this task at ${at}, answering “${what}”. Whatever it asks goes ahead.`,
  fixed: 'Never still holds, and no agent reads your credentials or reaches the code host except through Althar.',
  again: 'Ask again',
}

export interface StoppedAskingProps {
  /** When you stopped asking: 11:52. */
  at: string
  /** The request you were answering, in its words. */
  what: string
  onAskAgain: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<StoppedAskingText>
}

/** In the task's bar once you stopped asking: that it allows everything, since when, and Ask again. */
export function StoppedAsking({ at, what, onAskAgain, open, onOpenChange, text }: StoppedAskingProps) {
  const t = { ...stoppedAskingText, ...text }
  return (
    <Popover
      label={t.label}
      align="end"
      width={320}
      open={open}
      onOpenChange={onOpenChange}
      trigger={<MarkButton word={t.word} detail={t.since(at)} strong />}
    >
      <p className={s.said}>{t.said(at, what)}</p>
      <p className={s.fixed}>{t.fixed}</p>
      <div className={s.foot}>
        <PopoverClose>
          <Button size="small" onClick={onAskAgain}>
            {t.again}
          </Button>
        </PopoverClose>
      </div>
    </Popover>
  )
}
