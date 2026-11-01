import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { device } from '../../foundations/device'
import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { keys, modKey } from '../../foundations/keys'
import { Light } from '../../foundations/Light/Light'
import { RuntimeState, TaskStatus } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { RepositoryPick, type RepositoryChoice, type RepositoryPickText } from '../../setup/RepositoryPick/RepositoryPick'
import { Runtimes, type RuntimeEntry, type RuntimesProps, type RuntimesText } from '../../setup/Runtimes/Runtimes'
import { AgentsScene, CallsScene, ReviewScene, TaskScene, type SceneProps } from './scenes'
import { Station } from './Station'
import s from './Welcome.module.css'

/*
 * The first thing Althar shows, before there is a project: one card, the
 * same size on every step, with a track of its steps along its head.
 *
 * It opens on a short tour, a page for each of what Althar does: you ask
 * the coordinator, agents from different makers build, only the calls come
 * to you, and the work is reviewed before you see it. Each page plays a
 * scene made of the real components, with notes pinned to its parts. Skip
 * leaves the tour for the setup; once the tour has been seen it is left out.
 *
 * Then the setup, one thing a step: the agents on this computer, signed in
 * or not, with the one thing each needs; the first project, the
 * repositories found ticked into it, or a folder added; where its code is,
 * for pull requests; and a tracker, for issues. Only the project is needed:
 * a project can be made with no agent ready, and the code host and the
 * tracker can wait. The project is made on its step, so the last two steps
 * know where its code is; the last step opens it.
 *
 * Return presses the step's main button, which takes the focus as each step
 * arrives; the arrows walk the tour. With reduced motion, or `still`, every
 * scene arrives finished.
 */

/** Where the welcome is: the tour's four pages, then the setup's four steps. */
export type WelcomeStep = 'ask' | 'build' | 'decide' | 'review' | 'agents' | 'project' | 'code' | 'issues'

type TourStep = 'ask' | 'build' | 'decide' | 'review'
const TOUR: readonly TourStep[] = ['ask', 'build', 'decide', 'review']
const SETUP: readonly WelcomeStep[] = ['agents', 'project', 'code', 'issues']
const SCENES: Record<TourStep, ComponentType<SceneProps>> = { ask: TaskScene, build: AgentsScene, decide: CallsScene, review: ReviewScene }

export interface WelcomePageText {
  /** Its name on the track. */
  label: string
  title: string
  body: string
}

export interface WelcomeText {
  name: string
  /** Over the tour's first page. */
  greeting: string
  /** The track, read out. */
  steps: string
  skip: string
  back: string
  next: string
  /** The tour's last page goes on to the setup. */
  setUp: string
  tour: Record<TourStep, WelcomePageText>
  agents: { label: string; title: string; line: string; list: string; asking: string; go: string; without: string }
  project: {
    label: string
    title: string
    line: string
    over: string
    name: string
    make: string
    makeKbd: string
    /** Make the project, with nothing ticked. */
    nothing: string
  }
  code: { label: string; title: string; line: string; go: string; notNow: string }
  issues: { label: string; title: string; line: string; open: (project: string) => string; theProject: string }
  /** The live region, as each step arrives. */
  arrived: (n: number, of: number, title: string) => string
}

export const welcomeText: WelcomeText = {
  name: 'Althar',
  greeting: 'Welcome to Althar',
  steps: 'Steps',
  skip: 'Skip',
  back: 'Back',
  next: 'Next',
  setUp: 'Set up Althar',
  tour: {
    ask: {
      label: 'Ask',
      title: 'Tell the coordinator what you want',
      body: 'It plans the work into tasks and gives each one an agent to lead it. It writes no code itself.',
    },
    build: {
      label: 'Build',
      title: 'Agents from different makers',
      body: 'Claude Code, Codex, OpenCode and others, each signed in as you on your own plan. One task can use several at once.',
    },
    decide: {
      label: 'Decide',
      title: 'Only the calls come to you',
      body: 'Tasks move across the board on their own. What only you can decide waits under Needs you.',
    },
    review: {
      label: 'Review',
      title: 'Reviewed before you see it',
      body: 'Before its pull request opens, an agent from another maker reviews the change. The lead fixes what holds and says why it keeps the rest, and the pull request carries the review.',
    },
  },
  agents: {
    label: 'Agents',
    title: 'Your agents',
    line: 'Althar runs the agents you already use, on your own plans. One signed in is enough to start.',
    list: `Agents on ${device.this}`,
    asking: 'Asking the agents',
    go: 'Continue',
    without: 'Continue without one',
  },
  project: {
    label: 'Project',
    title: 'Your first project',
    line: 'One repository or several. Each task works on a copy of its own, so these folders stay as they are.',
    over: 'Let go to add it',
    name: 'Project name',
    make: 'Make the project',
    makeKbd: modKey(keys.return),
    nothing: 'Tick a repository, or add a folder.',
  },
  code: {
    label: 'Code',
    title: 'Pull requests',
    line: 'So tasks can open pull requests and read their checks.',
    go: 'Continue',
    notNow: 'Not now',
  },
  issues: {
    label: 'Issues',
    title: 'Issues',
    line: 'Hand the coordinator an issue, and its task links back to it.',
    open: (project) => `Open ${project}`,
    theProject: 'the project',
  },
  arrived: (n, of, title) => `Step ${n} of ${of}: ${title}`,
}

