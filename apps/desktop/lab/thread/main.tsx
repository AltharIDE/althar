import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useMemo, useState } from 'react'

import type { TaskFinding, TaskFindings } from '@althar/contracts'
import { createRoot } from 'react-dom/client'

import { Delivery, TaskFace, Thread, ThreadShellProvider } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { latestReport, reviewsIn, useReviewOutcomes } from '../../src/renderer/features/task/reviewOutcomes'
import { TaskThread } from '../../src/renderer/features/task/TaskThread'
import { roundsOf } from '../../src/renderer/shared/rounds'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { ago, useNow } from '../../src/renderer/shared/time'
import { servicesFor } from '../../tests/render'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { type Beat, usePlayed } from './play'
import {
  at,
  CODEX_THOUGHT,
  COORDINATOR_ANSWER,
  LEAD,
  LEAD_MODEL,
  LIVE_ANSWER,
  LIVE_THOUGHT,
  LONG_ANSWER,
  longTask,
  REQUEST,
  WORKTREE,
} from './thread'
import s from './lab.module.css'

/*
 * The thread lab (README.md): the app's own threads, with no runtime. Keys
 * 1–4, or the bar along the bottom, swap the scene; ?theme=dark draws it
 * dark. What each frame took is kept on window.lab for a script to read.
 */

const scenes = [
  { key: 'task', label: 'Long task, finished' },
  { key: 'live', label: 'Task, live' },
  { key: 'coordinator', label: 'Coordinator, live' },
  { key: 'three', label: 'Three streaming' },
] as const
type Scene = (typeof scenes)[number]['key']

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

