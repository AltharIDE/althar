import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

import { device } from '../../foundations/device'
import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { keys, modKey } from '../../foundations/keys'
import { Light } from '../../foundations/Light/Light'
import { BrandMark } from '../../foundations/Marks/Marks'
import { RuntimeState, TaskStatus } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { AgentsAway, type AgentsAwayText } from '../../setup/AgentsAway/AgentsAway'
import { RepositoryPick, type RepositoryChoice, type RepositoryPickText } from '../../setup/RepositoryPick/RepositoryPick'
import { Runtimes, type RuntimeEntry, type RuntimesProps, type RuntimesText } from '../../setup/Runtimes/Runtimes'
import { CoordinatorScene, MakersScene, ProjectScene, ReviewScene, type SceneProps } from './scenes'
import { Station } from './Station'
import s from './Welcome.module.css'

/*
 * The first thing Althar shows, before there is a project: one card, the
 * same size on every step, with a track of its steps along its head.
 *
 * It opens on a short tour, a page for each of what is new here: work
 * happens in projects, of one repository or several, each task on a copy of
 * its own; you tell the project's coordinator what you want, and it plans;
 * agents from different makers do the work and review each other's, every
 * agent Althar runs named by its mark; and the change is reviewed before you
 * see it. Each page plays a scene made of the real components, at its real
 * size where the window allows. Skip leaves the tour for the setup; once the
 * tour has been seen it is left out.
 *
 * Then the setup, one thing a step: the agents on this computer, signed in
 * or not, with the one thing each needs, and those it could have; the first
 * project, of a folder chosen or the repositories found, found by typing;
 * where its code is, for pull requests; and a tracker, for issues. Only the
 * project is needed: a project can be made with no agent ready, and the code
 * host and the tracker can wait. The project is made on its step, so the
 * last two steps know where its code is; the last step opens it.
 *
 * Return presses the step's main button, which takes the focus as each step
 * arrives; on the project's, the field that finds a repository takes it, and
 * Return ticks what it found. The arrows walk the tour. With reduced motion,
 * or `still`, every scene arrives finished.
 */

/** Where the welcome is: the tour's four pages, then the setup's four steps. */
export type WelcomeStep = 'projects' | 'coordinator' | 'makers' | 'review' | 'agents' | 'project' | 'code' | 'issues'

type TourStep = 'projects' | 'coordinator' | 'makers' | 'review'
const TOUR: readonly TourStep[] = ['projects', 'coordinator', 'makers', 'review']
const SETUP: readonly WelcomeStep[] = ['agents', 'project', 'code', 'issues']
const SCENES: Record<TourStep, ComponentType<SceneProps>> = {
  projects: ProjectScene,
  coordinator: CoordinatorScene,
  makers: MakersScene,
  review: ReviewScene,
}

export interface WelcomePageText {
  /** Its name on the track. */
  label: string
  title: string
  body: string
}

