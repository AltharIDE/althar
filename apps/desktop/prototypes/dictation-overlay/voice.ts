import { useSyncExternalStore } from 'react'

import { type Crowd, titleOf } from './data'
import { addSent } from './sent'

/*
 * Throwaway: one dictation, kept by the thread it is addressed to rather
 * than by a composer (as "Keep composer text and dictation when navigating
 * away" keeps it, by `coordinator:<project>` and `thread:<id>`), fed by a fake
 * stream that says a script a word at a time. Which idea draws it, which
 * state it starts in, where the window is, and which composers are on screen
 * are here too, as one small store the page, the seams and the ideas read.
 */

export type Idea = 'T' | 'A' | 'B' | 'C' | 'D' | 'E'

export const IDEAS: ReadonlyArray<{ readonly value: Idea; readonly label: string; readonly note: string }> = [
  {
    value: 'T',
    label: 'Today',
    note: 'Leave the conversation while you talk and what you said is gone. On the board it keeps listening, with nothing on screen.',
  },
  {
    value: 'A',
    label: 'A · Pill',
    note: 'A pill floats over the screen, just above its composer; it opens into a card with the words. Drag it anywhere.',
  },
  {
    value: 'B',
    label: 'B · Call bar',
    note: 'A bar along the bottom of the window, as a call has: the latest words, live. Click it for the whole of it.',
  },
  {
    value: 'C',
    label: 'C · Mini composer',
    note: 'The same composer, small, travelling with you, with who it goes to in its lower row.',
  },
  {
    value: 'D',
    label: 'D · On its tab',
    note: 'The project’s tab says it is listening, with your voice on it; the words open from the tab.',
  },
  {
    value: 'E',
    label: 'E · Goes where you look',
    note: 'The words move into the composer on screen and go to it, with a way back; where there is none, a pill.',
  },
]

export type Preset = 'listening' | 'long' | 'transcribing' | 'finished' | 'failed' | 'again'

export const PRESETS: ReadonlyArray<{ readonly value: Preset; readonly label: string }> = [
  { value: 'listening', label: 'Listening' },
  { value: 'long', label: 'A long one' },
  { value: 'transcribing', label: 'Writing down, busy Mac' },
  { value: 'finished', label: 'Written, to send' },
  { value: 'failed', label: 'Couldn’t write it down' },
  { value: 'again', label: 'Moved on again' },
]

/** What else floats over the composer you land on: nothing, a server and a pull request, or all of it at once. */
export type { Crowd }

export const CROWDS: ReadonlyArray<{ readonly value: Crowd; readonly label: string }> = [
  { value: 'none', label: 'Nothing else running' },
  { value: 'some', label: 'A server, a pull request' },
  { value: 'crowded', label: 'Crowded' },
]

/** Where A's pill goes among those pills. */
export type APlace = 'centre' | 'right' | 'row' | 'above'

export const A_PLACES: ReadonlyArray<{ readonly value: APlace; readonly label: string; readonly note: string }> = [
  { value: 'centre', label: 'Centre', note: 'As first drawn: centred just above the composer, whatever else is there.' },
  {
    value: 'right',
    label: 'Right end',
    note: 'At the composer’s right edge; the pills keep the left. Where they reach it, it moves up a row.',
  },
  {
    value: 'row',
    label: 'In their row',
    note: 'One more pill in the row over the composer, the first, nearest the field; the others move along.',
  },
  { value: 'above', label: 'Above them', note: 'Centred above the whole stack of pills, never in their row.' },
]

/* ——— Who it goes to. ——— */

export const COORDINATOR = 'coordinator:p1'
export const threadKey = (threadId: string) => `thread:${threadId}`

export interface Address {
  readonly key: string
  readonly kind: 'coordinator' | 'task'
  /** "the coordinator", "the lead". */
  readonly who: string
  /** "Coordinator", or the task's title. */
  readonly name: string
  /** Its project. */
  readonly where: string
  /** Where its composer is. */
  readonly path: string
}

export const addressOf = (key: string): Address => {
  if (key.startsWith('coordinator:'))
    return { key, kind: 'coordinator', who: 'the coordinator', name: 'Coordinator', where: 'althar', path: '/projects/p1?room=talk' }
  const threadId = key.slice('thread:'.length)
  return { key, kind: 'task', who: 'the lead', name: titleOf(threadId), where: 'althar', path: `/threads/${threadId}` }
}

