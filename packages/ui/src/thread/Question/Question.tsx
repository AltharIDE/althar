import { useId, useState } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import s from './Question.module.css'

export interface QuestionOption {
  label: string
  /** A quieter note after it: what it implies. */
  note?: string
}

export interface QuestionText {
  other: string
  otherField: string
  answer: string
}

export const questionText: QuestionText = { other: 'Something else', otherField: 'Something else, in your words', answer: 'Answer' }

export interface QuestionProps {
  question: string
  options: QuestionOption[]
  onAnswer?: (answer: string) => void
  /** The option picked before you pick one, by position; the one after the last is "something else". */
  defaultPick?: number
  text?: Partial<QuestionText>
}

/**
 * A question from the agent, answerable in place: one of its options, or
 * something else in your own words. Violet, because it waits on you. Keys 1
 * to n pick an option.
 */
export function Question({ question, options, onAnswer, defaultPick, text }: QuestionProps) {
  const t = { ...questionText, ...text }
  const [pick, setPick] = useState<number | null>(defaultPick ?? null)
  const [other, setOther] = useState('')
  const name = useId()
  const title = useId()
  const otherIndex = options.length
  const answer = (() => {
    if (pick === null) return ''
    if (pick === otherIndex) return other.trim()
    return options[pick]?.label ?? ''
  })()
  return (
    <form
      className={s.q}
      aria-labelledby={title}
      onSubmit={(e) => {
        e.preventDefault()
        if (answer) onAnswer?.(answer)
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return
        const n = Number(e.key)
        if (Number.isInteger(n) && n >= 1 && n <= options.length + 1) {
          e.preventDefault()
          setPick(n - 1)
        }
      }}
    >
      <p className={s.title} id={title}>
        {question}
      </p>
      <fieldset className={s.options}>
        <legend className={s.legend}>{question}</legend>
        {options.map((o, i) => (
          <label key={o.label} className={cx(s.option, pick === i && s.on)}>
            <input type="radio" name={name} className={s.radio} checked={pick === i} onChange={() => setPick(i)} />
            <span className={s.key} aria-hidden="true">
              {i + 1}
            </span>
            {o.label}
            {o.note && <span className={s.note}>{o.note}</span>}
          </label>
        ))}
        <label className={cx(s.option, s.other, pick === otherIndex && s.on)}>
          <input
            type="radio"
            name={name}
            className={s.radio}
            checked={pick === otherIndex}
            onChange={() => setPick(otherIndex)}
            aria-label={t.other}
          />
          <span className={s.key} aria-hidden="true">
            {options.length + 1}
          </span>
          <input
            type="text"
            className={s.field}
            placeholder={t.other}
            aria-label={t.otherField}
            value={other}
            onFocus={() => setPick(otherIndex)}
            onChange={(e) => setOther(e.target.value)}
          />
        </label>
      </fieldset>
      <div className={s.foot}>
        <Button type="submit" variant="signal" kbd="↵" disabled={!answer}>
          {t.answer}
        </Button>
      </div>
    </form>
  )
}
