import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { ModelInfo } from '../../primitives/Model/Model'
import { TaskEnd, WorksIn } from '../../foundations/vocabulary'
import { taskEndText, type ChoiceWords } from '../../foundations/vocabularyText'
import { useControlled } from '../../lib/controlled'
import { useOnScreen } from '../../lib/onScreen'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { CountdownRing } from '../../primitives/CountdownRing/CountdownRing'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { BranchSelect } from '../../primitives/BranchSelect/BranchSelect'
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
  /** The list of presets the kicker's first word opens, to start from another. */
  presets: string
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
  /** The note of the ending your rule picks, in the menu. */
  ruleNote: (project: string, note: string) => string
  alsoWaits: (steps: string, until: string) => string
  held: string
  startsIn: (seconds: number) => string
  /** Its time has come, and what keeps its clock is starting it. */
  starting: string
  startsAfterSeen: (seconds: number) => string
  /** Said once to a screen reader when the plan is first seen: that it starts on its own. */
  announce: (seconds: number) => string
  hold: string
  start: string
  startNow: string
  /** Where it works (ADR-091): the choice's name, and each place. */
  worksIn: string
  local: string
  worktree: string
  /** What each gives up, in its option's tooltip, not as a line under the choice. */
  localTip: string
  worktreeTip: string
  /** Under the choice, where it says something the switch doesn't: Local, while another task works there, what it waits for. */
  localNote: (taken: string) => string
  /** Planned in a worktree while another task works Local: why, where the coordinator didn't say. */
  localTaken: (taken: string) => string
  /** The branch its work goes into (ADR-093): the picker's name, the word before it after how the work ends, and a line under its list. */
  toward: string
  into: (end: TaskEnd) => string
  towardNote: string
}

export const taskLaunchText: TaskLaunchText = {
  task: (task) => `Task ${task}`,
  presets: 'Start from',
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
  ruleNote: (project, note) => `${project}’s rule. ${note}`,
  alsoWaits: (steps, until) => `${steps} waits until ${until}`,
  held: 'Held',
  startsIn: (n) => `Starts in ${n}s`,
  starting: 'Starting…',
  startsAfterSeen: (n) => `Starts ${n}s after you’ve seen it`,
  announce: (n) => `Starts in ${n} seconds`,
  hold: 'Hold',
  start: 'Start',
  startNow: 'Start now',
  worksIn: 'Works in',
  local: 'Local',
  worktree: 'Worktree',
  localTip: 'One task at a time; your own edits share it.',
  worktreeTip: 'Side by side with other tasks. Builds from cold.',
  localNote: (taken) => `Waits for ${taken}.`,
  localTaken: (taken) => `Local is taken by ${taken}.`,
  toward: 'Works toward',
  into: (end) => (end === TaskEnd.PushOnly ? 'toward' : 'into'),
  towardNote: 'This task only. The project’s branch is beside Run.',
}

const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

/** Why a step is not running as planned: skipped, or waiting for a runtime to reset. */
function Why({ step, limited, t }: { step: LaunchStep; limited?: { name: string; until: string }; t: TaskLaunchText }) {
  if (step.skipped) return t.skipped
  if (step.waits && limited)
    return (
      <>
        <Icon name="clock" size={10} />
        {t.waits(limited.name, limited.until)}
      </>
    )
  return null
}

/** Under the choice of where it works, only what the switch doesn't say: why, where the coordinator said or Local is taken, and what Local waits for. Null for nothing. */
const whereLine = (worksIn: WorksIn, why: string | undefined, taken: string | null, t: TaskLaunchText) => {
  const reason = why ?? (worksIn === WorksIn.Worktree && taken !== null ? t.localTaken(taken) : null)
  const waits = worksIn === WorksIn.Local && taken !== null ? t.localNote(taken) : null
  const lines = [reason === null ? null : reason.replace(/\.?$/, '.'), waits].filter((line) => line !== null)
  return lines.length === 0 ? null : lines.join(' ')
}

