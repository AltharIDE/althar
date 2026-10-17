// Scrappy: the real desktop app (its router, the coordinator's conversation and a task's thread) on the tests' fake client, with a bar underneath that sends a message and switches how the wait for the first word looks, in place.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'
import './page.css'

import type { CoordinatorSnapshot, ThreadSnapshot } from '@althar/contracts'
import { Button, Segmented, Switch } from '@althar/ui'
import { createBrowserHistory, RouterProvider } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { keys, makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeClient, fakeHost, home, repositories } from '../../tests/fixtures'
import b from './bar.module.css'
import { althar, ROOT, SAID, type Screen, SCREENS, screenOfThread, TASK_THREAD, threadOfScreen } from './data'
import { actions } from './nav'
import { boardOf, coordinatorOf, threadOf } from './runtime'
import {
  type Delay,
  DELAYS,
  get,
  itemOf,
  jump,
  release,
  reset,
  sent,
  setBusy,
  setDelay,
  setDirection,
  setReduced,
  setScreen,
  stopped,
  subscribe,
  takenBack,
  useElapsed,
  useProto,
  wire,
} from './store'
import { AT, type Beat, type Direction, directionOf, DIRECTIONS, seconds } from './timeline'

/* ——— What the fake runtime says: read from the page's state each time ——— */

const repository = { ...repositories[0]!, id: 'repo_althar', name: 'althar', path: `${ROOT}/althar`, tasks: 1 }

const { client, emit } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [althar] }),
  openProject: async () => althar,
  getHome: async () => home({ projects: [althar] }),
  getBoard: async () => boardOf(get()),
  getOlderSettled: async () => [],
  getCoordinator: async () => coordinatorOf(get()),
  getThread: async (threadId: string) => threadOf(get(), threadId),
  getThreadItem: async (threadId: string, itemId: string) => {
    const item = itemOf(threadId, itemId)
    if (item === undefined) throw new Error(`No item ${itemId}`)
    return item
  },
  getRepositories: async () => [repository],
  send: async (input: { readonly threadId: string; readonly body: string }) => sent(input.threadId, input.body),
  interrupt: async (threadId: string) => stopped(threadId),
  takeBack: async (itemId: string) => takenBack(itemId),
} as Parameters<typeof fakeClient>[0])

const cache = makeQueryClient()
const services = { client, host: fakeHost(), cache, feed: follow(client, cache) }

wire.emit = emit
// A thread started again: the window's copy put back whole, as a fresh read would.
wire.reload = (screen) => {
  if (screen === 'coordinator') cache.setQueryData<CoordinatorSnapshot>(keys.coordinator('p1'), coordinatorOf(get()))
  else cache.setQueryData<ThreadSnapshot>(keys.thread(TASK_THREAD), threadOf(get(), TASK_THREAD))
}

/* ——— Where the page starts: the direction, the screen and the wait the address names ——— */

const params = new URLSearchParams(window.location.search)
const firstDirection: Direction = DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'T'
const firstScreen: Screen = SCREENS.find((one) => one.value === params.get('v'))?.value ?? 'coordinator'
const firstDelay: Delay = DELAYS.find((one) => one.value === params.get('delay'))?.value ?? '5'
/** Sent as the page opens, and held this many seconds in: for pictures. */
const heldAt = params.has('at') ? Number(params.get('at')) : null
/** Sent as the page opens, and left to run: for the queue, which has no clock of its own to hold. */
const sendOnOpen = params.has('send')
const bare = params.has('bare')

const hashOf = (screen: Screen) => (screen === 'coordinator' ? '#/projects/p1?room=talk' : `#/threads/${TASK_THREAD}`)

window.localStorage.removeItem('althar.tabs')
window.location.hash = hashOf(firstScreen)
setDirection(firstDirection)
setScreen(firstScreen)
setDelay(firstDelay)
setBusy(params.get('busy') === '1')
setReduced(params.get('reduced') === '1')

const quietly = window.history.replaceState.bind(window.history)