/** "To the coordinator · althar", "To the lead · Keep quick tasks on this Mac". */
export const toLine = (address: Address) =>
  address.kind === 'coordinator' ? `To the coordinator · ${address.where}` : `To the lead · ${address.name}`

/** The task on screen, by its thread's key; null where the screen isn't a task. */
export const lookingAt = (path: string): string | null => {
  const match = /^\/threads\/([^/?]+)/.exec(path)
  return match === null ? null : threadKey(match[1] as string)
}

/* ——— What is said: a script, a word at a time; a word written `heard|meant` is heard wrong first, then put right. ——— */

const MAIN = `Okay, about the long dictation one. I’m opening the task to see what the lid|lead did with the scroll. Right, so it follows the newest words while I talk, that part’s good. But when I scroll up to read back what I said, it should stop following, and show a small way back to the end, like a pill that says new words below. Can you make a task for that, and give it to the same lead? It knows the composer. And check it doesn’t fight the one that keeps dictation when I navigate away. Hang on, let me look at the board. Yes, the keep one is still running, so wait for it to land first. And the quick tasks one is in review; tell me when it’s green, and I’ll merge both before lunch.`

const LONG = `A few things from using it this morning. First, when I dictate for more than a minute the composer grows and then stops growing, which is right, but the first words scroll out of sight and I can’t get back to them without stopping. Second, the microphone menu remembers my sure|Shure, good, but when I unplug it mid-sentence it stops and says so, and I’d rather it carried on with the built-in one and told me. Third, Enter to stop is fine, but I keep pressing it twice and the second one sends, so maybe a second Enter within a second should do nothing. Fourth, the waveform is lovely, but it’s hard to see whether it’s still writing down after I stop; the spinner is tiny. ${MAIN}`

type Script = 'main' | 'long'
const TOKENS: Record<Script, ReadonlyArray<string>> = { main: MAIN.split(/\s+/), long: LONG.split(/\s+/) }
/** Where the first part of the script ends: "…when I navigate away." */
const FIRST_PART = TOKENS.main.findIndex((word) => word === 'away.') + 1

const heardAs = (token: string) => token.split('|')[0] as string
const meant = (token: string) => token.split('|').at(-1) as string

export const BARS = 12
export const QUIET: ReadonlyArray<number> = Array.from({ length: BARS }, () => 0)
/** A voice as screenshots hold it. */
const HELD: ReadonlyArray<number> = [0.25, 0.55, 0.8, 0.45, 0.95, 0.6, 0.3, 0.7, 0.5, 0.85, 0.4, 0.62]

/* ——— One dictation. ——— */

export type Phase = 'idle' | 'listening' | 'paused' | 'writing' | 'done' | 'failed' | 'sent' | 'cancelled'

/** Still the person's, in one of the overlays: being said, written down, or written and waiting. */
export const OPEN: ReadonlySet<Phase> = new Set(['listening', 'paused', 'writing', 'done', 'failed'])

export interface Session {
  readonly phase: Phase
  /** Where the person started talking. */
  readonly origin: string
  /** Who it goes to now. */
  readonly to: string
  readonly seconds: number
  readonly levels: ReadonlyArray<number>
  readonly script: Script
  /** How many words have been said. */
  readonly said: number
  /** The last word, while it shows as first heard. */
  readonly misheard: boolean
  /** Written down, and the person's to change. */
  readonly text: string
  /** The Mac is busy: writing down takes longer. */
  readonly slow: boolean
  /** Writing it down fails the first time. */
  readonly failsOnce: boolean
  /** The tasks looked at while it was open, in order. */
  readonly seen: ReadonlyArray<string>
  readonly sentTo: string | null
  /** Send was pressed while it was still being said: it goes once written. */
  readonly sendWhenWritten: string | null
  /** What a Throw away took, to undo it. */
  readonly was: Session | null
  /** Today: the composer it was said into has been on screen the whole time (leaving it loses it). */
  readonly kept: boolean
}