// Every frame's time, from the first: what the page's script reads.
const frames: Array<number> = []
declare global {
  interface Window {
    lab: { frames: Array<number>; reset: () => void }
  }
}
window.lab = { frames, reset: () => void frames.splice(0) }
let last = performance.now()
const tick = (now: number) => {
  frames.push(now - last)
  last = now
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/** The long task's thread, once for the page: what its reviews found is read by its items' ids. */
const TASK = longTask()

/** What became of each review's findings: the lead fixed two of the first's and set one aside, and fixed the second's. */
const SETTLED: ReadonlyArray<ReadonlyArray<TaskFinding['state']>> = [['fixed', 'fixed', 'set_aside'], ['fixed']]

const getTaskFindings = async (_taskId: string, review?: string): Promise<TaskFindings> => {
  const reviews = TASK.flatMap((item) => (item.kind === 'step_result' && item.content.step === 'review' ? [item] : []))
  const asked = reviews.findIndex((item) => item.id === review)
  const item = reviews[asked]
  if (item?.kind !== 'step_result') return { findings: [], review: null }
  return {
    review: item.id,
    findings: item.content.findings.map((finding, at) => ({
      id: `${item.id}-${at}`,
      review: item.id,
      round: item.content.round,
      severity: finding.severity,
      title: finding.title ?? null,
      claim: finding.claim,
      file: finding.file,
      line: finding.line,
      at: null,
      state: SETTLED[asked]?.[at] ?? 'open',
      reason: null,
      commit: null,
    })),
  }
}

const services = servicesFor(fakeClient({ getTaskFindings }).client, fakeHost())
const shell = {}
const session = { agentId: LEAD, model: LEAD_MODEL, account: null }
const request = {
  kind: 'you' as const,
  id: 'request',
  text: REQUEST,
  at: ago(at(0)),
  delivery: Delivery.Delivered,
  links: [],
  pictures: [],
  files: [],
}

const leadBeats: ReadonlyArray<Beat> = [
  { say: 'I’ll check what the merge line reads back when Althar starts, and keep the wait in the store if it reads nothing.' },
  { tool: 'Read MergeLine.ts', kind: 'read', path: `${WORKTREE}/packages/runtime/src/MergeLine.ts`, ms: 700 },
  { think: LIVE_THOUGHT },
  { tool: 'Read schema.sql', kind: 'read', path: `${WORKTREE}/packages/persistence-sqlite/schema.sql`, ms: 600 },
  { tool: 'grep -rn "change_polls" packages', kind: 'search', ms: 900 },
  { think: CODEX_THOUGHT },
  { tool: 'Edit 0142-reset-at.sql', kind: 'edit', path: `${WORKTREE}/packages/persistence-sqlite/migrations/0142-reset-at.sql`, ms: 800 },
  { say: LIVE_ANSWER },
]

/** A thread that only reads: nothing plays. */
const STILL: ReadonlyArray<Beat> = []

const coordinatorBeats: ReadonlyArray<Beat> = [
  { think: CODEX_THOUGHT },
  { tool: 'Call list_tasks', kind: 'other', ms: 700 },
  { say: COORDINATOR_ANSWER },
]

function Composer() {
  return <div className={s.composer}>Ask the lead</div>
}

function Face({ children }: { children: ReactNode }) {
  return (
    <TaskFace className={s.face} composer={<Composer />}>
      <Thread label="Thread">
        <ThreadShellProvider value={shell}>{children}</ThreadShellProvider>
      </Thread>
    </TaskFace>
  )
}

/** A task's thread, as its screen draws it; live, with a turn of its lead's playing on the end. */
function TaskScene({ live }: { live: boolean }) {
  const before = TASK
  const played = usePlayed(before, 'Does the back-off survive a restart?', LEAD, LEAD_MODEL, live ? leadBeats : STILL)
  const now = useNow(true)
  const settledOf = useReviewOutcomes('lab', reviewsIn(before), latestReport(before))
  const source = live ? played : { items: before, streaming: new Map(), running: false, turnStarted: null, turnEnded: null }
  const rounds = roundsOf(
    {
      items: source.items,
      turnRunning: source.running,
      turnStarted: source.turnStarted,
      turnEnded: source.turnEnded,
      openedAt: at(0),
      worktree: WORKTREE,
    },
    source.streaming,
    (iso) => ago(iso),
    now,
  )
  return (
    <Face>
      <TaskThread
        rounds={[request, ...rounds]}
        versionOf={() => ''}
        settledOf={settledOf}
        threadId="lab"
        worktree={WORKTREE}
        session={session}
      />
    </Face>
  )
}

/** A long answer, for timing frames while three stream. */
const longBeats: ReadonlyArray<Beat> = [{ think: CODEX_THOUGHT }, { say: LONG_ANSWER }]

/** The coordinator's thread: what the person asked, and its answer streaming. */
function CoordinatorThread({ seed = 7, long = false }: { seed?: number; long?: boolean }) {
  const before = useMemo(() => [], [])
  const played = usePlayed(before, 'What needs me today?', 'codex', 'gpt-5.2', long ? longBeats : coordinatorBeats, seed)
  const now = useNow(true)
  const blocks = blocksOf(
    { items: played.items, turnRunning: played.running, turnStarted: played.turnStarted, turnEnded: played.turnEnded, worktree: null },
    played.streaming,
    (iso) => ago(iso),
    now,
  )
  return <ThreadBlocks blocks={blocks} threadId={`coordinator-${seed}`} session={{ agentId: 'codex', model: 'gpt-5.2', account: null }} />
}

function Lab() {
  const [scene, setScene] = useState<Scene>((params.get('scene') as Scene | null) ?? 'task')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const picked = scenes[Number(event.key) - 1]
      if (picked !== undefined) setScene(picked.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('scene', scene)
    history.replaceState(null, '', url)
  }, [scene])
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        {scene === 'task' && <TaskScene key="task" live={false} />}
        {scene === 'live' && <TaskScene key="live" live />}
        {scene === 'coordinator' && (
          <Face>
            <CoordinatorThread />
          </Face>
        )}
        {scene === 'three' && (
          <div className={s.three}>
            {[7, 11, 23].map((seed) => (
              <Face key={seed}>
                <CoordinatorThread seed={seed} long />
              </Face>
            ))}
          </div>
        )}
      </main>
      <nav className={s.bar} aria-label="Scenes">
        {scenes.map((one, index) => (
          <button key={one.key} type="button" aria-pressed={scene === one.key} onClick={() => setScene(one.key)}>
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
