// Scrappy: what the page holds, and the fake runtime's side of an exchange: when the message is stored, handed to the agent, answered or failed.
import { useEffect, useState, useSyncExternalStore } from 'react'

import type { ThreadItem, WatchEvent } from '@althar/contracts'

import { items } from '../../tests/fixtures'
import { at, BUSY, coordinatorBefore, FAILURE, REPLY, type Screen, screenOfThread, taskBefore, threadOfScreen } from './data'
import { AT, type Direction } from './timeline'

/** How long until the first word: or never, and then it fails. */
export type Delay = '1' | '5' | '20' | 'fails'
export const DELAYS: ReadonlyArray<{ readonly value: Delay; readonly label: string; readonly tip: string }> = [
  { value: '1', label: '1s', tip: 'The first word comes a second after Enter' },
  { value: '5', label: '5s', tip: 'Five seconds, about what a lead on Opus takes to start' },
  { value: '20', label: '20s', tip: 'A slow start: twenty seconds' },
  { value: 'fails', label: 'Fails', tip: `Nothing for ${AT.fail} seconds, then the agent gives up` },
]

/** Where an exchange stands. */
export type Phase =
  /** Sent behind the lead's work: it waits in the composer's queue. */
  | 'queued'
  /** Sent, and nothing back yet: the gap. */
  | 'waiting'
  /** The first words are in. */
  | 'answering'
  | 'done'
  | 'failed'
  | 'stopped'

export interface Gap {
  readonly screen: Screen
  readonly text: string
  /** The store's id for the message, once it has one. */
  readonly id: string
  readonly phase: Phase
  /** When the gap began, in ms: Enter, or, for one queued, when the lead turned to it. Null while it waits its turn. */
  readonly start: number | null
  /** When it was sent, in ms. */
  readonly sent: number
  /** When the first word came, in seconds from the start. */
  readonly first: number | null
  /** What happened along the way, so each happens once. */
  readonly done: ReadonlySet<string>
}

interface Thread {
  readonly items: ReadonlyArray<ThreadItem>
  readonly turnRunning: boolean
}

export interface State {
  readonly d: Direction
  readonly screen: Screen
  readonly delay: Delay
  /** The lead is at work when the person sends: what they send waits its turn. */
  readonly busy: boolean
  /** As a Mac set to reduce motion shows it. */
  readonly reduced: boolean
  readonly threads: Readonly<Record<Screen, Thread>>
  readonly gap: Gap | null
  /** The clock is held, at this many ms after the gap's start (for pictures, or to look closely). */
  readonly held: number | null
}

const fresh = (screen: Screen, now = Date.now()): Thread => ({
  items: screen === 'coordinator' ? coordinatorBefore(now) : taskBefore(now),
  turnRunning: false,
})

let state: State = {
  d: 'T',
  screen: 'coordinator',
  delay: '5',
  busy: false,
  reduced: false,
  threads: { coordinator: fresh('coordinator'), task: fresh('task') },
  gap: null,
  held: null,
}

const listeners = new Set<() => void>()
const set = (next: State) => {
  state = next
  for (const listener of listeners) listener()
}
export const get = () => state
export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const useProto = () => useSyncExternalStore(subscribe, get, get)

/* ——— What the fake runtime tells the window ——— */

/**
 * The fake client's emit, once the page has made it: a change the runtime announces, or words it streams. And the
 * window's copy of a thread put back whole, as a fresh read would, for a thread started again.
 */
export const wire = { emit: (_event: WatchEvent): void => undefined, reload: (_screen: Screen): void => undefined }

const changed = (screen: Screen, aggregateType: string, aggregateId: string) =>
  wire.emit({ _tag: 'Changed', cursor: Date.now(), aggregateType, aggregateId, projectId: 'p1', threadId: threadOfScreen(screen) })

const streaming = (screen: Screen, itemId: string, text: string) =>
  wire.emit({ _tag: 'Streaming', threadId: threadOfScreen(screen), itemId, kind: 'agent_message', agentId: 'claude-code', text })

const putThread = (screen: Screen, change: (thread: Thread) => Thread) =>
  set({ ...state, threads: { ...state.threads, [screen]: change(state.threads[screen]) } })

const putItem = (screen: Screen, item: ThreadItem) => {
  putThread(screen, (thread) => {
    const there = thread.items.findIndex((one) => one.id === item.id)
    return {
      ...thread,
      items: there === -1 ? [...thread.items, item] : thread.items.map((one, index) => (index === there ? item : one)),
    }
  })
  changed(screen, 'thread_item', item.id)
}

const running = (screen: Screen, turnRunning: boolean) => {
  putThread(screen, (thread) => ({ ...thread, turnRunning }))
  changed(screen, 'provider_session', 's1')
}

export const itemOf = (threadId: string, itemId: string) => {
  const screen = screenOfThread(threadId)
  return screen === null ? undefined : state.threads[screen].items.find((item) => item.id === itemId)
}

