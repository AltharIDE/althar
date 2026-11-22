import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useMemo, useState } from 'react'

import type { ComputerDecision, ComputerState } from '@althar/runtime/computerBridge'
import { createRoot } from 'react-dom/client'

import { TaskFace, Thread, ThreadShellProvider } from '@althar/ui'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { type Host, type Services, ServicesProvider } from '../../src/renderer/data/services'
import { ComputerUse } from '../../src/renderer/features/task/ComputerUse'
import { TaskThread } from '../../src/renderer/features/task/TaskThread'
import { roundsOf } from '../../src/renderer/shared/rounds'
import { ago, useNow } from '../../src/renderer/shared/time'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { type Beat, usePlayed } from '../thread/play'
import { LEAD, LEAD_MODEL, WORKTREE, at } from '../thread/thread'
import s from '../thread/lab.module.css'

/*
 * The computer use lab (README.md): the task's computer use card as the app
 * draws it, under a lead at work, in each state a session goes through.
 * Keys 1–9, or the bar along the bottom, swap the state; ?theme=dark draws it
 * dark. Answering and the card's buttons play on: an answer or a press is
 * taken a moment later, as the native helper would, and the "Can't reach"
 * state refuses them.
 */

const TASK = 'task_0123456789abcdef0123456789abcdef'
const WRITER = { id: '0f1c4a52-1d7e-4c5b-9a3f-2b1d1a0e5c01', app: 'Writer', title: 'Q3 report — draft' }
const READER = { id: '0f1c4a52-1d7e-4c5b-9a3f-2b1d1a0e5c02', app: 'Reader', title: 'Q3 report' }
const REASON = 'Copy the reviewed note from Writer into Reader, and check that Reader shows it.'

const base: ComputerState = {
  taskId: TASK,
  threadId: 'lab',
  title: 'Verify the desktop report',
  phase: 'active',
  windows: [],
  desktop: false,
  foreground: false,
  action: '',
}

const asking = (request: Partial<NonNullable<ComputerState['request']>> = {}): ComputerState => ({
  ...base,
  phase: 'asking',
  action: 'Waiting for you to approve computer use.',
  request: {
    id: '7a0d3c2e-5b8f-4f61-8d2a-0c9e4b7a1f10',
    primaryDisplay: true,
    reason: REASON,
    ...request,
  },
})

const LONG =
  'Reproduce the export bug in Numbers: open quarterly-report-final-v3-reviewed-by-finance-and-legal.numbers, export it as a PDF, open that in Preview and compare the totals on page 3 with the spreadsheet’s.'

const granted: Pick<ComputerState, 'windows' | 'foreground'> = { windows: [WRITER, READER], foreground: true }

/** A window as the native helper pictures it: Reader, with the note it was handed. */
const READER_PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
  <rect width="1200" height="760" rx="14" fill="#fbfaf7"/>
  <rect width="1200" height="52" rx="14" fill="#ecebe6"/><rect y="38" width="1200" height="14" fill="#ecebe6"/>
  <circle cx="28" cy="26" r="7" fill="#d9d6cf"/><circle cx="52" cy="26" r="7" fill="#d9d6cf"/><circle cx="76" cy="26" r="7" fill="#d9d6cf"/>
  <text x="600" y="32" text-anchor="middle" font-family="Helvetica, Arial" font-size="16" fill="#5b5a57">Reader — Q3 report</text>
  <text x="72" y="128" font-family="Helvetica, Arial" font-size="30" font-weight="600" fill="#26262b">Q3 report</text>
  <text x="72" y="164" font-family="Helvetica, Arial" font-size="17" fill="#77756f">Imported from Writer · just now</text>
  <text x="72" y="236" font-family="Helvetica, Arial" font-size="16" fill="#5b5a57">Note</text>
  <rect x="72" y="252" width="1056" height="64" rx="10" fill="#ffffff" stroke="#d9d6cf" stroke-width="2"/>
  <text x="96" y="292" font-family="Helvetica, Arial" font-size="20" fill="#26262b">Reviewed report</text>
  <rect x="72" y="352" width="200" height="52" rx="10" fill="#26262b"/>
  <text x="172" y="385" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" fill="#ffffff">Import note</text>
  ${[0, 1, 2, 3]
    .map(
      (i) =>
        `<rect x="72" y="${456 + i * 64}" width="1056" height="48" rx="8" fill="#f2f0eb"/>` +
        `<rect x="96" y="${474 + i * 64}" width="${[420, 560, 380, 500][i]}" height="12" rx="6" fill="#d9d6cf"/>`,
    )
    .join('')}