const IDLE: Session = {
  phase: 'idle',
  origin: COORDINATOR,
  to: COORDINATOR,
  seconds: 0,
  levels: QUIET,
  script: 'main',
  said: 0,
  misheard: false,
  text: '',
  slow: false,
  failsOnce: false,
  seen: [],
  sentTo: null,
  sendWhenWritten: null,
  was: null,
  kept: true,
}

/** What has been heard so far: settled up to the last sentence a few words back, the rest still changing. */
export const heardOf = (session: Session): { readonly settled: string; readonly unsettled: string } => {
  const all = TOKENS[session.script].slice(0, session.said)
  const words = all.map((token, index) => (index === all.length - 1 && session.misheard ? heardAs(token) : meant(token)))
  let cut = 0
  for (let index = 0; index < words.length - 3; index += 1) if (/[.?!]$/.test(words[index] as string)) cut = index + 1
  const unsettled = words.slice(cut).join(' ')
  // The full stop the model puts at the end of every pass isn't shown until the stretch settles.
  return { settled: words.slice(0, cut).join(' '), unsettled: unsettled.replace(/[.?!]$/, '') }
}

/** All of it, as the last pass writes it down. */
const writtenOf = (session: Session) => {
  const text = TOKENS[session.script].slice(0, session.said).map(meant).join(' ')
  return text === '' || /[.?!]$/.test(text) ? text : `${text}.`
}

/** 0:07, 2:41. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** How many words, for a line that can't show them all. */
export const wordsIn = (text: string) => text.split(/\s+/).filter((word) => word !== '').length

const presetOf = (preset: Preset): Session => {
  const base: Session = { ...IDLE, phase: 'listening', seen: ['thread:th-scroll'], levels: HELD, kept: false }
  switch (preset) {
    case 'listening':
      return { ...base, said: 19, seconds: 7 }
    case 'long':
      return { ...base, script: 'long', said: 152, seconds: 68 }
    case 'transcribing':
      return { ...base, phase: 'writing', said: FIRST_PART, seconds: 31, slow: true, levels: QUIET }
    case 'finished': {
      const done = { ...base, phase: 'done' as const, said: FIRST_PART, seconds: 31, levels: QUIET }
      return { ...done, text: writtenOf(done) }
    }
    case 'failed':
      return { ...base, phase: 'failed', said: FIRST_PART, seconds: 31, levels: QUIET }
    case 'again':
      return { ...base, said: 112, seconds: 29, seen: ['thread:th-scroll', 'thread:th-quick'] }
  }
}

/** Where each state opens, unless the address says otherwise. */
export const placeOf = (preset: Preset) => (preset === 'again' ? '/threads/th-quick' : '/threads/th-scroll')

/* ——— The page's store. ——— */

export interface Moved {
  readonly from: string
  readonly to: string
  /** What was written and went into the composer it moved to; null while it is still being said. */
  readonly text: string | null
}

export interface Live {
  readonly idea: Idea
  readonly preset: Preset
  /** No clock and no stream, for screenshots. */
  readonly still: boolean
  readonly session: Session
  /** Where the window is. */
  readonly path: string
  /** The composers on screen, by the thread they write to. */
  readonly onScreen: Readonly<Record<string, number>>
  /** The overlay is opened up: the card, the sheet, the peek. */
  readonly open: boolean
  /** Where the pill was dragged to (A), from the bottom right of the window. */
  readonly pos: { readonly x: number; readonly y: number } | null
  /** E: the words moved into the composer on screen, with a way back. */
  readonly moved: Moved | null
  /** Words written for a composer that isn't on screen, waiting to go into its field. */
  readonly pending: Readonly<Record<string, string>>
  /** What else runs over the composer you land on. */
  readonly crowd: Crowd
  /** Where A's pill goes among them. */
  readonly place: APlace
}

const params = new URLSearchParams(window.location.search)
const ideaOf = (value: string | null): Idea => (IDEAS.find((one) => one.value === value)?.value ?? 'A') as Idea
const presetFrom = (value: string | null): Preset => PRESETS.find((one) => one.value === value)?.value ?? 'listening'

const firstPreset = presetFrom(params.get('state'))

let live: Live = {
  crowd: CROWDS.find((one) => one.value === params.get('crowd'))?.value ?? 'none',
  place: A_PLACES.find((one) => one.value === params.get('place'))?.value ?? 'above',
  idea: ideaOf(params.get('idea')),
  preset: firstPreset,
  still: params.has('still'),
  session: presetOf(firstPreset),
  path: params.get('at') ?? placeOf(firstPreset),
  onScreen: {},
  open: params.has('open'),
  pos: null,
  moved: null,
  pending: {},
}

