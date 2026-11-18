import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useState } from 'react'

import { createRoot } from 'react-dom/client'

import { Delivery, TaskFace, Thread, ThreadShellProvider, Workbench } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { TaskThread } from '../../src/renderer/features/task/TaskThread'
import { roundsOf } from '../../src/renderer/shared/rounds'
import { ago, useNow } from '../../src/renderer/shared/time'
import { servicesFor } from '../../tests/render'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { at, LEAD, LEAD_MODEL, PIXEL, REQUEST, type Screen, thread, WORKTREE } from './data'
import { DIRECTIONS, type Direction, type DeviceState, type Look } from './Directions'
import { linkAt } from './Phone'
import s from './lab.module.css'

/*
 * The device lab (README.md): a device beside a task's conversation, in four
 * directions, on the app's own thread and kit. A–D, or the bar along the
 * bottom, swap the direction; S starts the device, U puts the lab on a
 * computer with no Xcode, L sets the lead at work on it, N narrows the
 * workbench. The address keeps it all, for a screenshot.
 */

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = 'light'

const services = servicesFor(fakeClient({}).client, fakeHost())
const ITEMS = thread()
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

const flag = (name: string) => params.get(name) === '1'

function Conversation({ panel, width }: { panel: React.ReactNode; width: number }) {
  const now = useNow(true)
  const rounds = roundsOf(
    { items: ITEMS, turnRunning: true, turnStarted: at(0, 10), turnEnded: null, openedAt: at(0), worktree: WORKTREE },
    new Map(),
    (iso) => ago(iso),
    now,
  )
  return (
    <TaskFace className={s.face} composer={<div className={s.composer}>Ask the lead</div>} panel={panel} panelWidth={width}>
      <Thread label="Thread">
        <ThreadShellProvider value={{}}>
          <TaskThread rounds={[request, ...rounds]} versionOf={() => ''} threadId="lab" worktree={WORKTREE} session={session} />
        </ThreadShellProvider>
      </Thread>
    </TaskFace>
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>((params.get('d') as Direction | null) ?? 'a')
  const [starting, setStarting] = useState(flag('starting'))
  const [unavailable, setUnavailable] = useState(flag('unavailable'))
  const [driving, setDriving] = useState(flag('lead'))
  const [narrow, setNarrow] = useState(flag('narrow'))
  const [open, setOpen] = useState(true)
  const [width, setWidth] = useState<number | null>(null)
  const [androidScreen, setAndroidScreen] = useState<Screen>(params.get('screen') === 'where' ? 'where' : 'first')
  const [tap, setTap] = useState<Look['tap']>(null)

  // Pressing S shows the device starting in its place at once, and running a few seconds later, as an emulator's boot is.
  useEffect(() => {
    if (!starting || flag('starting')) return
    const done = setTimeout(() => setStarting(false), 3200)
    return () => clearTimeout(done)
  }, [starting])

  // The lead at work: it taps "Where do I get a code?" on the Pixel, the screen answers, and it taps Done.
  useEffect(() => {
    if (!driving) return
    let key = 0
    const every = setInterval(() => {
      key += 1
      setTap({ ...linkAt(PIXEL), key })
      setTimeout(() => setAndroidScreen((was) => (was === 'first' ? 'where' : 'first')), 220)
    }, 2600)
    return () => clearInterval(every)
  }, [driving])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea'))
      )
        return
      const key = event.key.toLowerCase()
      const picked = DIRECTIONS.find((one) => one.key === key)
      if (picked !== undefined) {
        setDirection(picked.key)
        setOpen(true)
      }
      if (key === 's') setStarting(true)
      if (key === 'u') setUnavailable((was) => !was)
      if (key === 'l') setDriving((was) => !was)
      if (key === 'n') setNarrow((was) => !was)
      if (key === 'o') setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    for (const [name, on] of [
      ['starting', starting],
      ['unavailable', unavailable],
      ['lead', driving],
      ['narrow', narrow],
    ] as const)
      if (on) url.searchParams.set(name, '1')
      else url.searchParams.delete(name)
    history.replaceState(null, '', url)
  }, [direction, starting, unavailable, driving, narrow])

  const chosen = DIRECTIONS.find((one) => one.key === direction) ?? DIRECTIONS[0]
  const state: DeviceState = starting ? 'starting' : unavailable ? 'unavailable' : 'running'
  const look: Look = { state, driving, tap, screens: { ios: 'first', android: androidScreen }, onClose: () => setOpen(false) }
  const usual = direction === 'c' ? 640 : 480
  const shown = narrow ? 360 : (width ?? usual)
  const Panel = chosen.Panel
  return (
    <div className={s.lab}>
      <main className={s.scene}>
        <Conversation
          width={shown}
          panel={
            open ? (
              <Workbench width={shown} min={320} max={900} onWidth={setWidth} onReset={() => setWidth(null)}>
                <Panel key={`${direction}-${state}`} look={look} />
              </Workbench>
            ) : null
          }
        />
      </main>
      <nav className={s.bar} aria-label="Directions">
        {DIRECTIONS.map((one) => (
          <button key={one.key} type="button" aria-pressed={direction === one.key} onClick={() => (setDirection(one.key), setOpen(true))}>
            <kbd>{one.key.toUpperCase()}</kbd> {one.label.split(' · ')[1]}
          </button>
        ))}
        <span className={s.gap} />
        <button type="button" aria-pressed={starting} onClick={() => setStarting(true)}>
          <kbd>S</kbd> Starting
        </button>
        <button type="button" aria-pressed={unavailable} onClick={() => setUnavailable((was) => !was)}>
          <kbd>U</kbd> No Xcode
        </button>
        <button type="button" aria-pressed={driving} onClick={() => setDriving((was) => !was)}>
          <kbd>L</kbd> Lead at work
        </button>
        <button type="button" aria-pressed={narrow} onClick={() => setNarrow((was) => !was)}>
          <kbd>N</kbd> Narrow
        </button>
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
