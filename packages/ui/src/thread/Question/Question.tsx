import { useId, useState } from 'react'

import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { FieldError } from '../../primitives/Field/Field'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { AskAnswered } from '../../primitives/Ask/Ask'
import s from './Question.module.css'

export interface QuestionOption {
  id: string
  label: string
  /** A quieter note after it: what it implies. */
  note?: string
}

/** One of the options, by id, or something else in your own words. */
export type QuestionAnswer = { optionId: string; words?: undefined } | { words: string; optionId?: undefined }

export interface QuestionText {
  other: string
  otherField: string
  answer: string
  /** Said when Answer is pressed with nothing picked or written. */
  missing: string
  undo: string
}

export const questionText: QuestionText = {
  other: 'Something else',
  otherField: 'Something else, in your words',
  answer: 'Answer',
  missing: 'Pick one, or write your own',
  undo: 'Undo',
}

/* the pick that means "something else"; option ids are the consumer's, so this one is outside any string they would choose */
const OTHER = '\u0000other'

export type QuestionProps = Omit<
  RootProps<
    'form',
    {
      question: string
      options: readonly QuestionOption[]
      /** The answer, when the consumer holds it: null for not yet answered. */
      answer?: QuestionAnswer | null
      /** Start already answered, when the component holds the answer. */
      defaultAnswer?: QuestionAnswer | null
      onAnswer?: (answer: QuestionAnswer) => void
      /** Take the answer back. Without it there is no Undo. */
      onUndo?: (answer: QuestionAnswer) => void
      /** Picked or written before you touch it: a draft, not an answer. */
      defaultPick?: QuestionAnswer
      text?: Partial<QuestionText>
    }
  >,
  'onSubmit'
>

/* keys 1 to 9 pick; past nine there is no key */
const keyOf = (i: number) => (i < 9 ? String(i + 1) : undefined)

/**
 * A question from the agent, answerable in place: one of its options, or
 * something else in your own words. Violet, because it waits on you. Keys 1
 * to 9 pick an option. Once answered it folds to one line.
 */
export function Question({
  question,
  options,
  answer: answerProp,
  defaultAnswer = null,
  onAnswer,
  onUndo,
  defaultPick,
  text,
  className,
  ...rest
}: QuestionProps) {
  const t = { ...questionText, ...text }
  const [answer, setAnswer] = useControlled<QuestionAnswer | null>(answerProp, defaultAnswer)
  const [answeredHere, setAnsweredHere] = useState(false)
  const [pick, setPick] = useState<string | null>(defaultPick?.optionId ?? (defaultPick ? OTHER : null))
  const [other, setOther] = useState(defaultPick?.words ?? '')
  const [missing, setMissing] = useState(false)
  const name = useId()
  const title = useId()
  const error = useId()

  if (answer) {
    const said = answer.optionId !== undefined ? (options.find((o) => o.id === answer.optionId)?.label ?? answer.optionId) : answer.words
    return (
      <AskAnswered
        className={className}
        said={said}
        undo={t.undo}
        focusOnMount={answeredHere}
        onUndo={
          onUndo &&
          (() => {
            setAnsweredHere(false)
            setAnswer(null)
            onUndo(answer)
          })
        }
      >
        <span className={s.asked}>· {question}</span>
      </AskAnswered>
    )
  }

  const choose = (id: string) => {
    setPick(id)
    setMissing(false)
  }
  const drafted = (): QuestionAnswer | null => {
    if (pick === null) return null
    if (pick === OTHER) return other.trim() ? { words: other.trim() } : null
    return { optionId: pick }
  }
  const otherKey = keyOf(options.length)
  return (
    <form
      className={cx(s.q, className)}
      aria-labelledby={title}
      noValidate
      {...rest}
      onSubmit={(e) => {
        e.preventDefault()
        const a = drafted()
        if (!a) {
          setMissing(true)
          return
        }
        onAnswer?.(a)
        setAnsweredHere(true)
        setAnswer(a)
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const n = Number(e.key)
        if (!Number.isInteger(n) || n < 1 || n > 9) return
        const id = n - 1 < options.length ? options[n - 1]?.id : n - 1 === options.length ? OTHER : undefined
        if (id === undefined) return
        e.preventDefault()
        choose(id)
      }}
    >
      <p className={s.title} id={title}>
        {question}
      </p>
      <div className={s.options} role="radiogroup" aria-labelledby={title} aria-describedby={missing ? error : undefined}>
        {options.map((o, i) => {
          const key = keyOf(i)
          return (
            <label key={o.id} className={cx(s.option, pick === o.id && s.on)}>
              <input type="radio" name={name} className={s.radio} checked={pick === o.id} onChange={() => choose(o.id)} />
              {key && (
                <span className={s.key} aria-hidden="true">
                  {key}
                </span>
              )}
              {o.label}
              {o.note && <span className={s.note}>{o.note}</span>}
            </label>
          )
        })}
        {/* the field is not inside the label, so a click in it types rather than toggling */}
        <div className={cx(s.option, s.other, pick === OTHER && s.on)}>
          <label className={s.otherPick}>
            <input type="radio" name={name} className={s.radio} checked={pick === OTHER} onChange={() => choose(OTHER)} />
            {otherKey && (
              <span className={s.key} aria-hidden="true">
                {otherKey}
              </span>
            )}
            <VisuallyHidden>{t.other}</VisuallyHidden>
          </label>
          <input
            type="text"
            className={s.field}
            placeholder={t.other}
            aria-label={t.otherField}
            value={other}
            onFocus={() => choose(OTHER)}
            onChange={(e) => {
              setOther(e.target.value)
              setMissing(false)
            }}
          />
        </div>
      </div>
      <div className={s.foot}>
        <Button type="submit" variant="signal" kbd="↵">
          {t.answer}
        </Button>
        {missing && <FieldError id={error}>{t.missing}</FieldError>}
      </div>
    </form>
  )
}