const listeners = new Set<() => void>()

export const store = {
  get: () => live,
  set: (next: Partial<Live>) => {
    live = { ...live, ...next }
    listeners.forEach((listener) => listener())
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

export const useLive = () => useSyncExternalStore(store.subscribe, store.get)

const setSession = (change: Partial<Session>) => store.set({ session: { ...live.session, ...change } })

/* ——— The fake stream: a word every so often while listening, the clock, and the voice's bars. ——— */

let wordTimer: number | null = null
let lastWordAt = 0

const nextWord = () => {
  wordTimer = null
  const now = live.session
  if (now.phase !== 'listening' || live.still) return
  if (now.misheard) setSession({ misheard: false })
  else if (now.said < TOKENS[now.script].length) {
    const token = TOKENS[now.script][now.said] as string
    setSession({ said: now.said + 1, misheard: token.includes('|') })
    lastWordAt = Date.now()
  }
  speak()
}

/** Says the next word after a pause like a person's: longer after a sentence, shorter after a comma. */
const speak = () => {
  const now = live.session
  if (wordTimer !== null || now.phase !== 'listening' || live.still) return
  const last = TOKENS[now.script][now.said - 1] ?? ''
  const delay = now.misheard ? 260 : /[.?!]$/.test(last) ? 750 : /[,;]$/.test(last) ? 380 : 150 + Math.random() * 190
  wordTimer = window.setTimeout(nextWord, delay)
}

window.setInterval(() => {
  if (live.session.phase === 'listening' && !live.still) setSession({ seconds: live.session.seconds + 1 })
}, 1000)

window.setInterval(() => {
  if (live.session.phase !== 'listening' || live.still) return
  const talking = Date.now() - lastWordAt < 320
  const level = talking ? 0.35 + Math.random() * 0.65 : Math.random() * 0.12
  setSession({ levels: [...live.session.levels.slice(1 - BARS), level] })
}, 110)

let writeTimer: number | null = null

/** Writing it down: a moment, longer while the Mac is busy; it fails once where the state says so. */
const writeDown = () => {
  if (writeTimer !== null) window.clearTimeout(writeTimer)
  writeTimer = null
  if (live.still) return
  writeTimer = window.setTimeout(
    () => {
      writeTimer = null
      const now = live.session
      if (now.phase !== 'writing') return
      if (now.failsOnce) return setSession({ phase: 'failed', failsOnce: false, sendWhenWritten: null })
      setSession({ phase: 'done', text: writtenOf(now), slow: false })
      if (now.sendWhenWritten !== null) act.send(now.sendWhenWritten)
    },
    live.session.slow ? 9000 : 2400,
  )
}

let settleTimer: number | null = null
/** Sent or thrown away: it says so for a few seconds, then goes. */
const settleLater = (phase: Phase) => {
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    if (live.session.phase === phase) store.set({ session: { ...IDLE }, open: false })
  }, 6000)
}

/* ——— What the person does. ——— */

