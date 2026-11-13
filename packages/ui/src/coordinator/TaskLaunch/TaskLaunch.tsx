import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Brand } from '../../foundations/brands/brands'
import type { ModelInfo } from '../../primitives/Model/Model'
import { TaskEnd, WorksIn } from '../../foundations/vocabulary'
import { taskEndText, type ChoiceWords } from '../../foundations/vocabularyText'
import { useControlled } from '../../lib/controlled'
import { useOnScreen } from '../../lib/onScreen'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { CountdownRing } from '../../primitives/CountdownRing/CountdownRing'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
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
 *
 * It is a roster: a row for each step down a dotted line, a node on the line
 * with the model that does it, and who it is at the row's end. A whole row is
 * its dropdown, opening where it is pressed. It shows from the moment the
 * coordinator begins drafting the task (`drafting`): the rows rise in, the
 * lead's node turns while the brief is written, a node being chosen has an
 * arc going round it with the makers' marks rolling through, and each pick
 * lands as it is made. Only what arrives once the card is on screen moves:
 * a card that mounts already planned, as the drafting one gives way to it or
 * as the thread is opened again, is still.
 */

/** Model makers whose marks roll through a node while its model is chosen. */
const ROLL = [Brand.Anthropic, Brand.OpenAI, Brand.Google, Brand.Alibaba, Brand.Moonshot] as const

/**
 * Whether what mounts now arrives on screen, and moves: true once the card is
 * on screen, or from the start for one drafting. Read once, as each part mounts.
 */
const OnScreen = createContext<{ current: boolean }>({ current: false })
const useArrives = () => {
  const on = useContext(OnScreen)
  const [arrives] = useState(() => on.current)
  return arrives
}

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
  /** How hard its model thinks, as named after the model: High. */
  effort?: string | null
}

export interface LaunchPick {
  step: LaunchStep
  agent: ModelInfo
  /** Which of the step's agents, from 0. */
  k: number
  /** Whose pick it is, for the picker's name: Lead for this task. */
  owner: string
  /**
   * The picker lies unseen over the whole row, which draws who it is: its
   * trigger fills it, and opens where the row was pressed. Pass these on.
   */
  onOpenChange: (open: boolean) => void
  /** For a step that can be skipped: skipping it is in the picker, under this label. */
  skip?: { readonly label: string; readonly onSkip: () => void }
}

/** What drafting is at, while the plan is written: said at its foot, and which row is being chosen. */
export type LaunchPhase = 'writing' | 'sizing' | 'lead' | 'review' | 'end'

/**
 * A plan still being drafted: the card shows as the coordinator writes it.
 * Its steps so far are `steps`, a step whose model isn't chosen yet with no
 * agents; the title is '' until written.
 */
export interface LaunchDrafting {
  readonly phase: LaunchPhase
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
  /** Drafting: the kicker before the preset is known, what it is at, and each row's words while it waits. */
  drafting: string
  phase: Record<LaunchPhase, string>
  choosing: string
  open: string
  deciding: string
  /** Drafting, held: it won't start once planned until it is started. */
  heldDrafting: string
  /** The skip in the picker of a step that can be skipped. */
  skipStep: (step: LaunchStep) => string
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
  drafting: 'Putting a team together',
  phase: { writing: 'Writing the brief', sizing: 'Sizing it', lead: 'Choosing a lead', review: 'Choosing a reviewer', end: 'Almost ready' },
  choosing: 'Choosing…',
  open: 'Open seat',
  deciding: 'Deciding…',
  heldDrafting: 'Held · starts when you say',
  skipStep: (step) => `Skip the ${step.label.toLowerCase()}`,
}

const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const

/** Under the choice of where it works, only what the switch doesn't say: why, where the coordinator said or Local is taken, and what Local waits for. Null for nothing. */
const whereLine = (worksIn: WorksIn, why: string | undefined, taken: string | null, t: TaskLaunchText) => {
  const reason = why ?? (worksIn === WorksIn.Worktree && taken !== null ? t.localTaken(taken) : null)
  const waits = worksIn === WorksIn.Local && taken !== null ? t.localNote(taken) : null
  const lines = [reason === null ? null : reason.replace(/\.?$/, '.'), waits].filter((line) => line !== null)
  return lines.length === 0 ? null : lines.join(' ')
}

/** Words that roll in each time they change, once the card is on screen. */
function Roll({ children }: { children: ReactNode }) {
  const arrives = useArrives()
  return <span className={cx(s.words, arrives && s.roll)}>{children}</span>
}

