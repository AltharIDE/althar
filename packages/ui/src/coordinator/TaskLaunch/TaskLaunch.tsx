import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { ModelInfo } from '../../foundations/Model/Model'
import { TaskEnd } from '../../foundations/vocabulary'
import { taskEndText, type ChoiceWords } from '../../foundations/vocabularyText'
import { useControlled } from '../../lib/controlled'
import { useOnScreen } from '../../lib/onScreen'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { IssueRef, type IssueRefProps } from '../Issue/Issue'
import s from './TaskLaunch.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * The plan, before it runs. You hand the coordinator work in plain words; it
 * makes the task and its graph and shows you the plan once, as steps. You get
 * a short while to change who does each step or drop one, then it starts on
 * its own. Nothing here asks you to approve anything: leaving it alone is a
 * yes. The clock runs only while the plan is on screen, since a preview
 * nobody saw is not a preview; unless something else keeps it, like a
 * runtime that starts the plan at a set time whether or not a window is
 * open, and then the card shows that time as it comes.
 */

export interface LaunchStep {
  id: string
  label: string
  /** Who runs it: one agent, or several for a parallel review. */
  agents: readonly ModelInfo[]
  /** Why it is in the plan. */
  why?: string
  /** It can be skipped. */
  optional?: boolean
  /** Why it cannot be changed, in place of Skip: required by your rule. */
  fixed?: string
  skipped?: boolean
  /** Its runtime is out, so it waits for the reset. */
  waits?: boolean
}

export interface LaunchPick {
  step: LaunchStep
  agent: ModelInfo
  /** Which of the step's agents, from 0. */
  k: number
  /** Whose pick it is, for the picker's name: Lead for this task. */
  owner: string
}

export interface TaskLaunchText {
  task: (task: string) => string
  from: string
  owner: (stepIndex: number, step: LaunchStep, k: number) => string
  skipped: string
  skip: string
  addBack: string
  /** Why a step waits: whose runtime is out, until when. */
  waits: (name: string, until: string) => string
  /** Each ending: in the menu, its note there, and its name as the last step of the running task. */
  end: Record<TaskEnd, ChoiceWords & { short: string }>
  endLabel: string
  endByRule: (project: string) => string
  /** The note of the ending your rule picks, in the menu. */
  ruleNote: (project: string, note: string) => string
  endThisTask: string
  alsoWaits: (steps: string, until: string) => string
  held: string
  startsIn: (seconds: number) => string
  startsAfterSeen: (seconds: number) => string
  /** Said once to a screen reader when the plan is first seen: that it starts on its own. */
  announce: (seconds: number) => string
  hold: string
  start: string
  startNow: string
}

export const taskLaunchText: TaskLaunchText = {
  task: (task) => `Task ${task}`,
  from: 'from',
  owner: (i, step, k) => {
    if (i === 0) return 'Lead for this task'
    if (step.agents.length > 1) return `Reviewer ${k + 1} · ${step.label}`
    return step.label
  },
  skipped: 'skipped',
  skip: 'Skip',
  addBack: 'Add back',
  waits: (name, until) => `${name} is out; waits until ${until}`,
  end: taskEndText,
  endLabel: 'When the work is done',
  endByRule: (project) => `by ${project}’s rule`,
  endThisTask: 'this task only',
  ruleNote: (project, note) => `${project}’s rule. ${note}`,
  alsoWaits: (steps, until) => `${steps} waits until ${until}`,
  held: 'Held. Starts when you say',
  startsIn: (n) => `Starts in ${n}s`,
  startsAfterSeen: (n) => `Starts ${n}s after you’ve seen it`,
  announce: (n) => `The plan starts on its own in ${n} seconds. Hold it to take your time.`,
  hold: 'Hold',
  start: 'Start',
  startNow: 'Start now',
}

const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

