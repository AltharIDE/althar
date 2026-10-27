import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldArea, FieldError } from '../../primitives/Field/Field'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import l from '../TaskLaunch/TaskLaunch.module.css'
import s from './AutomationCard.module.css'

/*
 * An automation as one card, the same wherever it shows: in the
 * coordinator's conversation when it proposes or changes one, and on the
 * automation's own page, where it is how you change it. The plan card's own
 * frame and rows, with the automation's mark (a turning clock) where a
 * task's card names the task, so it reads at once as not a task. Its rows:
 * when it runs, who leads each run, who reviews it, and what it ends in;
 * what the coordinator changed shows what it was, struck through. In the
 * conversation its foot says where it stands and offers what it can do
 * there; on its page it drops its kicker and its name, its prompt is its
 * head, with Edit. Once it is on, the conversation folds it to a line
 * (AutomationNote); asked to resume it or run it now, it is a small ask
 * (AutomationAsk).
 */

/** One choice of a row's menu: what it is, and the words it shows. */
export interface AutomationChoice {
  value: string
  label: string
  /** Quieter words after it in the menu. */
  hint?: string
}

/** Days of the week and a time, as "Another time…" sets them: days as ISO numbers them, 1 for Monday; the time on a 24-hour clock, 09:00. */
export interface AutomationTime {
  days: readonly number[]
  at: string
}

/** Who a picker is for: the lead of each run, or its reviewer. */
export interface AutomationPick {
  role: 'lead' | 'review'
  /** Whose pick it is, for the picker's name: Lead for each run. */
  owner: string
}

export interface AutomationCardText {
  /** What it is, and whose: Automation · Meridian, or Automation, changed · Meridian. */
  kicker: (project: string, changed: boolean) => string
  promptLabel: string
  /** In the prompt's place while it says nothing yet. */
  promptPlaceholder: string
  /** Under the prompt, where it says nothing and must. */
  promptMissing: string
  edit: string
  done: string
  when: string
  lead: string
  review: string
  ends: string
  /** The menus' names. */
  whenMenu: string
  endsMenu: string
  /** The When menu's last item: days and a time of the person's own. */
  another: string
  days: string
  /** Each day's toggle, from Monday, and its whole name. */
  dayShort: readonly string[]
  dayNames: readonly string[]
  at: string
  time: string
  set: string
  cancel: string
  noDays: string
  /** When's note: when it runs next. */
  next: (next: string) => string
  /** Said before an old value, struck through, to a screen reader. */
  was: string
  none: string
  addReviewer: string
  skip: string
  leadOwner: string
  reviewOwner: string
  /** The foot, proposed: nothing runs yet. */
  proposed: string
  /** The foot, changed while on: from when the change holds, where that is known. */
  holds: (next: string | null) => string
  /** The foot, changed in a way that needs turning on again. */
  again: string
  limits: string
  hideLimits: string
  tryOnce: string
  turnOn: string
  undo: string
  open: string
}

export const automationCardText: AutomationCardText = {
  kicker: (project, changed) => `Automation${changed ? ', changed' : ''} · ${project}`,
  promptLabel: 'What each run is asked',
  promptPlaceholder: 'What should each run do?',
  promptMissing: 'Say what each run should do first.',
  edit: 'Edit',
  done: 'Done',
  when: 'When',
  lead: 'Lead',
  review: 'Review',
  ends: 'Ends in',
  whenMenu: 'When it runs',
  endsMenu: 'What each run ends in',
  another: 'Another time…',
  days: 'Days',
  dayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  dayNames: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  at: 'at',
  time: 'Time',
  set: 'Done',
  cancel: 'Cancel',
  noDays: 'Pick a day first',
  next: (next) => `next ${next}`,
  was: 'was',
  none: 'None',
  addReviewer: 'Add a reviewer',
  skip: 'Skip',
  leadOwner: 'Lead for each run',
  reviewOwner: 'Reviewer for each run',
  proposed: 'Nothing runs until you turn it on.',
  holds: (next) => (next === null ? 'Holds from its next run.' : `Holds from its next run, ${next}.`),
  again: 'It runs again once you turn it on.',
  limits: 'Its limits',
  hideLimits: 'Hide its limits',
  tryOnce: 'Try it once now',
  turnOn: 'Turn on',
  undo: 'Undo',
  open: 'Open in Automations',
}