/* ——— The clock ——— */

/** Now, as the page's clock has it: held, or running. */
export const now = () => (state.held !== null && state.gap?.start != null ? state.gap.start + state.held : Date.now())

/** Seconds since the gap began; 0 before it does. */
export const elapsed = (gap: Gap | null = state.gap) => (gap?.start == null ? 0 : Math.max(0, (now() - gap.start) / 1000))

/** Seconds since the gap began, again every tenth of a second while it runs. */
export const useElapsed = () => {
  const st = useProto()
  const [, tick] = useState(0)
  const live = st.gap !== null && st.held === null && (st.gap.phase === 'waiting' || st.gap.phase === 'queued')
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => tick((n) => n + 1), 100)
    return () => window.clearInterval(id)
  }, [live])
  return elapsed(st.gap)
}

/* ——— An exchange, step by step ——— */

const putGap = (change: Partial<Gap>) => {
  if (state.gap === null) return
  set({ ...state, gap: { ...state.gap, ...change } })
}

/** Each thing once: true the first time it is asked for. */
const once = (key: string) => {
  const gap = state.gap
  if (gap === null || gap.done.has(key)) return false
  set({ ...state, gap: { ...gap, done: new Set([...gap.done, key]) } })
  return true
}

/** Words a few at a time, as the runtime streams them every 50 ms or so. */
const WORDS_A_SECOND = 22
const soFar = (text: string, seconds: number) => {
  const words = text.split(/(?<=\s)/)
  const shown = Math.floor(seconds * WORDS_A_SECOND)
  return { text: words.slice(0, shown).join(''), whole: shown >= words.length, takes: words.length / WORDS_A_SECOND }
}

const delayOf = (delay: Delay) => (delay === 'fails' ? null : Number(delay))

/** The lead's answer, from its first word: what it says first, its work, what it says last. */
const answer = (gap: Gap, since: number) => {
  const reply = REPLY[gap.screen]
  const screen = gap.screen
  const id = (part: string) => `${gap.id}-${part}`
  const first = soFar(reply.first, since)
  if (!first.whole) {
    if (first.text !== '') streaming(screen, id('first'), first.text)
    return
  }
  if (once('first-kept')) putItem(screen, at(items.says(reply.first), now(), id('first')))
  let t = first.takes + 0.4
  for (const [index, title] of reply.steps.entries()) {
    const long = title.startsWith('Run') ? 1.8 : 0.8
    if (since >= t && once(`step-${index}`))
      putItem(
        screen,
        at(
          items.tool({
            title,
            toolKind: title.startsWith('Run') ? 'execute' : title.startsWith('Edit') ? 'edit' : 'read',
            status: 'in_progress',
          }),
          now(),
          id(`step-${index}`),
        ),
      )
    if (since >= t + long && once(`step-${index}-done`)) {
      const was = state.threads[screen].items.find((item) => item.id === id(`step-${index}`))
      if (was?.kind === 'tool_call') putItem(screen, { ...was, content: { ...was.content, status: 'completed' } })
    }
    t += long + 0.3
  }
  if (reply.last !== null) {
    if (since < t) return
    const last = soFar(reply.last, since - t)
    if (!last.whole) {
      if (last.text !== '') streaming(screen, id('last'), last.text)
      return
    }
    if (once('last-kept')) putItem(screen, at(items.says(reply.last), now(), id('last')))
  }
  if (once('over')) {
    running(screen, false)
    putGap({ phase: 'done' })
  }
}

/** The lead's work under way when the person sent, and how long it has left. */
const BUSY_LEFT = 5

