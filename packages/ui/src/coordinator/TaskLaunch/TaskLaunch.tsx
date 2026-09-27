import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { ModelInfo } from '../../foundations/Model/Model'
import { TaskEnd } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { useOnScreen } from '../../lib/onScreen'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { From, type FromProps } from '../Issue/Issue'
import s from './TaskLaunch.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * The plan, before it runs. You hand the coordinator work in plain words; it
 * makes the task and its graph and shows you the plan once, as steps. You get
 * a short while to change who does each step or drop one, then it starts on
 * its own. Nothing here asks you to approve anything: leaving it alone is a
 * yes. The clock runs only while the plan is on screen, since a preview
 * nobody saw is not a preview.
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
  end: Record<TaskEnd, { title: string; note: string; short: string }>
  endLabel: string
  endByRule: (project: string) => string
  /** The note of the ending your rule picks, in the menu. */
  ruleNote: (project: string, note: string) => string
  endThisTask: string
  alsoWaits: (steps: string, until: string) => string
  held: string
  startsIn: (seconds: number) => string
  startsAfterSeen: (seconds: number) => string
  hold: string
  start: string
  startNow: string
}

export const taskLaunchText: TaskLaunchText = {
  task: (task) => `Task ${task}`,
  from: 'from',
  owner: (i, step, k) => (i === 0 ? 'Lead for this task' : step.agents.length > 1 ? `Reviewer ${k + 1} · ${step.label}` : step.label),
  skipped: 'skipped',
  skip: 'Skip',
  addBack: 'Add back',
  waits: (name, until) => `${name} is out; waits until ${until}`,
  end: {
    [TaskEnd.DraftPr]: { title: 'Open a draft PR', note: 'You mark it ready', short: 'Draft PR' },
    [TaskEnd.ReadyPr]: { title: 'Open a PR for review', note: 'Requests the usual reviewers', short: 'PR for review' },
    [TaskEnd.PushOnly]: { title: 'Push the branch only', note: 'No PR; you open it when you want', short: 'Push branch' },
  },
  endLabel: 'When the work is done',
  endByRule: (project) => `by ${project}’s rule`,
  endThisTask: 'this task only',
  ruleNote: (project, note) => `${project}’s rule. ${note}`,
  alsoWaits: (steps, until) => `${steps} waits until ${until}`,
  held: 'Held. Starts when you say',
  startsIn: (n) => `Starts in ${n}s`,
  startsAfterSeen: (n) => `Starts ${n}s after you’ve seen it`,
  hold: 'Hold',
  start: 'Start',
  startNow: 'Start now',
}

const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

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
  from?: FromProps
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
  estimate: string
  /** A runtime that is out, and when it resets. Its steps wait. */
  limited?: { name: string; until: string }
  /** Seconds before it starts on its own, once seen. */
  wait?: number
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
  onStart,
  text,
}: TaskLaunchProps) {
  const t = { ...taskLaunchText, ...text }
  const [steps, setSteps] = useControlled(stepsProp, defaultSteps, onStepsChange)
  const [end, setEnd] = useControlled(endProp, defaultEnd ?? ruleEnd, onEndChange)
  const [left, setLeft] = useState(wait)
  const [held, setHeld] = useState(false)
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const start = () => {
    if (started) return
    setStarted(true)
    onStart(steps, end)
  }
  const startWhenDue = useEffectEvent(start)

  const seen = useOnScreen(ref, { threshold: 0.9, enabled: !started })
  useEffect(() => {
    if (!seen || held || started) return
    /* the last second starts it, so the clock never shows zero */
    const id = window.setTimeout(() => (left <= 1 ? startWhenDue() : setLeft(left - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [seen, left, held, started])

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
              · {t.from} <From {...from} />
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
              {st.skipped ? (
                t.skipped
              ) : st.waits && limited ? (
                <>
                  <Icon name="clock" size={10} />
                  {t.waits(limited.name, limited.until)}
                </>
              ) : (
                st.why
              )}
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
        <li className={cx(s.step, s.end)}>
          <span className={s.n}>{steps.length + 1}</span>
          <Menu
            label={t.endLabel}
            width={320}
            trigger={
              <button type="button" className={s.pick}>
                <span className={s.label}>{t.end[end].title}</span>
                <Icon name="chevronD" size={9} />
              </button>
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
      </ol>
      <div className={s.foot}>
        <span className={s.estimate}>
          {estimate}
          {waiting.length > 0 && limited && <> · {t.alsoWaits(waiting.map((st) => st.label).join(', '), limited.until)}</>}
        </span>
        {!held && <Ring left={left / wait} />}
        <span className={s.when} aria-live="off">
          {held ? t.held : seen ? t.startsIn(left) : t.startsAfterSeen(left)}
        </span>
        {!held && (
          <Button variant="quiet" onClick={() => setHeld(true)}>
            {t.hold}
          </Button>
        )}
        <Button onClick={start}>{held ? t.start : t.startNow}</Button>
        {!held && <i className={s.bar} style={cssVars({ '--left': left / wait })} aria-hidden="true" />}
      </div>
    </div>
  )
}