/** A row's review: none, or a reviewer in the picker; added and skipped where the consumer can. */
export interface AutomationReview {
  on: boolean
  /** What it was, where the coordinator changed it. */
  was?: string
  onAdd?: () => void
  onSkip?: () => void
}

export type AutomationCardProps = RootProps<
  'div',
  {
    name: string
    project: string
    /** What each run is asked, as the person would say it to the coordinator. */
    prompt: string
    /**
     * proposed: in the conversation, nothing runs until it is turned on.
     * changed: the coordinator changed it, each old value struck through.
     * kept: on its own page, where it is changed; no kicker, no name, no foot.
     */
    stage: 'proposed' | 'changed' | 'kept'
    /** Changed, and still on: the change holds from its next run (`next`). Otherwise a changed one waits to be turned on again. */
    holds?: boolean
    /** A new prompt, from Edit and Done on its page. Without it, there is no Edit. */
    onPromptChange?: (prompt: string) => void
    /** The prompt is a field from the start, ready to type, each change said at once: a new automation's. */
    writing?: boolean
    /** The prompt being written says nothing, and must: said under its field, which is marked invalid. */
    promptMissing?: boolean
    /** When it runs: the choices, the one it is on, and what it was. */
    when: readonly AutomationChoice[]
    whenValue: string
    onWhenChange?: (value: string) => void
    /** When it runs next, in words: tomorrow at 9:00. */
    next?: string
    whenWas?: string
    /** Days and a time of the person's own, from "Another time…", starting from these. Without it, the menu doesn't offer one. */
    time?: AutomationTime
    onTimeChange?: (time: AutomationTime) => void
    /** Who leads each run, and reviews it: the consumer's model picker. */
    picker: (pick: AutomationPick) => ReactNode
    leadWas?: string
    /** Who reviews each run's work; no row for a run that is itself a review. */
    review?: AutomationReview
    /** What each run ends in: the choices, the one it is on, and what it was. */
    ends: readonly AutomationChoice[]
    endsValue: string
    onEndsChange?: (value: string) => void
    endsWas?: string
    /** Its limits, folded out from the foot: each named, then said. */
    limits?: readonly (readonly [string, ReactNode])[]
    onTryOnce?: () => void
    onTurnOn?: () => void
    onUndo?: () => void
    /** Opens it in the project's Automations. */
    onOpen?: () => void
    /** Something it was asked to do is on its way. */
    busy?: boolean
    text?: Partial<AutomationCardText>
  }
>

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** An old value, struck through, said as what it was. */
function Was({ value, t }: { value: string; t: AutomationCardText }) {
  return (
    <s className={s.was}>
      <VisuallyHidden>{t.was} </VisuallyHidden>
      {value}
    </s>
  )
}

/** A row of the card: its mark, its name, who or what, a note, and an action at its end. */
function Row({ icon, label, who, why, act }: { icon: IconName; label: string; who: ReactNode; why?: ReactNode; act?: ReactNode }) {
  return (
    <li className={l.step}>
      <span className={s.rowIcon}>
        <Icon name={icon} size={13} />
      </span>
      <span className={l.label}>{label}</span>
      <span className={l.who}>{who}</span>
      <span className={l.why}>{why}</span>
      <span className={l.act}>{act}</span>
    </li>
  )
}