const advance = () => {
  const gap = state.gap
  if (gap === null || state.held !== null) return
  const screen = gap.screen
  const t = (Date.now() - gap.sent) / 1000
  // The store has it: queued, as the runtime keeps every message at first.
  if (t >= AT.stored && once('stored')) {
    putItem(screen, at(items.you(gap.text, { state: 'queued', interrupting: false }), gap.sent, gap.id))
    changed(screen, 'user_input', gap.id)
  }
  if (gap.phase === 'queued') {
    if (t < BUSY_LEFT) return
    // The work it waited behind ends; then the lead turns to it.
    if (once('busy-over')) {
      const tool = state.threads[screen].items.find((item) => item.id === `busy-${screen}-tool`)
      if (tool?.kind === 'tool_call') putItem(screen, { ...tool, content: { ...tool.content, status: 'completed' } })
      putItem(screen, at(items.says(BUSY[screen].done), Date.now(), `busy-${screen}-done`))
      running(screen, false)
    }
    if (t < BUSY_LEFT + 0.25) return
    putGap({ phase: 'waiting', start: gap.sent + (BUSY_LEFT + 0.25 - AT.handed) * 1000 })
    return
  }
  if (gap.start === null) return
  const since = (Date.now() - gap.start) / 1000
  // Handed to the agent: delivered, read where it now stands, and the turn runs.
  if (since >= AT.handed && once('handed')) {
    const mine = state.threads[screen].items.find((item) => item.id === gap.id)
    if (mine?.kind === 'user_message') {
      putThread(screen, (thread) => ({ ...thread, items: thread.items.filter((item) => item.id !== gap.id) }))
      putItem(
        screen,
        at(
          { ...mine, input: { state: 'delivered', interrupting: false } },
          mine.createdAt === undefined ? gap.sent : Date.parse(mine.createdAt),
          gap.id,
        ),
      )
    }
    changed(screen, 'user_input', gap.id)
    running(screen, true)
  }
  if (gap.phase !== 'waiting' && gap.phase !== 'answering') return
  const delay = delayOf(state.delay)
  if (delay === null) {
    if (since >= AT.fail && once('failed')) {
      putItem(
        screen,
        at(
          items.notice({ source: 'agent', severity: 'error', title: 'Claude Code couldn’t answer.', description: FAILURE }),
          Date.now(),
          `${gap.id}-failed`,
        ),
      )
      running(screen, false)
      putGap({ phase: 'failed' })
    }
    return
  }
  if (since < delay) return
  if (gap.phase === 'waiting') putGap({ phase: 'answering', first: delay })
  answer(state.gap ?? gap, since - delay)
}

let ticking: number | undefined
const tick = () => {
  ticking ??= window.setInterval(advance, 50)
}

/* ——— What the person does ——— */

let sends = 0

/** The person's message, as the fake runtime's Send takes it. */
export const sent = (threadId: string, body: string) => {
  const screen = screenOfThread(threadId)
  if (screen === null) return
  sends += 1
  const busy = state.threads[screen].turnRunning
  set({
    ...state,
    gap: {
      screen,
      text: body,
      id: `m${sends}`,
      phase: busy ? 'queued' : 'waiting',
      start: busy ? null : Date.now(),
      sent: Date.now(),
      first: null,
      done: new Set(),
    },
    held: null,
  })
  tick()
}

/** Stop: the turn ends where it is. */
export const stopped = (threadId: string) => {
  const screen = screenOfThread(threadId)
  if (screen === null) return
  running(screen, false)
  if (state.gap?.screen === screen && (state.gap.phase === 'waiting' || state.gap.phase === 'answering')) putGap({ phase: 'stopped' })
}

/** A queued message taken back. */
export const takenBack = (itemId: string) => {
  const gap = state.gap
  if (gap === null || gap.id !== itemId) return
  const mine = state.threads[gap.screen].items.find((item) => item.id === itemId)
  if (mine?.kind === 'user_message') putItem(gap.screen, { ...mine, input: { state: 'withdrawn', interrupting: false } })
  set({ ...state, gap: null })
}

/** The thread as it was before anything was sent, and, where the lead is busy, at work on something else. */
export const reset = (screen: Screen, busy = state.busy) => {
  // An answer still arriving is finished first, so nothing it streamed is left hanging in the window.
  if (state.gap?.screen === screen && state.gap.phase === 'answering') jump(120, false)
  const now = Date.now()
  const base = fresh(screen, now)
  const work = busy
    ? [
        at(items.you(BUSY[screen].ask), now - 40_000),
        at(
          items.tool({ title: BUSY[screen].tool, toolKind: screen === 'task' ? 'execute' : 'read', status: 'in_progress' }),
          now - 32_000,
          `busy-${screen}-tool`,
        ),
      ]
    : []
  set({
    ...state,
    threads: { ...state.threads, [screen]: { items: [...base.items, ...work], turnRunning: busy } },
    gap: state.gap?.screen === screen ? null : state.gap,
    held: null,
  })
  wire.reload(screen)
}

export const setDirection = (d: Direction) => set({ ...state, d })
export const setScreen = (screen: Screen) => set({ ...state, screen })
export const setDelay = (delay: Delay) => set({ ...state, delay })
export const setBusy = (busy: boolean) => set({ ...state, busy })
export const setReduced = (reduced: boolean) => set({ ...state, reduced })

/**
 * The clock moved to this many seconds into the gap, and held there or running on from it: what has happened by then
 * happens at once.
 */
export const jump = (seconds: number, hold: boolean) => {
  const gap = state.gap
  if (gap === null || gap.start === null) return
  const start = Date.now() - seconds * 1000
  set({ ...state, gap: { ...gap, start, sent: gap.sent - (gap.start - start) }, held: null })
  advance()
  if (hold) set({ ...state, held: seconds * 1000 })
}

export const release = () => {
  const gap = state.gap
  if (gap === null || gap.start === null || state.held === null) return
  set({ ...state, gap: { ...gap, start: Date.now() - state.held, sent: gap.sent + (Date.now() - state.held - gap.start) }, held: null })
}