export interface WelcomeProps extends Pick<RuntimesProps, 'onSignIn' | 'onCancel' | 'onCheck' | 'onHelp' | 'onInstall'> {
  /** The step on show. */
  step?: WelcomeStep
  defaultStep?: WelcomeStep
  onStepChange?: (step: WelcomeStep) => void
  /** The tour has been seen: the welcome starts at the agents, and its track leaves the tour out. */
  toured?: boolean
  /** The tour is over, finished or skipped. */
  onToured?: () => void
  /** The agents, as each answered; null while they are still being asked. */
  runtimes: readonly RuntimeEntry[] | null
  /** The agents' rows' own words, such as what this computer is called. */
  runtimesText?: Partial<RuntimesText>
  /** The repositories found, and any added; null while they are still being looked for. */
  repositories: readonly RepositoryChoice[] | null
  /** The repositories ticked, by id. */
  picked: readonly string[]
  onPick: (id: string) => void
  /** Asks for a folder to add. */
  onAdd: () => void
  /** Folders dropped on the window, on the project's step. Without it, a drop does nothing. */
  onDrop?: (files: readonly File[]) => void
  repositoryText?: Partial<RepositoryPickText>
  /** The project's name as it stands. */
  name: string
  onNameChange: (name: string) => void
  /** Makes the project of what is ticked. */
  onCreate: () => void
  creating?: boolean
  /** The project is made: the welcome goes on to its code, and the steps before can't be gone back to. */
  made?: boolean
  /** What went wrong, said on the step it belongs to: the agents', or the project's. */
  error?: { readonly step: 'agents' | 'project'; readonly said: ReactNode }
  /** The code hosts, to connect one: the consumer's list, and its walk in. */
  hosts: ReactNode
  /** A code host is connected: the code's step goes on with Continue, not Not now. */
  hostConnected?: boolean
  /** The trackers, to connect one, the same way. */
  trackers: ReactNode
  /** Opens the project, on the last step. */
  onOpen: () => void
  /** One quiet line in the card's foot on the agents' step, such as crash reports with their switch. */
  foot?: ReactNode
  /** Every scene arrives finished: for stills. Reduced motion does the same. */
  still?: boolean
  className?: string
  text?: Partial<WelcomeText>
}

