import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useMemo, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'
import { createRoot } from 'react-dom/client'

import { Icon, LiveDot, StepTrack, TaskFace, TaskStatus, Thread, ThreadDivider, ThreadShellProvider, TrackStep } from '@althar/ui'

import { afterStep, keptNote, type SaidStep, stepNote, type StepNote, why } from '../../../../packages/runtime/src/errandNotes'
import { ServicesProvider } from '../../src/renderer/data/services'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { ago, useNow } from '../../src/renderer/shared/time'
import { servicesFor } from '../../tests/render'
import { fakeClient, fakeHost, items } from '../../tests/fixtures'
import s from './lab.module.css'

/*
 * The errand lab: how a kept errand reads in the coordinator's thread. The
 * person's words and the coordinator's answer are the app's own thread; the
 * errand's line under them is each direction. Letters swap the direction
 * (0 is today's line), numbers where the errand stands.
 */

const ASKED = 'Once 0.9.0 is ready and on prs, merge for me then tag'
const PR = '#958'
const TAG = 'v0.9.0'
const PR_URL = 'https://github.com/AltharIDE/althar/pull/958'
const TAG_URL = 'https://github.com/AltharIDE/althar/releases/tag/v0.9.0'
const HOLD = 'you asked to wait for the changelog'

const directions = [
  { key: 'today', kbd: '0', label: 'Today' },
  { key: 'a', kbd: 'A', label: 'Calm lines (built)' },
  { key: 'b', kbd: 'B', label: 'Checklist' },
  { key: 'c', kbd: 'C', label: 'Track' },
] as const
type Direction = (typeof directions)[number]['key']

const stands = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'checks', label: 'Checks running' },
  { key: 'partway', label: 'Partway' },
  { key: 'done', label: 'Done' },
  { key: 'paused', label: 'Paused' },
] as const
type Stand = (typeof stands)[number]['key']

type StepState = 'waiting' | 'now' | 'done' | 'next' | 'held'
interface Step {
  /** What it does, in plain words. */
  readonly what: string
  /** What it waits for, before it can. */
  readonly waits: string
  /** Where it stands, where it has something to say. */
  readonly now: string | null
  readonly state: StepState
}

/** The errand's two steps, wherever it stands. The pull request is named once it exists. */
const stepsAt = (stand: Stand): ReadonlyArray<Step> => {
  const merge = stand === 'waiting' ? 'Merge the 0.9.0 pull request' : `Merge ${PR}`
  switch (stand) {
    case 'waiting':
      return [
        { what: merge, waits: 'once it’s open and its checks pass', now: 'Waiting for it to open', state: 'waiting' },
        { what: `Tag ${TAG}`, waits: 'once it’s merged', now: null, state: 'next' },
      ]
    case 'checks':
      return [
        { what: merge, waits: 'once its checks pass', now: 'Checks running', state: 'waiting' },
        { what: `Tag ${TAG}`, waits: 'once it’s merged', now: null, state: 'next' },
      ]
    case 'partway':
      return [
        { what: `Merged ${PR}`, waits: '', now: null, state: 'done' },
        { what: `Tag ${TAG}`, waits: '', now: 'Tagging', state: 'now' },
      ]
    case 'done':
      return [
        { what: `Merged ${PR}`, waits: '', now: null, state: 'done' },
        { what: `Tagged ${TAG}`, waits: '', now: null, state: 'done' },
      ]
    case 'paused':
      return [
        { what: merge, waits: 'once its checks pass', now: null, state: 'held' },
        { what: `Tag ${TAG}`, waits: 'once it’s merged', now: null, state: 'next' },
      ]
  }
}

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

const services = servicesFor(fakeClient().client, fakeHost())
const shell = {}
const session = { agentId: 'claude-code', model: 'opus', account: null }

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()
let sequence = 0
const placed = (item: ThreadItem, minutes: number): ThreadItem => {
  sequence += 1
  return { ...item, id: `errand${sequence}`, sequence, createdAt: minutesAgo(minutes) }
}

/** Today's line, as `Errands.ts` builds it. */
const RAW =
  'Kept an errand: "Once 0.9.0 is ready and on prs, merge for me then tag". merge pull request AltharIDE/althar pull request from althar/release-prep-althar-0-9-0; waits on pull_request_opened althar/release-prep-althar-0-9-0, checks_passed althar/release-prep-althar-0-9-0; tag release AltharIDE/althar v0.9.0; waits on merged althar/release-prep-althar-0-9-0.'