/** The app's own hash history, reading its search from the hash alone: the page's own address (?d=…) stays out of the app's routes. */
const history = createBrowserHistory({
  parseLocation: () => {
    const [path = '/', ...rest] = window.location.hash.split('#').slice(1)
    const href = `${path}${rest.length === 0 ? '' : `#${rest.join('#')}`}`
    const hashAt = href.indexOf('#')
    const searchAt = href.indexOf('?')
    const end = (at: number) => (at === -1 ? href.length : at)
    return {
      href,
      pathname: href.slice(0, Math.min(end(searchAt), end(hashAt))),
      search: searchAt === -1 ? '' : href.slice(searchAt, hashAt === -1 ? undefined : hashAt),
      hash: hashAt === -1 ? '' : href.slice(hashAt),
      state: window.history.state ?? { __TSR_index: 0, key: 'first', __TSR_key: 'first' },
    }
  },
  createHref: (href) => `${window.location.pathname}${window.location.search}#${href}`,
})
const router = makeRouter({ client, cache }, history)

/** The screen showing, by the router's place. */
const shownScreen = (): Screen => {
  const path = router.state.location.pathname
  return path.startsWith('/threads/') ? (screenOfThread(path.slice('/threads/'.length)) ?? 'task') : 'coordinator'
}
const useShownScreen = () => useSyncExternalStore((listener) => router.subscribe('onResolved', listener), shownScreen)