/** Words for something still going on, a light passing over them. */
const Going = ({ children }: { children: string }) => (
  <Roll>
    <span className={s.going}>{children}</span>
  </Roll>
)

type NodeState = 'idle' | 'next' | 'choosing' | 'filled'

/** A row's node on the line: an empty seat, turning while it's next; an arc going round it while it's chosen; then who it is. */
function Node({ state, mark }: { state: NodeState; mark?: ReactNode }) {
  const [turn, setTurn] = useState(0)
  const rolling = state === 'choosing' && mark === undefined
  useEffect(() => {
    if (!rolling) return
    const id = window.setInterval(() => setTurn((n) => n + 1), 130)
    return () => window.clearInterval(id)
  }, [rolling])
  return (
    <span className={s.node} data-state={state} aria-hidden="true">
      <span className={s.arc} />
      <span className={s.face}>
        {state === 'filled' ? (
          <Landed>{mark}</Landed>
        ) : rolling ? (
          <span key={turn} className={s.reel}>
            <BrandMark brand={ROLL[turn % ROLL.length] ?? Brand.Anthropic} size={20} />
          </span>
        ) : null}
      </span>
      {state === 'filled' && <Pulse />}
    </span>
  )
}
function Landed({ children }: { children: ReactNode }) {
  const arrives = useArrives()
  return <span className={cx(s.mark, arrives && s.land)}>{children}</span>
}
function Pulse() {
  const arrives = useArrives()
  return arrives ? <span className={s.pulse} /> : null
}

/** The dotted line from a row's node to the next one's: running toward a node being chosen, drawn in dark once it's in. */
function Link({ state }: { state: 'idle' | 'flow' | 'done' }) {
  const arrives = useArrives()
  return <span className={cx(s.link, arrives && s.drawn)} data-state={state} aria-hidden="true" />
}

/**
 * A whole row as one dropdown: the trigger of what's put in it lies unseen
 * over the row, and moves under the pointer as it is pressed, so its menu
 * opens there rather than at the row's start; back over the whole row once
 * the menu has gone. The keyboard opens it from the row's start.
 */
function useAtPointer() {
  const [x, setX] = useState<number | null>(null)
  const back = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(back.current), [])
  return {
    style: x === null ? undefined : { left: x - 8, right: 'auto', width: 16 },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      clearTimeout(back.current)
      const row = e.currentTarget.parentElement?.getBoundingClientRect()
      if (row !== undefined) setX(e.clientX - row.left)
    },
    // Back only once the menu has faded (--exit): moving its anchor sooner drags the closing menu along.
    onOpenChange: (open: boolean) => {
      clearTimeout(back.current)
      if (!open) back.current = setTimeout(() => setX(null), 200)
    },
  }
}

/** A row: its node, its name and the line under it, who does it at its end; and, where it can be changed, what changes it, over it all. */
function Row({
  i,
  node,
  link,
  label,
  struck = false,
  under,
  who,
  pick,
  out = false,
}: {
  i: number
  node: ReactNode
  link: 'idle' | 'flow' | 'done' | null
  label: ReactNode
  struck?: boolean
  under?: ReactNode
  who: ReactNode
  /** What changes it, given where the pointer pressed. */
  pick?: (onOpenChange: (open: boolean) => void) => ReactNode
  out?: boolean
}) {
  const arrives = useArrives()
  const at = useAtPointer()
  return (
    <li className={cx(s.item, arrives && s.rises)} style={cssVars({ '--i': i })}>
      {link !== null && <Link state={link} />}
      <div className={cx(s.row, pick !== undefined && s.pickable, out && s.out)}>
        {node}
        <span className={s.lines}>
          <span className={cx(s.label, struck && s.struck)}>{label}</span>
          {under !== undefined && under !== null && <span className={s.under}>{under}</span>}
        </span>
        <span className={s.who}>
          {who}
          {pick !== undefined && <Icon name="chevronD" size={10} className={s.chev} />}
        </span>
        {/* the same shape with or without what changes it, so nothing in the row is made again as the plan comes */}
        {pick === undefined ? null : (
          <span className={s.cover} style={at.style} onPointerDown={at.onPointerDown}>
            {pick(at.onOpenChange)}
          </span>
        )}
      </div>
    </li>
  )
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
  /**
   * Still being drafted: it shows as the coordinator writes it, with no
   * choices yet and Hold its only action. Its end, without `end`, isn't
   * known yet.
   */
  drafting?: LaunchDrafting
  text?: Partial<TaskLaunchText>
}