export interface TaskLaunchProps {
  task: string
  /** The preset its parts are (a task is a conversation plus parts), the kicker's first word: Change, Chat. */
  preset?: string
  /** The presets it can start from instead, each with what it holds: a press on the kicker's first word lists them. */
  presets?: readonly { name: string; about: string }[]
  /** Picks another preset: its parts become the plan's. */
  onPresetChange?: (name: string) => void
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
  /** When it starts, in milliseconds since the epoch, when something else keeps the clock and starts it: it counts down to then, seen or not, and then says it is starting. */
  startsAt?: number
  /** Held: the clock stops until you start it. */
  held?: boolean
  /**
   * Started, it waits for a free agent (ADR-032): what it waits for, said
   * where the clock was. Its steps can still be changed, and it can be held,
   * which takes it out of the line until it is started.
   */
  queued?: string
  defaultHeld?: boolean
  onHeldChange?: (held: boolean) => void
  /** No row for what happens when the work is done, where tasks end on their branch. */
  hideEnd?: boolean
  /**
   * Where it works (ADR-091): Local, in the person's own checkout, or a
   * worktree of its own, beside the title, changeable until its first step
   * starts. No choice without it, as for a review, which reads a copy.
   */
  worksIn?: WorksIn
  onWorksInChange?: (worksIn: WorksIn) => void
  /** Why it works there, in the coordinator's words, where that isn't the project's default. */
  worksInWhy?: string
  /** The task working Local now, by its title, which it would wait for there. */
  localTaken?: string
  /**
   * The branch its work goes into (ADR-093): it starts from it, and its pull
   * request goes into it. In the last row, after how the work ends, a list
   * of the remote's `branches`, changeable until its first step starts; none
   * with only one.
   */
  toward?: string
  /** The repository's default branch, which the list says so of. */
  defaultBranch?: string
  /** The remote's branches, the default first. */
  branches?: readonly string[]
  onTowardChange?: (branch: string) => void
  /** Makes a branch its list doesn't have, from the default branch, for it to work toward; without it, only one listed. */
  onCreateBranch?: (branch: string) => void
  /** Start it: now, or when the time runs out. With what it will do when done. */
  onStart: (steps: readonly LaunchStep[], end: TaskEnd) => void
  /** Something offered about the task, quiet in the foot after the estimate, below Start: keeping its parts as a preset. */
  footNote?: ReactNode
  text?: Partial<TaskLaunchText>
}