const runtime = (title: string, minutes: number) => placed(items.notice({ source: 'runtime', title }, null), minutes)

/** The person's ask and the coordinator's answer: the same in every direction. */
const ASK = [
  placed(items.you(ASKED), 42),
  placed(items.says('I’ll merge the 0.9.0 pull request once it’s up and green, then tag v0.9.0.', 'claude-code'), 41),
]

/** The step notes that come today as each step goes (#901), one short line each. */
const notesAt = (stand: Stand): ReadonlyArray<ThreadItem> =>
  stand === 'partway' ? [runtime(`Merged ${PR}`, 3)] : stand === 'done' ? [runtime(`Merged ${PR}`, 3), runtime(`Tagged ${TAG}`, 2)] : []

function Blocks({ of }: { of: ReadonlyArray<ThreadItem> }) {
  const now = useNow(true)
  const blocks = blocksOf({ items: of, turnRunning: false, turnStarted: null, turnEnded: null, worktree: null }, new Map(), ago, now)
  return <ThreadBlocks blocks={blocks} threadId="coordinator" session={session} />
}

/* ---------- A: calm lines, as notes come today ---------- */

/**
 * The kept line says the ask once, in words, its own words folded under it; each step's note after (#901) says where it
 * stands now. Nothing changes in place: the last line is where it is.
 */
const MERGE: SaidStep = {
  tool: 'merge_pull_request',
  target: PR_URL,
  says: 'Merge the 0.9.0 pull request',
  waits: [
    { kind: 'pull_request_opened', says: 'it’s open' },
    { kind: 'checks_passed', says: 'its checks pass' },
  ],
}
const TAG_STEP: SaidStep = { tool: 'push_tag', target: `AltharIDE/althar ${TAG}`, says: `Tag ${TAG}`, waits: [{ kind: 'merged' }] }

/** A line as the runtime says it (Errands.ts), from the runtime's own words for it (errandNotes.ts). */
const noted = (note: StepNote, minutes: number) =>
  placed(items.notice({ source: 'runtime', title: note.title, links: note.links, details: note.details } as never, null), minutes)

const keptA = (minutes: number) => noted(keptNote(ASKED, [MERGE, TAG_STEP]), minutes)

const notesA = (stand: Stand): ReadonlyArray<ThreadItem> => {
  const merged = afterStep(stepNote('merge_pull_request', PR_URL, {}, JSON.stringify({ status: 200, body: { merged: true } })), TAG_STEP)
  switch (stand) {
    case 'waiting':
    case 'checks':
      return []
    case 'partway':
      return [noted(merged, 3)]
    case 'done':
      return [noted(merged, 3), noted(afterStep(stepNote('push_tag', TAG_STEP.target, {}, `Tagged ${TAG}`), undefined), 2)]
    case 'paused':
      return [runtime(`Errand on hold: ${why(HOLD)}`, 5)]
  }
}

/* ---------- B: a checklist that ticks ---------- */

function Mark({ state }: { state: StepState }) {
  switch (state) {
    case 'done':
      return <Icon name="check" size={11} />
    case 'now':
      return <LiveDot pulse />
    case 'waiting':
      return <Icon name="clock" size={11} />
    case 'held':
      return <Icon name="pause" size={11} />
    case 'next':
      return <span className={s.ring} />
  }
}

/** The ask in their words, then each step with what it waits for and where it stands; once all are done it folds to a line. */
function Checklist({ stand }: { stand: Stand }) {
  const steps = stepsAt(stand)
  if (stand === 'done')
    return (
      <ThreadDivider icon="agents">
        Errand done: merged <a href={PR_URL}>{PR}</a> and tagged <a href={TAG_URL}>{TAG}</a>
      </ThreadDivider>
    )
  return (
    <div className={s.errand}>
      <ThreadDivider icon="agents">
        {stand === 'paused' ? 'Errand on hold: ' : 'Errand: '}
        <q className={s.asked}>{ASKED}</q>
      </ThreadDivider>
      <ol className={s.steps}>
        {steps.map((step) => (
          <li key={step.what} className={s[step.state]}>
            <span className={s.mark}>
              <Mark state={step.state} />
            </span>
            <span className={s.what}>{step.what}</span>
            {step.waits !== '' && <span className={s.waits}>{step.waits}</span>}
            {step.now !== null && <span className={s.stand}>· {step.now}</span>}
          </li>
        ))}
      </ol>
      {stand === 'paused' && <p className={s.hold}>You asked to wait for the changelog.</p>}
    </div>
  )
}