/** The page's address, kept to what it shows. */
const keep = () => {
  const st = get()
  const now = new URLSearchParams(window.location.search)
  now.set('d', st.d)
  now.set('v', shownScreen())
  now.set('delay', st.delay)
  if (st.busy) now.set('busy', '1')
  else now.delete('busy')
  if (st.reduced) now.set('reduced', '1')
  else now.delete('reduced')
  if (st.held === null) now.delete('at')
  const next = `${window.location.pathname}?${now.toString()}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) quietly(window.history.state, '', next)
}
subscribe(keep)
router.subscribe('onResolved', keep)

// Reduced motion, as the bar says: the directions' still states, and the kit's own (page.css).
const reduce = () => document.documentElement.toggleAttribute('data-reduced', get().reduced)
subscribe(reduce)
reduce()

// A direction switched: the thread reads again which turn runs (today's or the directions').
let shownDirection = get().d
subscribe(() => {
  if (get().d === shownDirection) return
  shownDirection = get().d
  for (const screen of ['coordinator', 'task'] as const) wire.reload(screen)
})

/* ——— Sending, as the person does: words in the real composer, and Enter ——— */

const frame = () => new Promise((done) => window.requestAnimationFrame(() => done(undefined)))
const until = async (find: () => HTMLTextAreaElement | null, tries = 40): Promise<HTMLTextAreaElement | null> => {
  for (let at = 0; at < tries; at += 1) {
    const found = find()
    if (found !== null) return found
    await new Promise((done) => window.setTimeout(done, 100))
  }
  return null
}

const type = async (text: string) => {
  const box = await until(() => document.querySelector<HTMLTextAreaElement>('form textarea'))
  if (box === null) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  box.focus()
  setter?.call(box, text)
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await frame()
  await frame()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
}

/** Send, from the bar: the thread as it was, the lead at work or not, then the message, said in the composer. */
const send = async () => {
  const screen = shownScreen()
  reset(screen)
  await frame()
  await frame()
  await type(SAID[screen])
}

actions.sendAgain = (_screen, text) => void type(text)
actions.stop = (screen) => {
  // The composer's own Stop, as the person would press it; the runtime's, where it isn't there.
  const stop = document.querySelector<HTMLButtonElement>('form button[aria-label^="Interrupt"]')
  if (stop !== null) stop.click()
  else stopped(threadOfScreen(screen))
}

/* ——— The strip: when each thing appears, in the direction showing ——— */

const whenOf = (beat: Beat, delay: Delay): number | null => {
  if (typeof beat.at === 'number') return beat.at
  if (beat.at === 'first') return delay === 'fails' ? null : Number(delay)
  if (beat.at === 'fail') return delay === 'fails' ? AT.fail : null
  return null
}

const phaseWords: Record<string, string> = {
  queued: 'queued behind the lead’s work',
  waiting: 'waiting for the first word',
  answering: 'answering',
  done: 'answered',
  failed: 'no answer',
  stopped: 'stopped',
}

function Strip() {
  const st = useProto()
  const t = useElapsed()
  const info = directionOf(st.d)
  const timed = info.beats
    .map((beat) => ({ beat, when: whenOf(beat, st.delay) }))
    .filter((one): one is { beat: Beat; when: number } => one.when !== null)
    .toSorted((x, y) => x.when - y.when)
  const queued = info.beats.find((beat) => beat.at === 'queued')
  const gap = st.gap
  const clock = gap === null ? null : gap.phase === 'queued' ? null : t
  return (
    <div className={b.strip} aria-label="Timeline">
      <span className={b.clock}>
        {clock === null ? (gap?.phase === 'queued' ? 'queued' : 'Send to watch') : `${clock.toFixed(1)}s`}
        {gap !== null && <span className={b.phase}>{phaseWords[gap.phase]}</span>}
      </span>
      <ol className={b.beats}>
        {timed.map(({ beat, when }) => {
          const past = clock !== null && clock >= when
          const first = beat.at === 'first'
          return (
            <li key={`${beat.what}-${when}`}>
              <button
                type="button"
                className={`${b.beat} ${past ? b.past : ''} ${first ? b.first : ''}`}
                title={gap === null ? 'Send first' : `Hold at ${seconds(when)}`}
                disabled={gap === null || gap.start === null}
                onClick={() => jump(when + (first ? 0.6 : 0.05), true)}
              >
                <span className={b.when}>{when < 1 ? `${when}s` : seconds(when)}</span>
                {beat.what}
              </button>
            </li>
          )
        })}
        {st.busy && queued !== undefined && <li className={b.note}>Lead busy: {queued.what}</li>}
      </ol>
      {st.held !== null && (
        <Button size="small" variant="quiet" onClick={release}>
          Run on
        </Button>
      )}
    </div>
  )
}

/* ——— The bar ——— */

const forThePage = (event: KeyboardEvent) => {
  const target = event.target
  return !(
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest('form, input, textarea, select, [role="textbox"], [role="menu"], [role="listbox"], [role="dialog"]') !== null))
  )
}

function Bar() {
  const st = useProto()
  const screen = useShownScreen()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!forThePage(event)) return
      const at = DIRECTIONS.findIndex((one) => one.key === get().d)
      const to =
        event.key === 'ArrowRight'
          ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
          : event.key === 'ArrowLeft'
            ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
            : /^[1-9]$/.test(event.key)
              ? DIRECTIONS[Number(event.key) - 1]
              : undefined
      if (event.key === 's') {
        event.preventDefault()
        void send()
        return
      }
      if (to === undefined) return
      event.preventDefault()
      setDirection(to.key)
    }
    // Caught first, so the bar's own radio group doesn't take the arrows as a move without a pick.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  if (bare) return null
  return (
    <div className={b.bar}>
      <Segmented<Direction>
        label="Direction"
        value={st.d}
        onChange={setDirection}
        options={DIRECTIONS.map((one, index) => ({
          value: one.key,
          label: one.key === 'T' ? one.short : `${one.short} · ${one.name}`,
          kbd: String(index + 1),
        }))}
      />
      <span className={b.grow} />
      <Segmented<Screen>
        label="Screen"
        value={screen}
        onChange={(next) => {
          setScreen(next)
          void router.navigate({ href: hashOf(next).slice(1) })
        }}
        options={SCREENS}
      />
      <Segmented<Delay>
        label="First word after"
        value={st.delay}
        onChange={setDelay}
        options={DELAYS.map((one) => ({ value: one.value, label: one.label, tooltip: { label: one.tip } }))}
      />
      <label className={b.toggle}>
        <Switch checked={st.busy} onChange={setBusy} label="Lead busy" />
        Lead busy
      </label>
      <label className={b.toggle}>
        <Switch checked={st.reduced} onChange={setReduced} label="Reduce motion" />
        Reduce motion
      </label>
      <Button size="small" variant="ink" icon="up" kbd="S" onClick={() => void send()}>
        Send
      </Button>
    </div>
  )
}

function Page() {
  return (
    <ServicesProvider value={services}>
      <div className={bare ? b.bare : b.frame}>
        <RouterProvider router={router} />
      </div>
      {!bare && <Strip />}
      <Bar />
    </ServicesProvider>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(<Page />)

// For pictures: sent as the page opens, and left to run, or held a moment in.
if (sendOnOpen && heldAt === null)
  void (async () => {
    await until(() => document.querySelector<HTMLTextAreaElement>('form textarea'), 80)
    await new Promise((done) => window.setTimeout(done, 400))
    await send()
  })()
if (heldAt !== null)
  void (async () => {
    await until(() => document.querySelector<HTMLTextAreaElement>('form textarea'), 80)
    await new Promise((done) => window.setTimeout(done, 400))
    await send()
    await until(() => (get().gap?.start != null ? document.createElement('textarea') : null), 200)
    jump(heldAt, true)
  })()
