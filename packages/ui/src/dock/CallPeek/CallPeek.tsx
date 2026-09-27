import { useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
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
}

export const callPeekText: CallPeekText = {
  choice: 'Your choice',
  knows: 'What the project knows',
  record: 'Record decision',
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
  text?: Partial<CallPeekText>
}

export function CallPeek({ title, because, detail, options, evidence, releases, onRecord, text }: CallPeekProps) {
  const t = { ...callPeekText, ...text }
  const [choice, setChoice] = useState('')
  return (
    <>
      <PeekHead title={title} lead={because} />
      {detail && <PeekDetail>{detail}</PeekDetail>}
      <PeekSection label={t.choice}>
        <Choices
          label={t.choice}
          options={options.map((o) => ({ value: o.id, title: o.label, note: o.note }))}
          value={choice}
          onChange={setChoice}
        />
      </PeekSection>
      {evidence && evidence.length > 0 && (
        <PeekSection label={t.knows}>
          <ul className={s.evidence}>
            {evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </PeekSection>
      )}
      <PeekFoot>
        <Button variant="signal" disabled={!choice} onClick={() => onRecord(choice)}>
          {t.record}
        </Button>
        {releases && <span>{releases}</span>}
      </PeekFoot>
    </>
  )
}