export function TaskLaunch({
  task,
  preset,
  presets,
  onPresetChange,
  footNote,
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
  queued,
  defaultHeld = false,
  onHeldChange,
  hideEnd = false,
  worksIn,
  onWorksInChange,
  worksInWhy,
  localTaken,
  toward,
  defaultBranch,
  branches = [],
  onTowardChange,
  onCreateBranch,
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
    if (queued !== undefined || startsAt !== undefined || !seen || held || started) return
    /* the last second starts it, so the clock never shows zero */
    const id = window.setTimeout(() => (left <= 1 ? startWhenDue() : setShownFor(left - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [queued, startsAt, seen, left, held, started])
  useEffect(() => {
    if (startsAt === undefined || held || started || now >= startsAt) return
    /* the kept time: it ticks each second until then; whatever keeps it starts the plan */
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(1000, startsAt - Date.now())))
    return () => window.clearTimeout(id)
  }, [startsAt, now, held, started])
  const due = startsAt !== undefined && !held && now >= startsAt

  const [announced, setAnnounced] = useState(false)
  if (seen && !announced) setAnnounced(true)
  const when = (() => {
    if (held) return t.held
    if (due) return t.starting
    if (seen || startsAt !== undefined) return t.startsIn(left)
    return t.startsAfterSeen(left)
  })()
  const share = Math.min(1, left / wait)

  // A choice of branch where the remote has more than one, where one can be made, or where it already goes elsewhere.
  const picks =
    onTowardChange !== undefined &&
    (branches.length > 1 || (onCreateBranch !== undefined && branches.length > 0) || (toward !== undefined && toward !== defaultBranch))
  // The branch, beside how the work ends, looking as that choice does: Open a draft PR into release/0.8.0.
  const branchPick = picks && (
    <BranchSelect
      label={t.toward}
      value={toward ?? defaultBranch ?? branches[0] ?? ''}
      branches={branches}
      {...(defaultBranch === undefined ? {} : { defaultBranch })}
      onChange={(next) => onTowardChange?.(next)}
      {...(onCreateBranch === undefined ? {} : { onCreate: onCreateBranch })}
      variant="bare"
      className={cx(s.pick, s.branch)}
      {...(t.towardNote === '' ? {} : { note: t.towardNote })}
    />
  )
  const branch = picks && (
    <span className={s.towardIn}>
      <span className={s.into}>{t.into(end)}</span>
      {branchPick}
    </span>
  )
  const set = (id: string, patch: Partial<LaunchStep>) => setSteps(steps.map((st) => (st.id === id ? { ...st, ...patch } : st)))
  const waiting = steps.filter((st) => st.waits && !st.skipped)
  const where = worksIn === undefined ? null : whereLine(worksIn, worksInWhy, localTaken ?? null, t)

  return (
    <div className={cx(s.launch, held && s.held)} ref={ref} data-rhythm={Rhythm.Card}>
      <div className={s.head}>
        {(preset !== undefined || from !== undefined) && (
          <span className={s.kicker}>
            {preset !== undefined &&
              (presets === undefined || presets.length < 2 || onPresetChange === undefined ? (
                preset
              ) : (
                <Menu
                  label={t.presets}
                  width={320}
                  trigger={
                    <button type="button" className={s.preset}>
                      {preset}
                      <Icon name="chevronD" size={9} />
                    </button>
                  }
                >
                  <MenuRadioGroup label={t.presets} value={preset} onChange={onPresetChange}>
                    {presets.map((one) => (
                      <MenuRadioItem key={one.name} value={one.name} description={one.about}>
                        {one.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </Menu>
              ))}
            {from && (
              <>
                {preset !== undefined && ' · '}
                {t.from} <IssueRef {...from} />
              </>
            )}
          </span>
        )}
        {/* its slug is for whoever looks for it, not a line of its own */}
        <p className={s.title} title={t.task(task)}>
          {title}
        </p>
        {worksIn !== undefined && (
          <div className={s.where}>
            <Segmented<WorksIn>
              label={t.worksIn}
              value={worksIn}
              onChange={(next) => onWorksInChange?.(next)}
              options={[
                { value: WorksIn.Local, label: t.local, tooltip: { label: t.localTip } },
                { value: WorksIn.Worktree, label: t.worktree, tooltip: { label: t.worktreeTip } },
              ]}
            />
          </div>
        )}
        {where !== null && <p className={s.whereLine}>{where}</p>}
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
            {branch}
          </li>
        )}
        {hideEnd && picks && (
          <li className={cx(s.step, s.end, s.toward)}>
            <span className={s.n} />
            <span className={s.into}>{t.toward}</span>
            {branchPick}
          </li>
        )}
      </ol>
      {queued !== undefined && !held ? (
        <div className={s.foot}>
          <span className={s.estimate}>
            {estimate}
            {estimate !== undefined && footNote !== undefined && ' · '}
            {footNote}
          </span>
          <span className={s.when} role="status">
            {queued}
          </span>
          <Button variant="quiet" onClick={() => setHeld(true)}>
            {t.hold}
          </Button>
        </div>
      ) : (
        <div className={s.foot}>
          <span className={s.estimate}>
            {estimate}
            {waiting.length > 0 && limited && <> · {t.alsoWaits(waiting.map((st) => st.label).join(', '), limited.until)}</>}
            {(estimate !== undefined || (waiting.length > 0 && limited)) && footNote !== undefined && ' · '}
            {footNote}
          </span>
          {!held && <CountdownRing left={share} />}
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
      )}
    </div>
  )
}
