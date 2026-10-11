import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { AskAnswered, AskCard, AskFoot } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldError } from '../../primitives/Field/Field'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Question.module.css'

/*
 * An agent asking the person something, as Claude Code's AskUserQuestion
 * and Codex's request_user_input do: one to four questions in one form, each
 * with its options (one of them, or several) and, unless the agent rules it
 * out, something else in the person's own words. A question with no options
 * is answered in words only. It waits in the thread, violet, until answered;
 * then it folds to one line per question saying what was said. It can also
 * be withdrawn, when the agent stops asking or the task stops: then each
 * question says it wasn't answered, and why, quietly.
 */

export interface QuestionOption {
  id: string
  label: string
  /** What it means, under it, as the agent explains it: what choosing it does, or costs. */
  note?: string
}

export interface QuestionPart {
  id: string
  /** The question, as the agent put it. */
  question: string
  /** A short name the agent gave it: Database. Shown quietly, and only where there are several questions. */
  header?: string
  /** What it may be answered with. None: it is answered in words only. */
  options: readonly QuestionOption[]
  /** Several may be picked. */
  multiple?: boolean
  /** Whether something else, in the person's own words, is offered beside the options. It is, unless this is false. */
  words?: boolean
}

/** What was said to one question: the options picked, by id, and the person's own words. */
export interface QuestionPick {
  optionIds: readonly string[]
  words?: string
}

/** Every question's answer, by the question's id. */
export type QuestionAnswer = Readonly<Record<string, QuestionPick>>

export interface QuestionText {
  /** What kind of ask it is. */
  kicker: string
  /** After the kicker, where there are several questions. */
  count: (n: number) => string
  /** Beside a question that takes several picks. */
  many: string
  /** The option that is the person's own words, and its field. */
  other: string
  otherField: string
  /** The field of a question answered in words only. */
  wordsField: string
  answer: string
  /** Said under a question left unanswered when Answer is pressed: one pick, or words. */
  missing: string
  /** The same, for a question that takes several picks. */
  missingMany: string
  /** For one with no words offered. */
  missingPick: string
  missingManyPick: string
  /** For one answered in words only. */
  missingWords: string
  /** Several things said to one question, as one phrase: A, B and C. */
  join: (said: readonly string[]) => string
  /** A question withdrawn before it was answered. */
  notAnswered: string
  undo: string
}