/** The first run: a short tour of what Althar does, then the agents, the first project, its code host and a tracker. */
export function Welcome({
  step: stepProp,
  defaultStep,
  onStepChange,
  toured = false,
  onToured,
  runtimes,
  runtimesText,
  repositories,
  picked,
  onPick,
  onAdd,
  onDrop,
  repositoryText,
  name,
  onNameChange,
  onCreate,
  creating = false,
  made = false,
  error,
  hosts,
  hostConnected = false,
  trackers,
  onOpen,
  foot,
  still = false,
  className,
  text,
  ...rows
}: WelcomeProps) {
  const t = { ...welcomeText, ...text }
  const steps: readonly WelcomeStep[] = toured ? SETUP : [...TOUR, ...SETUP]
  const [chosen, setStep] = useControlled<WelcomeStep>(stepProp, defaultStep ?? steps[0] ?? 'agents', onStepChange)
  const step: WelcomeStep = steps.includes(chosen) ? chosen : (steps[0] ?? 'agents')
  const at = steps.indexOf(step)
  const touring = isTour(step)
  const instant = useReducedMotion() || still
  const [nothing, setNothing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const nameId = useId()
  const { over, handlers } = useDragOver(step === 'project' ? onDrop : undefined)

  const go = (to: WelcomeStep) => {
    if (isTour(step) && !isTour(to)) onToured?.()
    setNothing(false)
    setStep(to)
  }
  const next = () => {
    const to = steps[at + 1]
    if (to !== undefined) go(to)
  }
  const previous = steps[at - 1]
  // Once the project is made, the steps up to it are done with.
  const canGoBack = previous !== undefined && !(made && (previous === 'project' || steps.indexOf(previous) < steps.indexOf('project')))

  // Made, the welcome goes on to where its code is.
  useEffect(() => {
    if (made && step === 'project') setStep('code')
  }, [made, step, setStep])

  // Each step's main button takes the focus as the step arrives, so Return goes on.
  useLayoutEffect(() => {
    primary.current?.focus({ preventScroll: true })
  }, [step])

  // The arrows walk the tour while focus is in the welcome, not anywhere on the page it sits in.
  useEffect(() => {
    const el = root.current
    if (!el || !touring) return
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const to = event.key === 'ArrowRight' ? steps[at + 1] : event.key === 'ArrowLeft' ? steps[at - 1] : undefined
      if (to === undefined) return
      event.preventDefault()
      go(to)
    }
    el.addEventListener('keydown', key)
    return () => el.removeEventListener('keydown', key)
  })

  const label = (one: WelcomeStep) => (isTour(one) ? t.tour[one].label : t[one].label)
  const ready = runtimes?.filter((r) => r.state === RuntimeState.Ready).length ?? 0
  const make = () => {
    if (picked.length === 0) return setNothing(true)
    setNothing(false)
    onCreate()
  }
  const main = mainOf(step, { t, ready, hostConnected, name, next, make, onOpen, creating })
  const title = isTour(step) ? t.tour[step].title : step === 'project' && over ? t.project.over : t[step].title

  return (
    <div ref={root} className={cx(s.welcome, over && s.over, className)} {...handlers}>
      <div className={s.field} aria-hidden="true">
        <Light height={0.5} motion={instant ? 'still' : 'drift'} />
      </div>
      <section className={s.card} aria-labelledby={titleId}>
        <header className={s.head}>
          <span className={s.brand}>
            <HalftoneMark size={26} rise={false} />
            {t.name}
          </span>
          <StepTrack
            steps={trackOf(steps.map(label), at)}
            status={TaskStatus.Running}
            labels
            className={s.track}
            text={{ label: t.steps }}
          />
          {touring ? (
            <LinkButton className={s.skip} onClick={() => go('agents')}>
              {t.skip}
            </LinkButton>
          ) : (
            <span className={s.skip} aria-hidden="true" />
          )}
        </header>

        <div key={step} className={cx(s.body, !instant && s.arrive)}>
          {isTour(step) ? (
            <div className={s.tour}>
              <SceneFrame scene={SCENES[step]} instant={instant} label={t.tour[step].label} />
              <div className={s.words}>
                {at === 0 && <span className={s.greeting}>{t.greeting}</span>}
                <h1 id={titleId} className={s.title}>
                  {title}
                </h1>
                <p className={s.line}>{t.tour[step].body}</p>
              </div>
            </div>
          ) : (
            <>
              <div className={s.words}>
                <h1 id={titleId} className={s.title}>
                  {title}
                </h1>
                <p className={s.line}>{t[step].line}</p>
              </div>
              {step === 'agents' &&
                (runtimes === null ? (
                  <div className={s.waiting} aria-label={t.agents.asking} aria-busy="true">
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                  </div>
                ) : (
                  <Runtimes
                    label={t.agents.list}
                    runtimes={runtimes}
                    {...rows}
                    {...(runtimesText === undefined ? {} : { text: runtimesText })}
                  />
                ))}
              {step === 'project' && (
                <>
                  <RepositoryPick
                    repositories={repositories}
                    picked={picked}
                    onPick={(id) => {
                      setNothing(false)
                      onPick(id)
                    }}
                    onAdd={onAdd}
                    {...(repositoryText === undefined ? {} : { text: repositoryText })}
                  />
                  {nothing && (
                    <p className={s.error} role="alert">
                      {t.project.nothing}
                    </p>
                  )}
                  {picked.length > 0 && (
                    <div className={s.named}>
                      <label htmlFor={nameId} className={s.namedLabel}>
                        {t.project.name}
                      </label>
                      <Field id={nameId} value={name} onChange={(event) => onNameChange(event.target.value)} spellCheck={false} />
                    </div>
                  )}
                </>
              )}
              {step === 'code' && hosts}
              {step === 'issues' && trackers}
              {error !== undefined && error.step === step && (
                <div className={s.error} role="alert">
                  {error.said}
                </div>
              )}
            </>
          )}
        </div>

        <footer className={s.foot}>
          {canGoBack && previous !== undefined && <LinkButton onClick={() => go(previous)}>{t.back}</LinkButton>}
          {step === 'agents' && foot !== undefined && <div className={s.footLine}>{foot}</div>}
          <span className={s.grow} />
          <Button
            ref={primary}
            variant={main.quiet ? 'default' : 'signal'}
            busy={main.busy}
            {...(main.kbd === undefined ? {} : { kbd: main.kbd })}
            onClick={main.act}
          >
            {main.label}
          </Button>
        </footer>
      </section>
      <VisuallyHidden>
        <span aria-live="polite">{t.arrived(at + 1, steps.length, title)}</span>
      </VisuallyHidden>
    </div>
  )
}

