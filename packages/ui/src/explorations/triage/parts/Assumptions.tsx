import { cx } from '../../../lib/cx'
import { useRefocus } from '../../../lib/refocus'
import { ActionButton } from '../../../primitives/ActionButton/ActionButton'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { NoteForm } from '../../../primitives/NoteForm/NoteForm'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { Phase, type Assumption, type Checkpoint, type CheckpointActions } from '../model'
import s from './Assumptions.module.css'

/*
 * What the lead is assuming, each with a way to say no. No opens a line to
 * write what it should take instead, in place, and the clock waits while it
 * is open. Sent, the assumption stays, struck, with what you said under it,
 * and Undo until the lead carries on. After that a correction still goes,
 * as a message to the lead, and stays.
 */

export interface AssumptionsText {
  label: string
  no: string
  /** After No, for a screen reader: which one it corrects. */
  noWhich: (n: number) => string
  corrected: string
  you: string
  undo: string
  field: string
  send: string
  /** Once it carried on, a correction is a message to the lead. */
  sendLate: string
  cancel: string
  empty: string
  /** Before the words of the brief it reads, for a screen reader. */
  reads: string
  /** Before the file it is about, for a screen reader. */
  about: string
}

export const assumptionsText: AssumptionsText = {
  label: 'What the lead is assuming',
  no: 'No',
  noWhich: (n) => `, correct assumption ${n}`,
  corrected: ', corrected',
  you: 'You',
  undo: 'Undo',
  field: 'What should it take as given instead?',
  send: 'Correct',
  sendLate: 'Send to the lead',
  cancel: 'Cancel',
  empty: 'Say what it should take instead',
  reads: 'Reading of',
  about: 'About',
}

export interface AssumptionsProps {
  assumptions: readonly Assumption[]
  checkpoint: Checkpoint
  /** Without it the list only reads. */
  on?: Pick<CheckpointActions, 'correct' | 'cancel' | 'send' | 'undo'>
  /** Numbered, as the plan's steps are. */
  numbered?: boolean
  /** Why each is assumed, under it. */
  why?: boolean
  /** Where each applies, over it: the words of the brief, numbered as they are marked there, or a file. */
  anchored?: boolean
  /** Narrow, as in a card on the board. */
  compact?: boolean
  className?: string
  text?: Partial<AssumptionsText>
}

/** The number a phrase of the brief is marked with: the order of the assumptions that quote it. */
export function markOf(assumptions: readonly Assumption[], id: string): number | undefined {
  const quoted = assumptions.filter((a) => a.anchor && 'quote' in a.anchor)
  const i = quoted.findIndex((a) => a.id === id)
  return i < 0 ? undefined : i + 1
}

export function Assumptions({
  assumptions,
  checkpoint,
  on,
  numbered = false,
  why = true,
  anchored = false,
  compact = false,
  className,
  text,
}: AssumptionsProps) {
  const t = { ...assumptionsText, ...text }
  const late = checkpoint.phase === Phase.Continued || checkpoint.phase === Phase.Answered
  return (
    <ol className={cx(s.list, compact && s.compact, numbered && s.numbered, className)} aria-label={t.label}>
      {assumptions.map((a, i) => (
        <Item
          key={a.id}
          assumption={a}
          n={i + 1}
          mark={anchored ? markOf(assumptions, a.id) : undefined}
          anchored={anchored}
          numbered={numbered}
          why={why}
          said={checkpoint.corrections[a.id]}
          open={checkpoint.correcting === a.id}
          late={late}
          on={on}
          t={t}
        />
      ))}
    </ol>
  )
}

interface ItemProps {
  assumption: Assumption
  n: number
  mark?: number
  anchored: boolean
  numbered: boolean
  why: boolean
  said?: string
  open: boolean
  late: boolean
  on?: AssumptionsProps['on']
  t: AssumptionsText
}

function Item({ assumption: a, n, mark, anchored, numbered, why, said, open, late, on, t }: ItemProps) {
  const no = useRefocus<HTMLButtonElement>(open)
  return (
    <li className={cx(s.item, said !== undefined && s.corrected)} data-mark={mark}>
      {numbered && (
        <span className={s.n} aria-hidden="true">
          {n}
        </span>
      )}
      <div className={s.body}>
        {anchored && a.anchor && (
          <p className={s.anchor}>
            {'quote' in a.anchor ? (
              <>
                {mark !== undefined && (
                  <sup className={s.mark} aria-hidden="true">
                    {mark}
                  </sup>
                )}
                <VisuallyHidden>{t.reads} </VisuallyHidden>“{a.anchor.quote}”
              </>
            ) : (
              <>
                <VisuallyHidden>{t.about} </VisuallyHidden>
                <code className={s.file}>{a.anchor.file}</code>
              </>
            )}
          </p>
        )}
        <p className={s.says}>
          {a.says}
          {said !== undefined && <VisuallyHidden>{t.corrected}</VisuallyHidden>}
        </p>
        {why && a.because && said === undefined && <p className={s.because}>{a.because}</p>}
        {said !== undefined && (
          <p className={s.you}>
            <b>{t.you}</b> {said}
            {on && !late && (
              <>
                {' '}
                <LinkButton onClick={() => on.undo(a.id)}>{t.undo}</LinkButton>
              </>
            )}
          </p>
        )}
        {open && on && (
          <NoteForm
            className={s.form}
            onSubmit={(words) => on.send(a.id, words)}
            onCancel={on.cancel}
            text={{ placeholder: t.field, submit: late ? t.sendLate : t.send, cancel: t.cancel, empty: t.empty }}
          />
        )}
      </div>
      {on && !open && said === undefined && (
        <ActionButton ref={no} size="small" trailingIcon="arrow" className={s.no} onClick={() => on.correct(a.id)}>
          {t.no}
          <VisuallyHidden>{t.noWhich(n)}</VisuallyHidden>
        </ActionButton>
      )}
    </li>
  )
}