/** One of a few words, from a menu drawn as the plan card's pickers are; without a way to change it, the words alone. */
function Pick({
  label,
  value,
  options,
  onChange,
  another,
  onAnother,
}: {
  label: string
  value: string
  options: readonly AutomationChoice[]
  onChange?: (value: string) => void
  /** A last item that opens something of its own. */
  another?: string
  onAnother?: () => void
}) {
  const shown = options.find((option) => option.value === value)?.label ?? value
  // Picking "Another time…" takes focus on to what it opens, not back to the button.
  const away = useRef(false)
  if (onChange === undefined) return <span className={s.plain}>{shown}</span>
  return (
    <Menu
      label={label}
      width={300}
      returnFocus={() => {
        const back = !away.current
        away.current = false
        return back
      }}
      trigger={
        <ActionButton className={l.pick} trailingIcon="chevronD">
          {shown}
        </ActionButton>
      }
    >
      <MenuRadioGroup label={label} value={value} onChange={onChange}>
        {options.map((option) => (
          <MenuRadioItem key={option.value} value={option.value} {...(option.hint === undefined ? {} : { hint: option.hint })}>
            {option.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {another !== undefined && onAnother !== undefined && (
        <>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              away.current = true
              onAnother()
            }}
          >
            {another}
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Days and a time of the person's own, set in place under When: a toggle for each day, the time, and Done. */
function AnotherTime({
  start,
  onSet,
  onCancel,
  t,
}: {
  start: AutomationTime
  onSet: (time: AutomationTime) => void
  onCancel: () => void
  t: AutomationCardText
}) {
  const [days, setDays] = useState<readonly number[]>(start.days)
  const [at, setAt] = useState(start.at)
  const [missing, setMissing] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const errorId = useId()
  useEffect(() => {
    first.current?.focus()
  }, [])
  const toggle = (day: number) => {
    const next = days.includes(day) ? days.filter((one) => one !== day) : [...days, day].toSorted((a, b) => a - b)
    setDays(next)
    if (next.length > 0) setMissing(false)
  }
  return (
    <li
      className={s.another}
      /* its Escape, not a panel's round it */
      data-own-escape=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <div role="group" aria-label={t.days} aria-describedby={missing ? errorId : undefined} className={s.days}>
        {DAYS.map((day, i) => (
          <button
            key={day}
            ref={i === 0 ? first : undefined}
            type="button"
            className={s.day}
            aria-pressed={days.includes(day)}
            aria-label={t.dayNames[i]}
            onClick={() => toggle(day)}
          >
            {t.dayShort[i]}
          </button>
        ))}
      </div>
      <span className={s.at} aria-hidden="true">
        {t.at}
      </span>
      <Field type="time" aria-label={t.time} className={s.time} value={at} onChange={(event) => setAt(event.target.value)} required />
      <span className={s.anotherEnd}>
        <LinkButton onClick={onCancel}>{t.cancel}</LinkButton>
        <Button
          size="small"
          onClick={() => {
            if (days.length === 0) {
              setMissing(true)
              first.current?.focus()
              return
            }
            if (at !== '') onSet({ days, at })
          }}
        >
          {t.set}
        </Button>
      </span>
      {missing && (
        <span className={s.anotherError}>
          <FieldError id={errorId}>{t.noDays}</FieldError>
        </span>
      )}
    </li>
  )
}

/** The prompt: its words, or a field to change them in; one that says nothing where it must is said under its field. */
function Prompt({
  prompt,
  kept,
  writing,
  missing,
  onPromptChange,
  t,
}: {
  prompt: string
  kept: boolean
  writing: boolean
  missing: boolean
  onPromptChange?: (prompt: string) => void
  t: AutomationCardText
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(prompt)
  // Done on a blank prompt keeps it open, saying why.
  const [blank, setBlank] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const edit = useRef<HTMLButtonElement>(null)
  const errorId = useId()
  const was = useRef(editing)
  useEffect(() => {
    if (editing || writing) field.current?.focus()
    // Done gives focus back to Edit.
    else if (was.current) edit.current?.focus()
    was.current = editing
  }, [editing, writing])
  if (writing && onPromptChange !== undefined)
    return (
      <div className={s.promptWriting}>
        <FieldArea
          ref={field}
          rows={3}
          aria-label={t.promptLabel}
          placeholder={t.promptPlaceholder}
          className={s.area}
          value={prompt}
          invalid={missing}
          aria-describedby={missing ? errorId : undefined}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        {missing && <FieldError id={errorId}>{t.promptMissing}</FieldError>}
      </div>
    )
  if (editing && onPromptChange !== undefined)
    return (
      <div className={s.promptEdit}>
        <FieldArea
          ref={field}
          rows={3}
          aria-label={t.promptLabel}
          placeholder={t.promptPlaceholder}
          className={s.area}
          value={draft}
          invalid={blank}
          aria-describedby={blank ? errorId : undefined}
          data-own-escape=""
          onChange={(event) => {
            setDraft(event.target.value)
            if (event.target.value.trim() !== '') setBlank(false)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setDraft(prompt)
            setBlank(false)
            setEditing(false)
          }}
        />
        {blank && <FieldError id={errorId}>{t.promptMissing}</FieldError>}
        <div className={s.promptButtons}>
          <LinkButton
            onClick={() => {
              if (draft.trim() === '') {
                setBlank(true)
                field.current?.focus()
                return
              }
              if (draft.trim() !== prompt.trim()) onPromptChange(draft.trim())
              setEditing(false)
            }}
          >
            {t.done}
          </LinkButton>
        </div>
      </div>
    )
  return (
    <p className={cx(s.prompt, kept && s.promptHead)}>
      {prompt === '' ? <span className={s.placeholder}>{t.promptPlaceholder}</span> : prompt}
      {onPromptChange !== undefined && (
        <>
          {' '}
          <LinkButton
            ref={edit}
            onClick={() => {
              setDraft(prompt)
              setEditing(true)
            }}
          >
            {t.edit}
          </LinkButton>
        </>
      )}
    </p>
  )
}

export function AutomationCard({
  name,
  project,
  prompt,
  stage,
  holds = false,
  onPromptChange,
  writing = false,
  promptMissing = false,
  when,
  whenValue,
  onWhenChange,
  next,
  whenWas,
  time,
  onTimeChange,
  picker,
  leadWas,
  review,
  ends,
  endsValue,
  onEndsChange,
  endsWas,
  limits,
  onTryOnce,
  onTurnOn,
  onUndo,
  onOpen,
  busy = false,
  text,
  className,
  ...rest
}: AutomationCardProps) {
  const t = { ...automationCardText, ...text }
  const [limitsShown, setLimitsShown] = useState(false)
  const [another, setAnother] = useState(false)
  const kept = stage === 'kept'
  return (
    <div className={cx(l.launch, s.card, className)} data-rhythm={Rhythm.Card} {...rest}>
      <div className={cx(l.head, kept && s.keptHead)}>
        {!kept && (
          <>
            <span className={cx(l.kicker, s.kicker)}>
              <Icon name="automation" size={13} className={s.glyph} />
              {t.kicker(project, stage === 'changed')}
            </span>
            <p className={l.title}>{name}</p>
          </>
        )}
        <Prompt
          prompt={prompt}
          kept={kept}
          writing={writing}
          missing={promptMissing}
          t={t}
          {...(onPromptChange === undefined ? {} : { onPromptChange })}
        />
      </div>
      <ol className={l.steps}>
        <Row
          icon="clock"
          label={t.when}
          who={
            <Pick
              label={t.whenMenu}
              value={whenValue}
              options={when}
              {...(onWhenChange === undefined ? {} : { onChange: onWhenChange })}
              {...(onTimeChange === undefined || time === undefined ? {} : { another: t.another, onAnother: () => setAnother(true) })}
            />
          }
          why={whenWas !== undefined ? <Was value={whenWas} t={t} /> : next !== undefined ? t.next(next) : undefined}
        />
        {another && time !== undefined && onTimeChange !== undefined && (
          <AnotherTime
            start={time}
            t={t}
            onCancel={() => setAnother(false)}
            onSet={(chosen) => {
              setAnother(false)
              onTimeChange(chosen)
            }}
          />
        )}
        <Row
          icon="agents"
          label={t.lead}
          who={picker({ role: 'lead', owner: t.leadOwner })}
          why={leadWas === undefined ? undefined : <Was value={leadWas} t={t} />}
        />
        {review !== undefined && (
          <Row
            icon="check"
            label={t.review}
            who={review.on ? picker({ role: 'review', owner: t.reviewOwner }) : <span className={s.none}>{t.none}</span>}
            why={review.was === undefined ? undefined : <Was value={review.was} t={t} />}
            act={
              review.on
                ? review.onSkip !== undefined && (
                    <LinkButton className={l.skip} onClick={review.onSkip}>
                      {t.skip}
                    </LinkButton>
                  )
                : review.onAdd !== undefined && <LinkButton onClick={review.onAdd}>{t.addReviewer}</LinkButton>
            }
          />
        )}
        <Row
          icon="pr"
          label={t.ends}
          who={
            <Pick label={t.endsMenu} value={endsValue} options={ends} {...(onEndsChange === undefined ? {} : { onChange: onEndsChange })} />
          }
          why={endsWas === undefined ? undefined : <Was value={endsWas} t={t} />}
        />
      </ol>
      {limitsShown && limits !== undefined && (
        <div className={s.limits}>
          <KeyValues keyWidth={170} items={limits} />
        </div>
      )}
      {!kept && (
        <div className={l.foot}>
          <span className={l.estimate}>
            {stage === 'proposed' ? t.proposed : holds ? t.holds(next ?? null) : t.again}
            {limits !== undefined && limits.length > 0 && (
              <>
                {' '}
                <LinkButton aria-expanded={limitsShown} onClick={() => setLimitsShown(!limitsShown)}>
                  {limitsShown ? t.hideLimits : t.limits}
                </LinkButton>
              </>
            )}
          </span>
          {stage === 'changed' && onUndo !== undefined && (
            <Button variant="quiet" onClick={onUndo} disabled={busy}>
              {t.undo}
            </Button>
          )}
          {stage === 'proposed' && onTryOnce !== undefined && (
            <Button variant="quiet" onClick={onTryOnce} disabled={busy}>
              {t.tryOnce}
            </Button>
          )}
          {stage === 'changed' && holds
            ? onOpen !== undefined && (
                <Button variant="quiet" onClick={onOpen}>
                  {t.open}
                </Button>
              )
            : onTurnOn !== undefined && (
                <Button onClick={onTurnOn} busy={busy}>
                  {t.turnOn}
                </Button>
              )}
        </div>
      )}
    </div>
  )
}

/* ---- once it is on: a line ----------------------------------------------------------------- */

export interface AutomationNoteText {
  /** After its name: it is on, and when it runs next where that is known. */
  on: (next: string | null) => string
  paused: string
  deleted: string
  open: string
  turnOff: string
  turnOn: string
}

export const automationNoteText: AutomationNoteText = {
  on: (next) => (next === null ? 'is on.' : `is on. It runs next ${next}.`),
  paused: 'is paused.',
  deleted: 'was deleted.',
  open: 'Open in Automations',
  turnOff: 'Turn off',
  turnOn: 'Turn on',
}

export type AutomationNoteProps = RootProps<
  'p',
  {
    name: string
    /** On, paused, or deleted since. */
    state: 'on' | 'paused' | 'deleted'
    /** When it runs next, in words: tomorrow at 9:00. */
    next?: string
    /** Opens it in the project's Automations. */
    onOpen?: () => void
    onTurnOff?: () => void
    onTurnOn?: () => void
    text?: Partial<AutomationNoteText>
  }
>

/** An automation the conversation made, once it is on, paused or deleted: one line, with what can still be done to it. */
export function AutomationNote({ name, state, next, onOpen, onTurnOff, onTurnOn, text, className, ...rest }: AutomationNoteProps) {
  const t = { ...automationNoteText, ...text }
  const words = state === 'on' ? t.on(next ?? null) : state === 'paused' ? t.paused : t.deleted
  return (
    <p className={cx(s.folded, className)} data-rhythm={Rhythm.Fold} {...rest}>
      <Icon name="automation" size={14} className={s.glyph} />
      <span>
        <b className={cx(s.name, state === 'deleted' && s.gone)}>{name}</b> {words}
      </span>
      {state !== 'deleted' && onOpen !== undefined && <LinkButton onClick={onOpen}>{t.open}</LinkButton>}
      {state === 'on' && onTurnOff !== undefined && <LinkButton onClick={onTurnOff}>{t.turnOff}</LinkButton>}
      {state === 'paused' && onTurnOn !== undefined && <LinkButton onClick={onTurnOn}>{t.turnOn}</LinkButton>}
    </p>
  )
}

/* ---- the coordinator asks: resume it, or run it now ----------------------------------------- */

export interface AutomationAskText {
  kicker: (project: string) => string
  resume: (name: ReactNode) => ReactNode
  run: (name: ReactNode) => ReactNode
  resumeButton: string
  runButton: string
  resumed: string
  started: string
}

export const automationAskText: AutomationAskText = {
  kicker: (project) => `Automation · ${project}`,
  resume: (name) => <>Resume {name}?</>,
  run: (name) => <>Run {name} now?</>,
  resumeButton: 'Resume',
  runButton: 'Run now',
  resumed: 'Resumed.',
  started: 'Started a run.',
}

export type AutomationAskProps = RootProps<
  'div',
  {
    name: string
    project: string
    /** What the coordinator asks: to resume it, or to run it once now. Both spend, so the person says. */
    ask: 'resume' | 'run'
    /** When it runs, in words: Every weekday at 9:00. */
    schedule: string
    /** The person said yes: it folds to a line. */
    done: boolean
    onAnswer?: () => void
    /** The answer is on its way. */
    busy?: boolean
    text?: Partial<AutomationAskText>
  }
>

/** The coordinator asking the person to resume an automation or run it now, in its conversation: one button; once said, one line. */
export function AutomationAsk({
  name,
  project,
  ask,
  schedule,
  done,
  onAnswer,
  busy = false,
  text,
  className,
  ...rest
}: AutomationAskProps) {
  const t = { ...automationAskText, ...text }
  // Answered here, focus goes on to the line it folds to.
  const [answered, setAnswered] = useState(false)
  if (done)
    return (
      <AskAnswered
        className={className}
        data-rhythm={Rhythm.Fold}
        said={ask === 'resume' ? t.resumed : t.started}
        focusOnMount={answered}
        {...rest}
      >
        <AskNote>
          {name} · {schedule}
        </AskNote>
      </AskAnswered>
    )
  const named = <b>{name}</b>
  return (
    <AskCard
      icon="automation"
      kicker={t.kicker(project)}
      what={ask === 'resume' ? t.resume(named) : t.run(named)}
      className={className}
      data-rhythm={Rhythm.Card}
      {...rest}
    >
      <p className={s.askWhen}>{schedule}</p>
      {onAnswer !== undefined && (
        <AskFoot>
          <Button
            variant="signal"
            busy={busy}
            onClick={() => {
              setAnswered(true)
              onAnswer()
            }}
          >
            {ask === 'resume' ? t.resumeButton : t.runButton}
          </Button>
        </AskFoot>
      )}
    </AskCard>
  )
}