const isTour = (step: WelcomeStep): step is TourStep => (TOUR as readonly string[]).includes(step)

interface Main {
  readonly label: string
  readonly act: () => void
  /** The lesser choice: going on without what the step offers. */
  readonly quiet?: boolean
  readonly busy?: boolean
  readonly kbd?: string
}

/** A step's main button: what it says, and what it does. */
function mainOf(
  step: WelcomeStep,
  w: {
    readonly t: WelcomeText
    readonly ready: number
    readonly hostConnected: boolean
    readonly name: string
    readonly next: () => void
    readonly make: () => void
    readonly onOpen: () => void
    readonly creating: boolean
  },
): Main {
  switch (step) {
    case 'ask':
    case 'build':
    case 'decide':
      return { label: w.t.next, act: w.next }
    case 'review':
      return { label: w.t.setUp, act: w.next }
    case 'agents':
      return w.ready > 0 ? { label: w.t.agents.go, act: w.next } : { label: w.t.agents.without, act: w.next, quiet: true }
    case 'project':
      return { label: w.t.project.make, act: w.make, busy: w.creating, kbd: w.t.project.makeKbd }
    case 'code':
      return w.hostConnected ? { label: w.t.code.go, act: w.next } : { label: w.t.code.notNow, act: w.next, quiet: true }
    case 'issues':
      return { label: w.t.issues.open(w.name.trim() === '' ? w.t.issues.theProject : w.name.trim()), act: w.onOpen }
  }
}

/** Room round a scene for the notes that point into it from outside: more at the sides, where the long ones reach. */
const ROOM = { side: 200, end: 72 }

/** A scene, playing, scaled to fit its frame on the drafting table's dots. */
function SceneFrame({ scene: Scene, instant, label }: { scene: ComponentType<SceneProps>; instant: boolean; label: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number; room: { w: number; h: number } } | null>(null)
  useLayoutEffect(() => {
    const box = frame.current
    const station = box?.querySelector<HTMLElement>('[data-stop]')
    if (!box || !station) return
    const measure = () => setSize({ w: station.offsetWidth, h: station.offsetHeight, room: { w: box.clientWidth, h: box.clientHeight } })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(station)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const w = (size?.w ?? 0) + ROOM.side * 2
  const h = (size?.h ?? 0) + ROOM.end * 2
  const k = size === null || size.w === 0 ? 1 : Math.min(1, (size.room.w - 24) / w, (size.room.h - 16) / h)
  return (
    <div ref={frame} className={s.frame} aria-hidden="true">
      <div
        className={s.stage}
        style={{ width: w, height: h, transform: `translate(-50%, -50%) scale(${k})`, opacity: size === null ? 0 : 1 }}
      >
        <Station n={1} label={label} x={ROOM.side} y={ROOM.end} shown built instant={instant} bare>
          <Scene live={!instant} instant={instant} />
        </Station>
      </div>
    </div>
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const q = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}