export interface WelcomeText {
  name: string
  /** The track, read out. */
  steps: string
  skip: string
  back: string
  next: string
  /** The tour's last page goes on to the setup. */
  setUp: string
  tour: Record<TourStep, WelcomePageText>
  /** Every agent Althar runs, a mark each on the makers' page, read out. */
  makers: string
  agents: {
    label: string
    title: string
    line: string
    /** Over the agents on this computer. */
    here: string
    list: string
    asking: string
    /** None on this computer, with those it could have under it. */
    noneHere: string
    /** None at all: none here, and none offered. */
    noneAtAll: string
    /** Asks the agents again, after their list couldn't be read. */
    retry: string
    go: string
    without: string
  }
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
  steps: 'Steps',
  skip: 'Skip',
  back: 'Back',
  next: 'Next',
  setUp: 'Set up Althar',
  tour: {
    projects: {
      label: 'Projects',
      title: 'Work happens in projects',
      body: 'One repository or several, with its own coordinator, board, rules and notes. Each task works on its own branch, in a copy of its own, so your folders stay as they are.',
    },
    coordinator: {
      label: 'Coordinator',
      title: 'Meet the coordinator',
      body: 'Tell it what you want done. It plans the work into tasks, gives each an agent to lead it, and brings you only what needs your decision. It writes no code itself.',
    },
    makers: {
      label: 'Makers',
      title: 'Agents from different makers',
      body: 'The agents you already use, each signed in as you, on your own plan. One leads a task, and another maker’s agent reviews its work.',
    },
    review: {
      label: 'Review',
      title: 'Reviewed before you see it',
      body: 'Each change ends in a pull request that carries its review. Merging it stays yours.',
    },
  },
  makers: 'The agents Althar runs',
  agents: {
    label: 'Agents',
    title: 'Your agents',
    line: 'Althar runs the agents you already use, on your own plans. One signed in is enough to start.',
    here: `On ${device.this}`,
    list: `Agents on ${device.this}`,
    asking: 'Asking the agents',
    noneHere: 'None yet: download one below, or install one yourself.',
    noneAtAll: 'None found.',
    retry: 'Check again',
    go: 'Continue',
    without: 'Continue without one',
  },
  project: {
    label: 'Project',
    title: 'Your first project',
    line: 'One repository or several. More can be added later, in its settings.',
    over: 'Let go to add it',
    name: 'Project name',
    make: 'Make the project',
    makeKbd: modKey(keys.return),
    nothing: 'Tick a repository, or choose a folder.',
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
  /** Every agent Althar runs, as each answered; null while they are still being asked. Their marks are the makers' page's too. */
  runtimes: readonly RuntimeEntry[] | null
  /** The agents' rows' own words, such as what this computer is called. */
  runtimesText?: Partial<RuntimesText>
  /** The tiles' own words, for the agents not on this computer. */
  awayText?: Partial<AgentsAwayText>
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
  /** Asks the agents again, after their list couldn't be read: beside the agents' error. */
  onRecheck?: () => void
  /** The code hosts, to connect one: the consumer's list, and its walk in. */
  hosts: ReactNode
  /** A code host is connected: the code's step goes on with Continue, not Not now. */
  hostConnected?: boolean
  /** The trackers, to connect one, the same way. Without them, where none can be connected, there is no step for issues. */
  trackers?: ReactNode
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
  awayText,
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
  onRecheck,
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
  const setup = trackers === undefined ? SETUP.filter((one) => one !== 'issues') : SETUP
  const steps: readonly WelcomeStep[] = toured ? setup : [...TOUR, ...setup]
  const [chosen, setStep] = useControlled<WelcomeStep>(stepProp, defaultStep ?? steps[0] ?? 'agents', onStepChange)
  const step: WelcomeStep = steps.includes(chosen) ? chosen : (steps[0] ?? 'agents')
  const at = steps.indexOf(step)
  const touring = isTour(step)
  const instant = useReducedMotion() || still
  const [nothingTicked, setNothing] = useState(false)
  // Said only while nothing is ticked: a folder added, ticked, answers it.
  const nothing = nothingTicked && picked.length === 0
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

  // Each step's main button takes the focus as the step arrives, so Return goes on; the project's step is about finding a
  // repository, so its field takes it, where there are any to find.
  useLayoutEffect(() => {
    const find = step === 'project' ? root.current?.querySelector<HTMLInputElement>('input[type="search"]:not(:disabled)') : null
    ;(find ?? primary.current)?.focus({ preventScroll: true })
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
  // On this computer, a row each, with who it is signed in as; the others, quieter, a tile each.
  const isAway = (r: RuntimeEntry) => r.state === RuntimeState.Missing || r.state === RuntimeState.Installing
  const here = runtimes?.filter((r) => !isAway(r)) ?? []
  const away = runtimes?.filter(isAway) ?? []
  const said = error !== undefined && error.step === step ? error.said : null
  // With none here and an error, it isn't that none were found: the error stands where they would be, with the way to ask again.
  const unread = said !== null && step === 'agents' && runtimes !== null && here.length === 0
  const problem = (banner: boolean) => (
    <Problem
      as="div"
      banner={banner}
      {...(step === 'agents' && onRecheck !== undefined
        ? {
            action: (
              <Button size="small" onClick={onRecheck}>
                {t.agents.retry}
              </Button>
            ),
          }
        : {})}
    >
      {said}
    </Problem>
  )
  const make = () => {
    if (picked.length === 0) return setNothing(true)
    setNothing(false)
    onCreate()
  }
  const main = mainOf(step, { t, ready, hostConnected, name, next, make, onOpen, creating, last: at === steps.length - 1 })
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
          <div className={s.words}>
            <h1 id={titleId} className={s.title}>
              {title}
            </h1>
            <p className={s.line}>{isTour(step) ? t.tour[step].body : t[step].line}</p>
            {step === 'makers' && <Makers runtimes={runtimes} label={t.makers} />}
          </div>
          {isTour(step) && <SceneFit scene={SCENES[step]} instant={instant} />}
          {step === 'agents' &&
            (runtimes === null ? (
              <div className={s.waiting} aria-label={t.agents.asking} aria-busy="true">
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
              </div>
            ) : (
              <div className={s.agents}>
                <section className={s.here} aria-labelledby={`${titleId}-here`}>
                  <h2 id={`${titleId}-here`} className={s.section}>
                    {t.agents.here}
                  </h2>
                  {here.length > 0 ? (
                    <Runtimes
                      label={t.agents.list}
                      runtimes={here}
                      {...rows}
                      {...(runtimesText === undefined ? {} : { text: runtimesText })}
                    />
                  ) : unread ? (
                    problem(true)
                  ) : (
                    <p className={s.none}>{away.length > 0 ? t.agents.noneHere : t.agents.noneAtAll}</p>
                  )}
                </section>
                <AgentsAway
                  agents={away}
                  {...(rows.onInstall === undefined ? {} : { onInstall: rows.onInstall })}
                  {...(rows.onHelp === undefined ? {} : { onHelp: rows.onHelp })}
                  {...(awayText === undefined ? {} : { text: awayText })}
                />
              </div>
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
              {nothing && <Problem>{t.project.nothing}</Problem>}
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
          {said !== null && !unread && problem(false)}
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
        <VisuallyHidden>
          <span aria-live="polite">{t.arrived(at + 1, steps.length, title)}</span>
        </VisuallyHidden>
      </section>
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
    /** The last step: it opens the project. */
    readonly last: boolean
  },
): Main {
  const open = { label: w.t.issues.open(w.name.trim() === '' ? w.t.issues.theProject : w.name.trim()), act: w.onOpen }
  switch (step) {
    case 'projects':
    case 'coordinator':
    case 'makers':
      return { label: w.t.next, act: w.next }
    case 'review':
      return { label: w.t.setUp, act: w.next }
    case 'agents':
      return w.ready > 0 ? { label: w.t.agents.go, act: w.next } : { label: w.t.agents.without, act: w.next, quiet: true }
    case 'project':
      return { label: w.t.project.make, act: w.make, busy: w.creating, kbd: w.t.project.makeKbd }
    case 'code':
      if (w.last) return open
      return w.hostConnected ? { label: w.t.code.go, act: w.next } : { label: w.t.code.notNow, act: w.next, quiet: true }
    case 'issues':
      return open
  }
}

/**
 * Every agent Althar runs, a mark each, as the runtime lists them, its name
 * on hover and read out. Its line is held while the agents are still asked,
 * so the page doesn't move when they answer.
 */
function Makers({ runtimes, label }: { runtimes: readonly RuntimeEntry[] | null; label: string }) {
  return (
    <ul className={s.makers} aria-label={label}>
      {runtimes?.map((r) => (
        <li key={r.id}>
          <Tooltip label={r.name} placement="below">
            <span className={s.maker} role="img" aria-label={r.name}>
              {r.brand === undefined ? <span className={s.makerName}>{r.name}</span> : <BrandMark brand={r.brand} size={18} />}
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}

/** Room round a scene, so it never meets its frame's edge. */
const PAD = 12

/** A scene, playing, as large as its frame lets it be and never larger than itself, on the drafting table's dots. */
function SceneFit({ scene: Scene, instant }: { scene: ComponentType<SceneProps>; instant: boolean }) {
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
  const k = size === null || size.w === 0 ? 1 : Math.min(1, (size.room.w - PAD * 2) / size.w, (size.room.h - PAD * 2) / size.h)
  return (
    <div ref={frame} className={s.frame} aria-hidden="true">
      <div
        className={s.stage}
        style={{
          width: size?.w ?? 0,
          height: size?.h ?? 0,
          transform: `translate(-50%, -50%) scale(${k})`,
          opacity: size === null ? 0 : 1,
        }}
      >
        <Station instant={instant}>
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