export const questionText: QuestionText = {
  kicker: 'Needs your answer',
  count: (n) => `${n} questions`,
  many: 'Pick any that apply',
  other: 'Something else',
  otherField: 'Something else, in your words',
  wordsField: 'Your answer',
  answer: 'Answer',
  missing: 'Pick one, or write your own',
  missingMany: 'Pick at least one, or write your own',
  missingPick: 'Pick one',
  missingManyPick: 'Pick at least one',
  missingWords: 'Write your answer',
  join: (said) => (said.length < 2 ? said.join('') : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1] ?? ''}`),
  notAnswered: 'Not answered',
  undo: 'Undo',
}

export type QuestionProps = RootProps<
  'div',
  {
    /** What the agent said above several questions. Not shown with one, whose question says it. */
    title?: string
    parts: readonly QuestionPart[]
    /** The answer, when the consumer holds it: null for not yet answered. */
    answer?: QuestionAnswer | null
    /** Start already answered, when the component holds the answer: from history. */
    defaultAnswer?: QuestionAnswer | null
    /** Answered: every question has a pick or words. Called at once. */
    onAnswer?: (answer: QuestionAnswer) => void
    /** The answer is on its way: Answer shows it and ignores presses, and the questions can't be changed. */
    answering?: boolean
    /** Why the last answer didn't go through, beside Answer. What was picked stays, to answer again. */
    error?: string
    /** No longer asked, and why: the agent stopped asking, or the task stopped. Each question says it wasn't answered. */
    withdrawn?: string
    /** Take the answer back. Without it there is no Undo. */
    onUndo?: (answer: QuestionAnswer) => void
    /** Picked or written before the person touches it, by question: a draft, not an answer. */
    defaultPick?: QuestionAnswer
    /**
     * The person was brought here to answer it: once shown, it comes into
     * view and its first question takes focus, so keys pick at once.
     */
    focusOnMount?: boolean
    text?: Partial<QuestionText>
  }
>

/* What is picked or written for one question, before it is an answer: for one pick, `other` is the own-words option picked; for several, its box ticked. */
interface Draft {
  optionIds: readonly string[]
  other: boolean
  words: string
}

const EMPTY: Draft = { optionIds: [], other: false, words: '' }

/* A question with no options is answered in words whatever it says. */
const takesWords = (part: QuestionPart) => part.options.length === 0 || part.words !== false

function draftOf(part: QuestionPart, pick: QuestionPick | undefined): Draft {
  if (!pick) return EMPTY
  const words = pick.words ?? ''
  if (part.multiple) return { optionIds: pick.optionIds, other: words !== '', words }
  return { optionIds: pick.optionIds.slice(0, 1), other: pick.optionIds.length === 0 && words !== '', words }
}

/* The draft as an answer, or null where it doesn't answer the question yet. */
function pickOf(part: QuestionPart, draft: Draft): QuestionPick | null {
  const words = draft.words.trim()
  if (part.options.length === 0) return words ? { optionIds: [], words } : null
  const own = draft.other && takesWords(part) && words ? words : undefined
  if (!part.multiple) {
    if (draft.other) return own ? { optionIds: [], words: own } : null
    const [id] = draft.optionIds
    return id === undefined ? null : { optionIds: [id] }
  }
  /* in the options' order, whatever order they were picked in */
  const optionIds = part.options.filter((o) => draft.optionIds.includes(o.id)).map((o) => o.id)
  if (optionIds.length === 0 && !own) return null
  return own ? { optionIds, words: own } : { optionIds }
}

/* What is said under a question left unanswered. */
function missingSaid(part: QuestionPart, t: QuestionText): string {
  if (part.options.length === 0) return t.missingWords
  if (part.multiple) return takesWords(part) ? t.missingMany : t.missingManyPick
  return takesWords(part) ? t.missing : t.missingPick
}

/* What was said to a question, as one phrase; empty where nothing was. */
function saidOf(part: QuestionPart, pick: QuestionPick | undefined, t: QuestionText): string {
  if (!pick) return ''
  const said = pick.optionIds.map((id) => part.options.find((o) => o.id === id)?.label ?? id)
  if (pick.words) said.push(pick.words)
  return t.join(said)
}

/* keys 1 to 9 pick; past nine there is no key */
const keyOf = (i: number) => (i < 9 ? String(i + 1) : undefined)

/**
 * One to four questions from an agent, answerable in place, with one Answer
 * for all of them. Violet, because it waits on you. Keys 1 to 9 pick within
 * the question that has focus. Once answered it folds to a line for each
 * question; withdrawn, to a quiet line for each, saying why.
 */
export function Question({
  title,
  parts,
  answer: answerProp,
  defaultAnswer = null,
  onAnswer,
  answering = false,
  error,
  withdrawn,
  onUndo,
  defaultPick,
  focusOnMount = false,
  text,
  className,
  ...rest
}: QuestionProps) {
  const t = { ...questionText, ...text }
  const [answer, setAnswer] = useControlled<QuestionAnswer | null>(answerProp, defaultAnswer)
  const [answeredHere, setAnsweredHere] = useState(false)
  /* focus was in the form: if it goes, answered or withdrawn from elsewhere, focus goes to what replaces it */
  const [focusIn, setFocusIn] = useState(false)
  const start = defaultPick ?? defaultAnswer
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>(() =>
    Object.fromEntries(parts.map((p) => [p.id, draftOf(p, start?.[p.id])])),
  )
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const base = useId()
  const kicker = useId()
  const form = useRef<HTMLFormElement>(null)
  const submit = useRef<HTMLButtonElement>(null)
  const fields = useRef(new Map<string, HTMLInputElement>())

  const several = parts.length > 1
  const focusLine = answeredHere || focusIn

  // Brought here to answer it: into view, and its first question's first choice (or field) focused. Once, as it is first shown.
  const broughtHere = useRef(focusOnMount)
  useEffect(() => {
    if (!broughtHere.current) return
    broughtHere.current = false
    let live = true
    // Just after the commit, as AskAnswered focuses, so focus never lands inside React's flush.
    queueMicrotask(() => {
      const first = form.current?.querySelector<HTMLInputElement>('input')
      if (!live || first == null) return
      first.focus({ preventScroll: true })
      first.closest('form')?.scrollIntoView?.({ block: 'center' })
    })
    return () => {
      live = false
    }
  }, [])

  if (answer) {
    return (
      <div className={cx(s.lines, className)} {...rest}>
        {parts.map((part, i) => {
          const said = saidOf(part, answer[part.id], t)
          return (
            <AskAnswered
              key={part.id}
              wrap
              denied={!said}
              said={said || t.notAnswered}
              focusOnMount={focusLine && i === 0}
              undo={t.undo}
              onUndo={
                i === 0 && onUndo
                  ? () => {
                      setAnsweredHere(false)
                      setFocusIn(false)
                      setAnswer(null)
                      onUndo(answer)
                    }
                  : undefined
              }
            >
              <span className={s.asked}>· {part.question}</span>
            </AskAnswered>
          )
        })}
      </div>
    )
  }

  if (withdrawn !== undefined) {
    return (
      <div className={cx(s.lines, className)} {...rest}>
        {parts.map((part, i) => (
          <AskAnswered
            key={part.id}
            wrap
            denied
            said={<span className={s.notAnswered}>{t.notAnswered}</span>}
            focusOnMount={focusIn && i === 0}
          >
            <span className={cx(s.asked, s.unasked)}>· {part.question}</span>
            {i === 0 && withdrawn && <span className={s.why}>· {withdrawn}</span>}
          </AskAnswered>
        ))}
      </div>
    )
  }

  const draftFor = (part: QuestionPart) => drafts[part.id] ?? EMPTY
  const change = (part: QuestionPart, next: Partial<Draft>) => {
    setDrafts((all) => ({ ...all, [part.id]: { ...(all[part.id] ?? EMPTY), ...next } }))
    setMissing((was) => {
      if (!was.has(part.id)) return was
      const now = new Set(was)
      now.delete(part.id)
      return now
    })
  }
  const pick = (part: QuestionPart, id: string) => {
    const draft = draftFor(part)
    if (!part.multiple) change(part, { optionIds: [id], other: false })
    else if (draft.optionIds.includes(id)) change(part, { optionIds: draft.optionIds.filter((x) => x !== id) })
    else change(part, { optionIds: [...draft.optionIds, id] })
  }
  const pickOther = (part: QuestionPart, on: boolean) => change(part, part.multiple ? { other: on } : { other: true, optionIds: [] })

  const send = () => {
    if (answering) return
    const picks = parts.map((part) => [part, pickOf(part, draftFor(part))] as const)
    const unanswered = picks.flatMap(([part, p]) => (p ? [] : [part.id]))
    if (unanswered.length > 0) {
      setMissing(new Set(unanswered))
      /* to the first question still to answer: its first option, or its field */
      const first = parts.findIndex((part) => part.id === unanswered[0])
      form.current?.querySelector<HTMLElement>(`[data-part="${first}"] input`)?.focus()
      return
    }
    const given: QuestionAnswer = Object.fromEntries(picks.flatMap(([part, p]) => (p ? [[part.id, p]] : [])))
    /* the button keeps focus while the answer goes out, so nothing is lost as the form waits */
    submit.current?.focus()
    onAnswer?.(given)
    setAnsweredHere(true)
    setAnswer(given)
  }

  const questionId = (i: number) => `${base}-q${i}`
  const manyId = (i: number) => `${base}-m${i}`
  /* one question is what the card asks; several are under what the agent said above them, if anything */
  const [only] = parts
  let what: ReactNode
  if (several) what = title ? <span className={s.message}>{title}</span> : undefined
  else if (only)
    what = (
      <>
        <span id={questionId(0)}>{only.question}</span>
        {only.multiple && only.options.length > 0 && (
          <span className={s.many} id={manyId(0)}>
            {t.many}
          </span>
        )}
      </>
    )
  return (
    <AskCard
      icon="answer"
      kickerId={kicker}
      kicker={
        several ? (
          <>
            {t.kicker} <span className={s.count}>· {t.count(parts.length)}</span>
          </>
        ) : (
          t.kicker
        )
      }
      what={what}
      className={className}
      {...rest}
    >
      <form
        ref={form}
        aria-labelledby={kicker}
        noValidate
        className={cx(several && (title ? s.titled : s.untitled))}
        onFocus={() => setFocusIn(true)}
        onBlur={(e) => setFocusIn(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        onKeyDown={(e) => {
          if (answering || e.metaKey || e.ctrlKey || e.altKey) return
          if (e.target instanceof HTMLInputElement && e.target.type === 'text') return
          const n = Number(e.key)
          if (!Number.isInteger(n) || n < 1 || n > 9) return
          /* the question with focus; with one question, it wherever focus is in the form */
          const holder = e.target instanceof Element ? e.target.closest('[data-part]') : null
          let at = several ? -1 : 0
          if (holder) at = Number(holder.getAttribute('data-part'))
          const part = parts[at]
          if (!part) return
          const i = n - 1
          const option = part.options[i]
          if (option) {
            e.preventDefault()
            pick(part, option.id)
          } else if (i === part.options.length && part.options.length > 0 && takesWords(part)) {
            e.preventDefault()
            const on = part.multiple ? !draftFor(part).other : true
            pickOther(part, on)
            if (on) fields.current.get(part.id)?.focus()
          }
        }}
      >
        <div className={s.parts}>
          {parts.map((part, i) => (
            <Part
              key={part.id}
              part={part}
              index={i}
              draft={draftFor(part)}
              several={several}
              questionId={questionId(i)}
              manyId={manyId(i)}
              name={`${base}-n${i}`}
              errorId={`${base}-e${i}`}
              missing={missing.has(part.id)}
              disabled={answering}
              field={(el) => {
                if (el) fields.current.set(part.id, el)
                else fields.current.delete(part.id)
              }}
              onPick={(id) => pick(part, id)}
              onOther={(on) => pickOther(part, on)}
              onWords={(words) =>
                change(part, part.options.length === 0 ? { words } : { words, other: true, ...(part.multiple ? {} : { optionIds: [] }) })
              }
              t={t}
            />
          ))}
        </div>
        <AskFoot>
          <Button ref={submit} type="submit" variant="signal" kbd="↵" busy={answering}>
            {t.answer}
          </Button>
          {error && (
            <span className={s.error} role="alert">
              {error}
            </span>
          )}
        </AskFoot>
      </form>
    </AskCard>
  )
}

interface PartProps {
  part: QuestionPart
  index: number
  draft: Draft
  several: boolean
  questionId: string
  manyId: string
  name: string
  errorId: string
  missing: boolean
  disabled: boolean
  field: (el: HTMLInputElement | null) => void
  onPick: (id: string) => void
  onOther: (on: boolean) => void
  onWords: (words: string) => void
  t: QuestionText
}

/* One question: its name where there are several, its options or its field, and what is missing. */
function Part({
  part,
  index,
  draft,
  several,
  questionId,
  manyId,
  name,
  errorId,
  missing,
  disabled,
  field,
  onPick,
  onOther,
  onWords,
  t,
}: PartProps) {
  const many = part.multiple === true && part.options.length > 0
  const describedBy = [many ? manyId : undefined, missing ? errorId : undefined].filter(Boolean).join(' ') || undefined
  const type = part.multiple ? 'checkbox' : 'radio'
  const otherKey = keyOf(part.options.length)
  return (
    <div className={s.part} data-part={index}>
      {several && (
        <div className={s.head}>
          {part.header && <span className={s.header}>{part.header}</span>}
          <p className={s.question}>
            <span id={questionId}>{part.question}</span>
            {many && (
              <span className={s.many} id={manyId}>
                {t.many}
              </span>
            )}
          </p>
        </div>
      )}
      {part.options.length === 0 ? (
        <Field
          ref={field}
          className={s.words}
          aria-labelledby={questionId}
          aria-describedby={describedBy}
          placeholder={t.wordsField}
          value={draft.words}
          invalid={missing}
          disabled={disabled}
          onChange={(e) => onWords(e.target.value)}
        />
      ) : (
        <fieldset
          className={s.options}
          role={part.multiple ? undefined : 'radiogroup'}
          aria-labelledby={questionId}
          aria-describedby={describedBy}
          disabled={disabled}
        >
          {part.options.map((o, i) => {
            const key = keyOf(i)
            const on = draft.optionIds.includes(o.id)
            return (
              <label key={o.id} className={cx(s.option, on && s.on)}>
                {/* named by the option, described by what it means */}
                <input
                  type={type}
                  name={name}
                  className={s.input}
                  checked={on}
                  onChange={() => onPick(o.id)}
                  aria-labelledby={`${name}-${i}`}
                  aria-describedby={o.note ? `${name}-${i}-note` : undefined}
                />
                {key && (
                  <span className={s.key} aria-hidden="true">
                    {key}
                  </span>
                )}
                <span className={s.says}>
                  <span className={s.label} id={`${name}-${i}`}>
                    {o.label}
                  </span>
                  {o.note && (
                    <span className={s.note} id={`${name}-${i}-note`}>
                      {o.note}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
          {takesWords(part) && (
            /* the field is not inside the label, so a click in it types rather than toggling */
            <div className={cx(s.option, s.other, draft.other && s.on)}>
              <label className={s.otherPick}>
                <input type={type} name={name} className={s.input} checked={draft.other} onChange={(e) => onOther(e.target.checked)} />
                {otherKey && (
                  <span className={s.key} aria-hidden="true">
                    {otherKey}
                  </span>
                )}
                <VisuallyHidden>{t.other}</VisuallyHidden>
              </label>
              <input
                ref={field}
                type="text"
                className={s.field}
                placeholder={t.other}
                aria-label={t.otherField}
                value={draft.words}
                onFocus={() => {
                  if (!draft.other) onOther(true)
                }}
                onChange={(e) => onWords(e.target.value)}
              />
            </div>
          )}
        </fieldset>
      )}
      {missing && <FieldError id={errorId}>{missingSaid(part, t)}</FieldError>}
    </div>
  )
}
