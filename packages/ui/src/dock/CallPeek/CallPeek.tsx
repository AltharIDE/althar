import { useId, useState, type ReactNode } from 'react'

import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
import { FieldError } from '../../primitives/Field/Field'
import { PeekDetail, PeekFoot, PeekHead, PeekSection } from '../Dock/Dock'
import s from './CallPeek.module.css'

/*
 * A call of yours, opened in the dock from the board: what is being asked
 * and why it came to you, each choice with what it means, and what the
 * project already knows that bears on it. Recording a choice releases what
 * it held, which the foot says before you press.
 */

export interface CallOption {
  id: string
  label: string
  /** What choosing it means. */
  note?: string
}

export interface CallPeekText {
  choice: string
  knows: string
  record: string
  /** Said when Record is pressed with nothing chosen. */
  missing: string
}

export const callPeekText: CallPeekText = {
  choice: 'Your choice',
  knows: 'What the project knows',
  record: 'Record decision',
  missing: 'Choose one first',
}

export interface CallPeekProps {
  title: string
  /** Why it came to you. */
  because?: string
  /** The situation, in more words. */
  detail?: string
  options: readonly CallOption[]
  /** What bears on it, a line each. */
  evidence?: readonly string[]
  /** What recording it does, beside the button: Releases task 422. */
  releases?: string
  onRecord: (option: string) => void
  /** The choice, by id, when the consumer holds it: null for none yet. */
  choice?: string | null
  defaultChoice?: string | null
  onChoiceChange?: (option: string | null) => void
  /** Recording is under way: Record shows it and ignores presses. */
  recording?: boolean
  /** Why the last recording did not go through, said in the foot. */
  error?: ReactNode
  text?: Partial<CallPeekText>
}

export function CallPeek({
  title,
  because,
  detail,
  options,
  evidence,
  releases,
  onRecord,
  choice: choiceProp,
  defaultChoice = null,
  onChoiceChange,
  recording = false,
  error,
  text,
}: CallPeekProps) {
  const t = { ...callPeekText, ...text }
  const [choice, setChoice] = useControlled(choiceProp, defaultChoice, onChoiceChange)
  const [missing, setMissing] = useState(false)
  const missingId = useId()
  return (
    <>
      <PeekHead title={title} lead={because} />
      {detail && <PeekDetail>{detail}</PeekDetail>}
      <PeekSection label={t.choice}>
        <Choices
          label={t.choice}
          options={options.map((o) => ({ value: o.id, title: o.label, note: o.note }))}
          value={choice}
          onChange={(next) => {
            setChoice(next)
            setMissing(false)
          }}
          aria-describedby={missing ? missingId : undefined}
        />
      </PeekSection>
      {evidence && evidence.length > 0 && (
        <PeekSection label={t.knows}>
          <ul className={s.evidence}>
            {evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </PeekSection>
      )}
      <PeekFoot>
        {/* never greyed out: pressed with nothing chosen, it says so */}
        <Button
          variant="signal"
          busy={recording}
          onClick={() => {
            if (choice === null) setMissing(true)
            else onRecord(choice)
          }}
        >
          {t.record}
        </Button>
        {missing ? <FieldError id={missingId}>{t.missing}</FieldError> : releases && <span>{releases}</span>}
        {error && (
          <span className={s.error} role="alert">
            {error}
          </span>
        )}
      </PeekFoot>
    </>
  )
}