/** Why a step is in the plan, or why it is not running as planned. */
function Why({ step, limited, t }: { step: LaunchStep; limited?: { name: string; until: string }; t: TaskLaunchText }) {
  if (step.skipped) return t.skipped
  if (step.waits && limited)
    return (
      <>
        <Icon name="clock" size={10} />
        {t.waits(limited.name, limited.until)}
      </>
    )
  return step.why ?? null
}

/** The countdown as a ring that empties. */
function Ring({ left }: { left: number }) {
  const r = 6.5
  const c = 2 * Math.PI * r
  return (
    <svg className={s.ring} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} className={s.ringBg} />
      <circle cx="8" cy="8" r={r} className={s.ringFg} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - left) }} />
    </svg>
  )
}

export interface TaskLaunchProps {
  task: string
  title: string
  from?: IssueRefProps
  steps?: readonly LaunchStep[]
  defaultSteps?: readonly LaunchStep[]
  onStepsChange?: (steps: readonly LaunchStep[]) => void
  /** Who runs a step: the consumer's model picker, for one of its agents. */
  picker: (pick: LaunchPick) => ReactNode
  end?: TaskEnd
  defaultEnd?: TaskEnd
  onEndChange?: (end: TaskEnd) => void
  /** What the project's rule says a task does when it is done. */
  ruleEnd?: TaskEnd
  project: string
  /** Time and cost, in a line. */
  estimate?: string
  /** A runtime that is out, and when it resets. Its steps wait. */
  limited?: { name: string; until: string }
  /** Seconds before it starts on its own, once seen: the whole wait, when `startsAt` keeps the time. */
  wait?: number
  /** When it starts, in milliseconds since the epoch, when something else keeps the clock: it counts down to then, seen or not. */
  startsAt?: number
  /** Held: the clock stops until you start it. */
  held?: boolean
  defaultHeld?: boolean
  onHeldChange?: (held: boolean) => void
  /** No row for what happens when the work is done, where tasks end on their branch. */
  hideEnd?: boolean
  /** Start it: now, or when the time runs out. With what it will do when done. */
  onStart: (steps: readonly LaunchStep[], end: TaskEnd) => void
  text?: Partial<TaskLaunchText>
}