export function TaskLaunch({
  task,
  preset,
  presets,
  onPresetChange,
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
  drafting,
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
  // What mounts once the card is on screen arrives, and moves; a drafting card's rows arrive with it.
  const onScreen = useRef(drafting !== undefined)
  useEffect(() => {
    onScreen.current = true
  }, [])
  const start = () => {
    if (started || drafting !== undefined) return
    setStarted(true)
    onStart(steps, end)
  }
  const startWhenDue = useEffectEvent(start)

  const seen = useOnScreen(ref, { threshold: 0.9, enabled: !started && drafting === undefined })
  useEffect(() => {
    if (drafting !== undefined || queued !== undefined || startsAt !== undefined || !seen || held || started) return
    /* the last second starts it, so the clock never shows zero */
    const id = window.setTimeout(() => (left <= 1 ? startWhenDue() : setShownFor(left - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [drafting, queued, startsAt, seen, left, held, started])
  useEffect(() => {
    if (drafting !== undefined || startsAt === undefined || held || started || now >= startsAt) return
    /* the kept time: it ticks each second until then; whatever keeps it starts the plan */
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(1000, startsAt - Date.now())))
    return () => window.clearTimeout(id)
  }, [drafting, startsAt, now, held, started])
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
    drafting === undefined &&
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
      className={s.branch}
      {...(t.towardNote === '' ? {} : { note: t.towardNote })}
    />
  )
  const set = (id: string, patch: Partial<LaunchStep>) => setSteps(steps.map((st) => (st.id === id ? { ...st, ...patch } : st)))
  const waiting = steps.filter((st) => st.waits && !st.skipped)
  const where = worksIn === undefined || drafting !== undefined ? null : whereLine(worksIn, worksInWhy, localTaken ?? null, t)

  // A row for each of each step's agents, or one for a step whose agent isn't chosen yet; then how the work ends.
  const phase = drafting?.phase
  const choosingStep = phase === 'lead' ? 0 : phase === 'review' ? 1 : -1
  const rows = steps.flatMap((st, i) =>
    st.agents.length === 0
      ? [{ st, i, k: 0, agent: undefined as ModelInfo | undefined }]
      : st.agents.map((agent, k) => ({ st, i, k, agent: agent as ModelInfo | undefined })),
  )
  const endRow = !hideEnd || picks
  const endKnown = drafting === undefined || endProp !== undefined
  const stateOf = (row: (typeof rows)[number]): NodeState =>
    row.agent !== undefined && !row.st.skipped
      ? 'filled'
      : row.i === choosingStep
        ? 'choosing'
        : row.i === 0 && (phase === 'writing' || phase === 'sizing')
          ? 'next'
          : 'idle'
  const endState: NodeState = endKnown ? 'filled' : phase === 'end' ? 'choosing' : 'idle'
  const states = [...rows.map(stateOf), ...(endRow ? [endState] : [])]
  const linkAt = (n: number) => {
    const next = states[n + 1]
    if (next === undefined) return null
    return next === 'filled' ? 'done' : states[n] === 'filled' && next === 'choosing' ? 'flow' : 'idle'
  }

  return (
    <OnScreen.Provider value={onScreen}>
      <div
        className={cx(s.launch, held && s.held, drafting !== undefined && s.drafting)}
        ref={ref}
        data-rhythm={Rhythm.Card}
        aria-busy={drafting !== undefined}
      >
        <div className={s.head}>
          {(preset !== undefined || from !== undefined || drafting !== undefined) && (
            <span className={s.kicker}>
              {preset === undefined && drafting !== undefined && t.drafting}
              {preset !== undefined &&
                (drafting !== undefined || presets === undefined || presets.length < 2 || onPresetChange === undefined ? (
                  <Roll key={preset}>{preset}</Roll>
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
                  {(preset !== undefined || drafting !== undefined) && ' · '}
                  {t.from} <IssueRef {...from} />
                </>
              )}
            </span>
          )}
          {/* its slug is for whoever looks for it, not a line of its own */}
          <p className={s.title} title={title === '' ? undefined : t.task(task)}>
            {title === '' ? <Skeleton width="58%" height={11} /> : <Roll key={title}>{title}</Roll>}
          </p>
          {worksIn !== undefined && drafting === undefined && (
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
        <ol className={s.roster}>
          {rows.map((row, n) => {
            const { st, i, k, agent } = row
            const state = states[n] ?? 'idle'
            const owner = t.owner(i, st, k)
            const under =
              st.skipped === true ? null : st.waits && limited ? (
                <span className={s.waits}>
                  <Icon name="clock" size={10} />
                  {t.waits(limited.name, limited.until)}
                </span>
              ) : st.fixed !== undefined ? (
                st.fixed
              ) : i === 0 && phase === 'writing' ? (
                <Going key="writing">{`${t.phase.writing}…`}</Going>
              ) : i === 0 && phase === 'sizing' ? (
                <Going key="sizing">{`${t.phase.sizing}…`}</Going>
              ) : null
            const who =
              st.skipped === true ? (
                <Roll key="skipped">
                  <span className={s.faint}>{t.skipped}</span>
                </Roll>
              ) : agent === undefined ? (
                state === 'choosing' ? (
                  <Going key="choosing">{t.choosing}</Going>
                ) : (
                  <Roll key="open">
                    <span className={s.faint}>{t.open}</span>
                  </Roll>
                )
              ) : (
                <Roll key={`${agent.id}-${st.effort ?? ''}`}>
                  {agent.short}
                  {st.effort != null && st.effort !== '' && <span className={s.effort}> {st.effort}</span>}
                </Roll>
              )
            const mark =
              agent?.mark === undefined ? <Icon name="agents" size={16} /> : <BrandMark key={agent.id} brand={agent.mark} size={20} />
            const pick =
              drafting !== undefined || agent === undefined
                ? undefined
                : st.skipped === true
                  ? () => <button type="button" aria-label={`${t.addBack}: ${st.label}`} onClick={() => set(st.id, { skipped: false })} />
                  : (onOpenChange: (open: boolean) => void) =>
                      picker({
                        step: st,
                        agent,
                        k,
                        owner,
                        onOpenChange,
                        ...(st.optional === true && st.fixed === undefined
                          ? { skip: { label: t.skipStep(st), onSkip: () => set(st.id, { skipped: true }) } }
                          : {}),
                      })
            return (
              <Row
                key={`${st.id}-${k}`}
                i={n}
                node={<Node state={st.skipped === true ? 'idle' : state} mark={agent === undefined ? undefined : mark} />}
                link={linkAt(n)}
                label={st.label}
                struck={st.skipped === true}
                under={under}
                who={who}
                out={st.waits === true && st.skipped !== true}
                {...(pick === undefined ? {} : { pick })}
              />
            )
          })}
          {endRow && (
            <Row
              i={rows.length}
              node={<Node state={endState} mark={<Icon name={end === TaskEnd.PushOnly ? 'branch' : 'pr'} size={17} />} />}
              link={null}
              label={hideEnd ? t.toward : t.endLabel}
              who={
                hideEnd ? (
                  branchPick
                ) : !endKnown ? (
                  endState === 'choosing' ? (
                    <Going key="deciding">{t.deciding}</Going>
                  ) : (
                    <Roll key="wait">
                      <span className={s.faint}>…</span>
                    </Roll>
                  )
                ) : (
                  <>
                    <Roll key={end}>{t.end[end].title}</Roll>
                    {picks && (
                      <span className={s.towardIn}>
                        <span className={s.into}>{t.into(end)}</span>
                        {branchPick}
                      </span>
                    )}
                  </>
                )
              }
              {...(drafting !== undefined || hideEnd
                ? {}
                : {
                    pick: (onOpenChange: (open: boolean) => void) => (
                      <Menu
                        label={t.endLabel}
                        width={420}
                        onOpenChange={onOpenChange}
                        trigger={<button type="button" aria-label={`${t.endLabel}: ${t.end[end].title}`} />}
                      >
                        <MenuRadioGroup label={t.endLabel} value={end} onChange={(v) => setEnd(ENDS.find((x) => x === v) ?? end)}>
                          {ENDS.map((x) => (
                            <MenuRadioItem key={x} value={x} hint={x === ruleEnd ? t.ruleNote(project, t.end[x].note) : t.end[x].note}>
                              {t.end[x].title}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </Menu>
                    ),
                  })}
            />
          )}
        </ol>
        {drafting !== undefined ? (
          <div className={s.foot}>
            <span className={s.estimate}>{estimate}</span>
            {held ? (
              <span className={s.when}>{t.heldDrafting}</span>
            ) : (
              <>
                <span className={cx(s.when, s.phase)} aria-live="polite">
                  <LiveDot />
                  <Roll key={drafting.phase}>{t.phase[drafting.phase]}</Roll>
                </span>
                <Button variant="quiet" onClick={() => setHeld(true)}>
                  {t.hold}
                </Button>
              </>
            )}
          </div>
        ) : queued !== undefined && !held ? (
          <div className={s.foot}>
            <span className={s.estimate}>{estimate}</span>
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
    </OnScreen.Provider>
  )
}