export const act = {
  setIdea: (idea: Idea) => store.set({ idea, moved: null }),
  setCrowd: (crowd: Crowd) => store.set({ crowd }),
  /** Another place for A's pill: it leaves wherever it was dragged. */
  setPlace: (place: APlace) => store.set({ place, pos: null }),
  /** A state from the picker: the dictation starts again from it, where the window is. */
  setPreset: (preset: Preset) => {
    store.set({ preset, session: presetOf(preset), moved: null, pending: {}, open: params.has('open') })
    if (preset === 'transcribing') writeDown()
    speak()
  },
  /** The microphone in a composer: a new dictation there, or the one under way comes here. */
  start: (key: string) => {
    const now = live.session
    if (now.phase === 'listening' || now.phase === 'paused' || now.phase === 'writing') {
      if (now.to !== key) store.set({ moved: { from: now.to, to: key, text: null }, session: { ...now, to: key } })
      return
    }
    store.set({ session: { ...IDLE, phase: 'listening', origin: key, to: key, seen: [], kept: true }, moved: null, open: false })
    speak()
  },
  stop: () => {
    const now = live.session
    if (now.phase !== 'listening' && now.phase !== 'paused') return
    setSession({ phase: 'writing', levels: QUIET, misheard: false })
    writeDown()
  },
  pause: () => live.session.phase === 'listening' && setSession({ phase: 'paused', levels: QUIET }),
  resume: () => {
    if (live.session.phase !== 'paused') return
    setSession({ phase: 'listening' })
    speak()
  },
  /** Throws it away, with a few seconds to undo it. */
  cancel: () => {
    const now = live.session
    if (!OPEN.has(now.phase)) return
    store.set({ session: { ...now, phase: 'cancelled', was: now }, moved: null })
    settleLater('cancelled')
  },
  undoCancel: () => {
    const was = live.session.was
    if (live.session.phase !== 'cancelled' || was === null) return
    store.set({ session: was })
    if (was.phase === 'listening') speak()
    if (was.phase === 'writing') writeDown()
  },
  retry: () => {
    if (live.session.phase !== 'failed') return
    setSession({ phase: 'writing' })
    writeDown()
  },
  edit: (text: string) => setSession({ text }),
  /** Sends it to `to`; still being said, it is written down first and goes then. */
  send: (to: string) => {
    const now = live.session
    if (now.phase === 'listening' || now.phase === 'paused') {
      setSession({ sendWhenWritten: to })
      return act.stop()
    }
    if (now.phase === 'writing') return setSession({ sendWhenWritten: to })
    if (now.phase !== 'done' || now.text.trim() === '') return
    addSent(to, now.text.trim())
    store.set({ session: { ...now, phase: 'sent', sentTo: to }, moved: null })
    settleLater('sent')
  },
  /** Who it goes to, from now on. */
  address: (to: string) => setSession({ to }),
  open: (open: boolean) => store.set({ open }),
  drag: (pos: Live['pos']) => store.set({ pos }),
  /** E: back where it was going, from the composer it moved into. */
  moveBack: () => {
    const moved = live.moved
    if (moved === null) return
    if (moved.text === null) {
      store.set({ moved: null, session: { ...live.session, to: moved.from } })
      return
    }
    // Already written into this composer's field: out of it, and into the other's, for when it shows.
    drafts.get(moved.to)?.((draft) => draft.replace(moved.text ?? '', '').trim())
    store.set({ moved: null, pending: { ...live.pending, [moved.from]: joinText(live.pending[moved.from] ?? '', moved.text) } })
  },
  forgetMove: () => store.set({ moved: null }),
  /** Today: gone, saying nothing. */
  lose: () => store.set({ session: { ...IDLE } }),
}

/** Two pieces of text, with a space between where they need one. */
export const joinText = (before: string, after: string) =>
  before.trim() === '' ? after : after === '' ? before : `${before.trimEnd()} ${after}`

/* ——— Composers, as the seams tell of them. ——— */

/** Each composer's field, by the thread it writes to, while its screen is up: what is written lands in it. */
export const drafts = new Map<string, (change: (draft: string) => string) => void>()

/** A composer for `key` is on screen; E moves what is being said into it. Returns its going. */
export const composerShown = (key: string) => {
  store.set({ onScreen: { ...live.onScreen, [key]: (live.onScreen[key] ?? 0) + 1 } })
  const now = live.session
  if (live.idea === 'E' && OPEN.has(now.phase) && now.to !== key && now.phase !== 'failed') {
    store.set({ moved: { from: now.to, to: key, text: null }, session: { ...now, to: key } })
  }
  return () => store.set({ onScreen: { ...live.onScreen, [key]: Math.max(0, (live.onScreen[key] ?? 1) - 1) } })
}

/** Today: the screen whose composer it was said into went, and what was said with it. */
export const screenGone = (key: string) => {
  if (live.session.to === key) setSession({ kept: false })
}

/** Where the window went: the tasks looked at, while it is open. */
export const visit = (path: string) => {
  const now = live.session
  const task = lookingAt(path)
  const seen = task !== null && OPEN.has(now.phase) && now.seen.at(-1) !== task ? [...now.seen, task] : now.seen
  store.set({ path, session: seen === now.seen ? now : { ...now, seen } })
}

// The state the page opened on.
if (live.session.phase === 'writing') writeDown()
speak()