export function TaskLaunch({
  task,
  title,
  from,
  steps: stepsProp,
  defaultSteps = [],
  onStepsChange,
  picker,
  end: endProp,
  defaultEnd,
  onEndChange,
  ruleEnd = TaskEnd.DraftPr,
  project,
  estimate,
  limited,
  wait = 30,
  startsAt,
  held: heldProp,
  defaultHeld = false,
  onHeldChange,
  hideEnd = false,
  onStart,
  text,
}: TaskLaunchProps) {
  const t = { ...taskLaunchText, ...text }
  const [steps, setSteps] = useControlled(stepsProp, defaultSteps, onStepsChange)
  const [end, setEnd] = useControlled(endProp, defaultEnd ?? ruleEnd, onEndChange)
  const [shownFor, setShownFor] = useState(wait)
  const [held, setHeld] = useControlled(heldProp, defaultHeld, onHeldChange)
  const [started, setStarted] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const left = startsAt === undefined ? shownFor : Math.max(0, Math.ceil((startsAt - now) / 1000))
  const ref = useRef<HTMLDivElement>(null)
  const start = () => {
    if (started) return
    setStarted(true)
    onStart(steps, end)
  }
  const startWhenDue = useEffectEvent(start)

  const seen = useOnScreen(ref, { threshold: 0.9, enabled: !started })
  useEffect(() => {
    if (startsAt !== undefined || !seen || held || started) return
    /* the last second starts it, so the clock never shows zero */
    const id = window.setTimeout(() => (left <= 1 ? startWhenDue() : setShownFor(left - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [startsAt, seen, left, held, started])
  useEffect(() => {
    if (startsAt === undefined || held || started) return
    /* the kept time: it ticks on the second before it, and starts it when it comes */
    const id = window.setTimeout(
      () => (Date.now() >= startsAt - 1000 ? startWhenDue() : setNow(Date.now())),
      Math.max(0, Math.min(1000, startsAt - 1000 - Date.now())),
    )
    return () => window.clearTimeout(id)
  }, [startsAt, now, held, started])

  const [announced, setAnnounced] = useState(false)
  if (seen && !announced) setAnnounced(true)
  const when = (() => {
    if (held) return t.held
    if (seen || startsAt !== undefined) return t.startsIn(left)
    return t.startsAfterSeen(left)
  })()
  const share = Math.min(1, left / wait)

  const set = (id: string, patch: Partial<LaunchStep>) => setSteps(steps.map((st) => (st.id === id ? { ...st, ...patch } : st)))
  const waiting = steps.filter((st) => st.waits && !st.skipped)

  return (
    <div className={cx(s.launch, held && s.held)} ref={ref} data-rhythm={Rhythm.Card}>
      <div className={s.head}>
        <span className={s.kicker}>
          {t.task(task)}
          {from && (
            <>
              {' '}
              · {t.from} <IssueRef {...from} />
            </>
          )}
        </span>
        <p className={s.title}>{title}</p>
      </div>
      <ol className={s.steps}>
        {steps.map((st, i) => (
          <li key={st.id} className={cx(s.step, st.skipped && s.skipped, st.waits && !st.skipped && s.out)}>
            <span className={s.n}>{i + 1}</span>
            <span className={s.label}>{st.label}</span>
            <span className={s.who}>
              {st.agents.map((agent, k) => (
                <Fragment key={`${agent.id}${k}`}>
                  {k > 0 && <span className={s.plus}>+</span>}
                  {picker({ step: st, agent, k, owner: t.owner(i, st, k) })}
                </Fragment>
              ))}
            </span>
            <span className={s.why}>
              <Why step={st} limited={limited} t={t} />
            </span>
            <span className={s.act}>
              {st.fixed ? (
                <span className={s.fixed}>{st.fixed}</span>
              ) : (
                st.optional && (
                  <LinkButton className={s.skip} onClick={() => set(st.id, { skipped: !st.skipped })}>
                    {st.skipped ? t.addBack : t.skip}
                  </LinkButton>
                )
              )}
            </span>
          </li>
        ))}
        {!hideEnd && (
          <li className={cx(s.step, s.end)}>
            <span className={s.n}>{steps.length + 1}</span>
            <Menu
              label={t.endLabel}
              width={320}
              trigger={
                <ActionButton className={s.pick} trailingIcon="chevronD">
                  {t.end[end].title}
                </ActionButton>
              }
            >
              <MenuRadioGroup label={t.endLabel} value={end} onChange={(v) => setEnd(ENDS.find((x) => x === v) ?? end)}>
                {ENDS.map((x) => (
                  <MenuRadioItem key={x} value={x} hint={x === ruleEnd ? t.ruleNote(project, t.end[x].note) : t.end[x].note}>
                    {t.end[x].title}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </Menu>
            <span className={s.why}>{end === ruleEnd ? t.endByRule(project) : t.endThisTask}</span>
          </li>
        )}
      </ol>
      <div className={s.foot}>
        <span className={s.estimate}>
          {estimate}
          {waiting.length > 0 && limited && <> · {t.alsoWaits(waiting.map((st) => st.label).join(', '), limited.until)}</>}
        </span>
        {!held && <Ring left={share} />}
        {/* the countdown is not read out each second; that it starts on its own is said once, when it is first seen */}
        <span className={s.when}>{when}</span>
        <span aria-live="polite">{announced && !held && !started && <VisuallyHidden>{t.announce(wait)}</VisuallyHidden>}</span>
        {!held && (
          <Button variant="quiet" onClick={() => setHeld(true)}>
            {t.hold}
          </Button>
        )}
        <Button onClick={start}>{held ? t.start : t.startNow}</Button>
        {!held && <i className={s.bar} style={cssVars({ '--left': share })} aria-hidden="true" />}
      </div>
    </div>
  )
}
