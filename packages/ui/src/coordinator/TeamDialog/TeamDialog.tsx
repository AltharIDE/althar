import type { ReactNode } from 'react'

import { TaskEnd } from '../../foundations/vocabulary'
import { taskEndText } from '../../foundations/vocabularyText'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { Segmented } from '../../primitives/Segmented/Segmented'
import s from './TeamDialog.module.css'

/*
 * Who does a task, changed before it begins or after: its plan's steps,
 * numbered and joined by a line as the plan card shows them, each with its
 * picker and why it was picked, then how the work ends. Nothing changes until
 * the person saves; a held task can start with its new team at once. The
 * pickers are the consumer's, the composer's own, for models and effort.
 */

export interface TeamDialogStep {
  id: string
  /** Implement, Review. */
  label: string
  /** Who does it: the consumer's model picker. Not shown while the step is skipped. */
  picker: ReactNode
  /** Why it was picked, in a line under the picker. */
  why?: string
  /** Left out of the plan: it says so, and `onAdd` puts it back. */
  skipped?: boolean
  onAdd?: () => void
  /** Who does it, once it can't change any more: shown in the picker's place, as text; `why` says why. */
  locked?: string
}

export interface TeamDialogText {
  title: string
  /** A skipped step, in its picker's place: No review. */
  skipped: (label: string) => string
  /** Putting a skipped step back: Add a review. */
  add: (label: string) => string
  end: string
  cancel: string
  /** Cancel's words where nothing can be saved: there is nothing to cancel. */
  close: string
  save: string
  start: string
}

export const teamDialogText: TeamDialogText = {
  title: 'Team',
  skipped: (label) => `No ${label.toLowerCase()}`,
  add: (label) => `Add a ${label.toLowerCase()}`,
  end: 'When the work is done',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  start: 'Start',
}

export interface TeamDialogProps {
  /** The task's title, under the dialog's. */
  task: string
  steps: ReadonlyArray<TeamDialogStep>
  /** How the work ends, where it reaches the repository's host; absent where nothing does. */
  end?: { readonly value: TaskEnd; readonly onChange: (end: TaskEnd) => void }
  /** Saves it; absent where it can't change any more, when `settled` says why. */
  onSave?: () => void
  /** Saves and starts it, for a task held before it started; absent where it starts by itself. */
  onStart?: () => void
  onClose: () => void
  /** Only the action pressed shows progress; the other actions wait. */
  busy?: 'save' | 'start' | null
  /** Why the last save failed, under the steps; Save, still there, tries again. */
  error?: string | null
  /** Why its team can't change any more, where it can't: said quietly under the steps, in Save's place. Not a failure. */
  settled?: string | null
  text?: Partial<TeamDialogText>
}

const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

export function TeamDialog({ task, steps, end, onSave, onStart, onClose, busy = null, error, settled, text }: TeamDialogProps) {
  const t = { ...teamDialogText, ...text }
  const shown = [
    ...steps.map((step) => ({
      id: step.id,
      label: step.label,
      body: step.skipped ? (
        <div className={s.line}>
          <span className={s.none}>{t.skipped(step.label)}</span>
          {step.onAdd !== undefined && <LinkButton onClick={step.onAdd}>{t.add(step.label)}</LinkButton>}
        </div>
      ) : step.locked === undefined ? (
        <div className={s.line}>{step.picker}</div>
      ) : (
        <div className={s.line}>
          <span className={s.locked}>{step.locked}</span>
        </div>
      ),
      why: step.skipped ? undefined : step.why,
    })),
    ...(end === undefined
      ? []
      : [
          {
            id: 'end',
            label: t.end,
            body: (
              <Segmented<TaskEnd>
                label={t.end}
                value={end.value}
                onChange={end.onChange}
                options={ENDS.map((value) => ({ value, label: taskEndText[value].short }))}
              />
            ),
            why: taskEndText[end.value].note,
          },
        ]),
  ]
  return (
    <Dialog
      title={t.title}
      description={task}
      width={560}
      onClose={onClose}
      holding={busy !== null}
      actions={
        <>
          <Button variant="quiet" disabled={busy !== null} onClick={onClose}>
            {onSave === undefined && onStart === undefined ? t.close : t.cancel}
          </Button>
          {onSave !== undefined && (
            <Button variant={onStart === undefined ? 'ink' : 'default'} busy={busy === 'save'} disabled={busy === 'start'} onClick={onSave}>
              {t.save}
            </Button>
          )}
          {onStart !== undefined && (
            <Button variant="ink" busy={busy === 'start'} disabled={busy === 'save'} onClick={onStart}>
              {t.start}
            </Button>
          )}
        </>
      }
    >
      <ol className={s.steps}>
        {shown.map((step, index) => (
          <li key={step.id} className={s.step}>
            <span className={s.num} aria-hidden>
              {index + 1}
            </span>
            <div className={s.body}>
              <span className={s.name}>{step.label}</span>
              {step.body}
              {step.why !== undefined && step.why !== '' && <p className={s.why}>{step.why}</p>}
            </div>
          </li>
        ))}
      </ol>
      {settled != null && settled !== '' && (
        <p className={s.settled} role="status">
          {settled}
        </p>
      )}
      {error != null && error !== '' && <Problem className={s.problem}>{error}</Problem>}
    </Dialog>
  )
}