/* ---------- C: the task's own step track ---------- */

const TRACK: Record<StepState, TrackStep> = {
  done: TrackStep.Done,
  now: TrackStep.Now,
  waiting: TrackStep.Now,
  held: TrackStep.Now,
  next: TrackStep.Next,
}
const STATUS: Record<Stand, TaskStatus> = {
  waiting: TaskStatus.Queued,
  checks: TaskStatus.Running,
  partway: TaskStatus.Running,
  done: TaskStatus.Done,
  paused: TaskStatus.Paused,
}
const SENTENCE: Record<Stand, string> = {
  waiting: 'Waiting for the 0.9.0 pull request to open. Merges it once checks pass, then tags v0.9.0.',
  checks: `Waiting for ${PR}’s checks. Merges it once they pass, then tags v0.9.0.`,
  partway: `Merged ${PR}. Tagging v0.9.0 now.`,
  done: `Merged ${PR} and tagged v0.9.0.`,
  paused: `On hold before merging ${PR}: ${HOLD}.`,
}

/** The ask, a bar for each step as a task's card draws its own, and one sentence for where it stands. */
function Track({ stand }: { stand: Stand }) {
  const steps = stepsAt(stand)
  return (
    <div className={s.errand}>
      <ThreadDivider icon="agents">
        Errand: <q className={s.asked}>{ASKED}</q>
      </ThreadDivider>
      <div className={s.track}>
        <StepTrack
          labels
          status={STATUS[stand]}
          steps={steps.map((step, at) => ({
            label: at === 0 ? `Merge ${stand === 'waiting' ? 'the 0.9.0 PR' : PR}` : `Tag ${TAG}`,
            state: TRACK[step.state],
          }))}
        />
        <p className={s.sentence}>{SENTENCE[stand]}</p>
      </div>
    </div>
  )
}

function Face({ children }: { children: ReactNode }) {
  return (
    <TaskFace className={s.face} composer={<div className={s.composer}>Ask the coordinator</div>}>
      <Thread label="Coordinator">
        <ThreadShellProvider value={shell}>{children}</ThreadShellProvider>
      </Thread>
    </TaskFace>
  )
}

function Scene({ direction, stand }: { direction: Direction; stand: Stand }) {
  const notes = useMemo(() => notesAt(stand), [stand])
  if (direction === 'today') return <Blocks of={[...ASK, runtime(RAW, 41), ...notes]} />
  if (direction === 'a') return <Blocks of={[...ASK, keptA(41), ...notesA(stand)]} />
  return (
    <>
      <Blocks of={ASK} />
      <div className={s.kept}>
        {direction === 'b' && <Checklist stand={stand} />}
        {direction === 'c' && <Track stand={stand} />}
      </div>
    </>
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>((params.get('d') as Direction | null) ?? 'a')
  const [stand, setStand] = useState<Stand>((params.get('s') as Stand | null) ?? 'waiting')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const way = directions.find((one) => one.kbd.toLowerCase() === event.key.toLowerCase())
      if (way !== undefined) return setDirection(way.key)
      const at = stands[Number(event.key) - 1]
      if (at !== undefined) setStand(at.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('s', stand)
    history.replaceState(null, '', url)
  }, [direction, stand])
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        <Face>
          <Scene direction={direction} stand={stand} />
        </Face>
      </main>
      <nav className={s.bar} aria-label="Directions and states">
        {directions.map((one) => (
          <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => setDirection(one.key)}>
            <kbd>{one.kbd}</kbd> {one.label}
          </button>
        ))}
        <span className={s.gap} />
        {stands.map((one, index) => (
          <button key={one.key} type="button" aria-pressed={stand === one.key} onClick={() => setStand(one.key)}>
            <kbd>{index + 1}</kbd> {one.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Lab />
      </ServicesProvider>
    </StrictMode>,
  )