</svg>`

/** The picture as the bridge carries it: a PNG's bytes, in base64. */
const pictured = (svg: string) =>
  new Promise<string>((done) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      done(canvas.toDataURL('image/png').slice('data:image/png;base64,'.length))
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

const scenes = [
  { key: 'ask', label: 'Asks', state: () => asking() },
  { key: 'display', label: 'No display', state: () => asking({ primaryDisplay: false }) },
  { key: 'long', label: 'Long reason', state: () => asking({ reason: LONG }) },
  { key: 'using', label: 'At work', state: () => ({ ...base, ...granted, action: 'Using Writer in the foreground.' }) },
  { key: 'observed', label: 'Observed', state: () => ({ ...base, ...granted, action: 'Observed Reader.' }), picture: true },
  { key: 'paused', label: 'Taken over', state: () => ({ ...base, ...granted, phase: 'paused', action: 'You have control.' }) },
  { key: 'stopped', label: 'Stopped', state: () => ({ ...base, phase: 'stopped', action: 'Computer use stopped.' }) },
  { key: 'unreachable', label: 'Refused', state: () => ({ ...base, ...granted, action: 'Observed Reader.' }), refuses: true },
] as const satisfies ReadonlyArray<{
  key: string
  label: string
  state: () => ComputerState
  picture?: boolean
  refuses?: boolean
}>
type Scene = (typeof scenes)[number]

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

/** The window's computer use, as main would answer it: each answer and press taken a moment later, or refused. */
const computerOf = (first: ComputerState, refuses: boolean): NonNullable<Host['computer']> => {
  const listeners = new Set<(state: ComputerState) => void>()
  let state = first
  const next = (change: Partial<ComputerState>) => {
    const { request: _request, preview: _preview, ...rest } = state
    state = { ...rest, ...change }
    for (const listener of listeners) listener(state)
  }
  const later = (change: () => Partial<ComputerState>) =>
    new Promise<boolean>((done) => {
      if (refuses) return done(false)
      // oxlint-disable-next-line althar/one-clock -- a lab page, with no runtime: the helper's moment, on the page's own timer.
      setTimeout(() => {
        done(true)
        next(change())
      }, 600)
    })
  return {
    states: () => Promise.resolve([state]),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    allow: (_task, decision: ComputerDecision) =>
      later(() => {
        const display = state.request?.primaryDisplay ?? false
        return decision.allow
          ? { phase: 'active', action: 'Computer access approved.', windows: [WRITER, READER], desktop: display, foreground: true }
          : { phase: 'stopped', action: 'Computer access declined.' }
      }),
    control: (_task, action) =>
      later(() =>
        action === 'pause'
          ? { phase: 'paused', action: 'You have control.' }
          : action === 'resume'
            ? { phase: 'active', action: 'Computer use resumed. The task will observe again.' }
            : { phase: 'stopped', action: 'Computer use stopped.', windows: [], desktop: false, foreground: false },
      ),
  }
}

// The lead at work: what it said it would do, and its computer call, still going.
const beats: ReadonlyArray<Beat> = [
  { say: 'I’ll ask for Writer and Reader, copy the reviewed note across, and check that Reader shows it.' },
  { tool: 'Call computer', kind: 'other', ms: 86_400_000 },
]
const session = { agentId: LEAD, model: LEAD_MODEL, account: null }
const ASKED = 'Verify the report using Writer and Reader.'

/** What the window's views reach for: a client with nothing behind it, and the host given. */
const servicesOf = (host: Host): Services => {
  const { client } = fakeClient()
  const cache = makeQueryClient()
  return { client, host, cache, feed: follow(client, cache) }
}

function Composer() {
  return <div className={s.composer}>Ask the lead</div>
}

function TaskScene({ scene, picture }: { scene: Scene; picture: string | null }) {
  const before = useMemo(() => [], [])
  const played = usePlayed(before, ASKED, LEAD, LEAD_MODEL, beats)
  const now = useNow(true)
  const services = useMemo(() => {
    const first = scene.state()
    const state: ComputerState =
      'picture' in scene && picture !== null
        ? { ...first, preview: { target: READER.id, picture: { mimeType: 'image/png', data: picture } } }
        : first
    return servicesOf(fakeHost({ computer: computerOf(state, 'refuses' in scene) }))
  }, [scene, picture])
  const rounds = roundsOf(
    {
      items: played.items,
      turnRunning: played.running,
      turnStarted: played.turnStarted,
      turnEnded: played.turnEnded,
      openedAt: at(0),
      worktree: WORKTREE,
    },
    played.streaming,
    (iso) => ago(iso),
    now,
  )
  return (
    <ServicesProvider value={services}>
      <TaskFace className={s.face} composer={<Composer />}>
        <Thread label="Thread">
          <ThreadShellProvider value={{}}>
            <TaskThread rounds={rounds} versionOf={() => ''} threadId="lab" worktree={WORKTREE} session={session} />
            <ComputerUse taskId={TASK} />
          </ThreadShellProvider>
        </Thread>
      </TaskFace>
    </ServicesProvider>
  )
}

function Lab({ picture }: { picture: string }) {
  const [key, setKey] = useState<Scene['key']>(() => scenes.find((one) => one.key === params.get('scene'))?.key ?? 'ask')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return
      const picked = scenes[Number(event.key) - 1]
      if (picked !== undefined) setKey(picked.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('scene', key)
    history.replaceState(null, '', url)
  }, [key])
  const scene = scenes.find((one) => one.key === key) ?? scenes[0]
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        <TaskScene key={scene.key} scene={scene} picture={picture} />
      </main>
      <nav className={s.bar} aria-label="States">
        {scenes.map((one, index) => (
          <button key={one.key} type="button" aria-pressed={key === one.key} onClick={() => setKey(one.key)}>
            <kbd>{index + 1}</kbd> {one.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) {
  const picture = await pictured(READER_PICTURE)
  createRoot(root).render(
    <StrictMode>
      <Page>
        <Lab picture={picture} />
      </Page>
    </StrictMode>,
  )
}

function Page({ children }: { children: ReactNode }) {
  return <div style={{ height: '100vh' }}>{children}</div>
}
