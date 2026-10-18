import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react'

import {
  chord,
  commandDown,
  type Dictation,
  type DictationState as TrayState,
  DictationSetup,
  type DictationTrayProps,
  keys,
} from '@althar/ui'

import { reads } from '../../data/reads'
import { type DictationEvent, type DictationHost, type DictationState, type DownloadStop, useServices } from '../../data/services'
import { draftOf, setDraftText, useDraftOf } from '../drafts'
import { joined, live } from './live'
import { chooseMicrophone, microphoneToUse, useChosenMicrophone, useMicrophones } from './microphones'
import { type Record, type Recorded, record as recordMicrophone } from './recorder'
import {
  BARS,
  changeSession,
  composerShown,
  type Destination,
  type Handles,
  handlesOf,
  listeningIn,
  type Said,
  sessionOf,
  useSession,
} from './sessions'
import { bytes, lengthOf, timeLeft, trayText } from './text'
import { NO_VOCABULARY, respell, type Vocabulary, vocabularyOf } from './vocabulary'

/*
 * Dictation in a composer (ADR-017), the first time and every time after.
 * Pressing the microphone with no speech model on this machine opens the
 * composer's tray, which offers it; nothing comes down until the person says
 * Download. The microphone is asked for first, so a no costs nothing. Once the
 * model is here, and if the tray is still open, it listens. What is said
 * shows faint at the cursor as it is said (`live.ts`), and is written there
 * once it stops, with the project's own names spelt as its code spells them
 * (`vocabulary.ts`); never sent. Escape while listening throws it away.
 *
 * A menu beside the microphone chooses which one it hears (`microphones.ts`).
 * Chosen while listening, it goes on from the new one, and what was said
 * before stays.
 *
 * ⌘⇧D (Ctrl+Shift+D elsewhere) starts and stops it from anywhere in the
 * window; held down, letting go stops it. Where two composers dictate, the
 * one shown last has it.
 *
 * Asking where things stand happens on the first press, not as the composer
 * shows, so a window that never dictates never starts the speech process.
 *
 * What is said belongs to the thread, not the composer (`sessions.ts`):
 * leaving while it listens goes on listening, carried with the person in a
 * pill (`Carried.tsx`) that stops, throws away and sends it from anywhere;
 * what is written down lands in the thread's draft (`drafts.ts`) whether or
 * not its composer still shows. One thread listens at a time: starting in
 * another writes down what the first heard. What couldn't be written down is
 * kept, to try again, until the person throws it away.
 */

/** The longest anyone dictates in one go; it stops and writes it down there. */
const LONGEST = 5 * 60
/* Shorter than this is a tap on the button, not something said. */
const SHORTEST = 0.3
type Problem =
  | { readonly kind: 'denied' }
  | { readonly kind: 'noMicrophone' }
  | { readonly kind: 'stopped'; readonly got: number; readonly size: number }
  | { readonly kind: 'noRoom'; readonly need: number; readonly free: number }

/* The shortcut, as the window's own system writes it. */
export const SHORTCUT = chord(keys.mod, keys.shift, 'D')
/* Held this long, the shortcut is held to talk: letting go stops. */
const HELD = 500

/* The composers that dictate, the one shown last at the end: the shortcut is its. */
const claims: Array<symbol> = []

/* A host with no dictation: never called, since its window shows no microphone. */
const NONE: DictationHost = {
  state: () => Promise.reject(new Error('No dictation here.')),
  allow: async () => false,
  download: async () => {},
  cancel: async () => {},
  prepare: async () => {},
  transcribe: async () => '',
  openSettings: async () => false,
  onEvent: () => () => {},
}

interface Download {
  readonly got: number
  readonly size: number
  /** Bytes a second, smoothed; 0 until it is known. */
  readonly rate: number
  readonly at: number
}

export interface Voice {
  /** The composer's microphone; undefined where the window can't dictate. */
  readonly dictation: Dictation | undefined
  /** The tray on the composer's top, when it shows. */
  readonly tray: Omit<DictationTrayProps, 'ref'> | null
  /** The composer's field, so what was said lands at its cursor. */
  readonly inputRef: RefObject<HTMLTextAreaElement | null>
}

const isEvent = (event: unknown): event is DictationEvent =>
  typeof event === 'object' &&
  event !== null &&
  ['progress', 'downloaded', 'stopped', 'cancelled'].includes((event as { type?: unknown }).type as string)

const problemOf = (stop: DownloadStop, got: number, size: number): Problem =>
  stop.reason === 'space' ? { kind: 'noRoom', need: stop.need, free: stop.free } : { kind: 'stopped', got, size }

/** Puts `words` in at `at`, with a space either side where it needs one, and the field's cursor after them. */
const inserting = (field: HTMLTextAreaElement | null, at: number, words: string) => (now: string) => {
  const before = now.slice(0, Math.min(at, now.length))
  const after = now.slice(Math.min(at, now.length))
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const trail = after !== '' && !/^\s/.test(after) ? ' ' : ''
  const caret = (before + lead + words).length
  requestAnimationFrame(() => {
    field?.focus()
    field?.setSelectionRange(caret, caret)
  })
  return before + lead + words + trail + after
}

export interface DictationOptions {
  /** The project dictated about, whose names are spelt as its code spells them. */
  readonly projectId?: string | null
  /** Whose it is, said by the pill that carries it once the person leaves; null until the view knows. */
  readonly to?: Destination | null
  /** The microphone; tests give a fake. */
  readonly record?: Record
}

/** What was heard at one rate, as heard at another, each sample between the two nearest. */
const atRate = (heard: Recorded, rate: number): Float32Array => {
  if (heard.sampleRate === rate) return heard.samples
  const step = heard.sampleRate / rate
  const samples = new Float32Array(Math.round(heard.samples.length / step))
  for (let i = 0; i < samples.length; i += 1) {
    const x = i * step
    const j = Math.floor(x)
    const a = heard.samples[j] ?? 0
    samples[i] = a + ((heard.samples[j + 1] ?? a) - a) * (x - j)
  }
  return samples
}

/** Two recordings that couldn't be written down, as one, to try again together: at the later's rate, where they were heard at different rates. */
export const together = (kept: Said | null, said: Said): Said => {
  if (kept === null) return said
  const before = atRate(kept, said.sampleRate)
  const samples = new Float32Array(before.length + said.samples.length)
  samples.set(before)
  samples.set(said.samples, before.length)
  return { samples, sampleRate: said.sampleRate, seconds: kept.seconds + said.seconds }
}

/**
 * Writes down all of what was said in `thread`, at where it started: by the
 * live writer as it stops, or again as it is retried. It lands in the
 * thread's draft whether or not its composer still shows; written while
 * none shows, the composer says so when the person is back. What can't be
 * written down is kept, to try again.
 */
export const writeIn = async (thread: string, said: Said, now = handlesOf(thread).writer) => {
  const held = handlesOf(thread)
  held.writer = null
  changeSession(thread, { phase: 'writing' })
  try {
    const text = now !== null ? await now.finish(said) : await (held.transcribe ?? nothingToWriteWith)(said)
    // The window forgot the thread's dictation meanwhile: nothing to land in.
    if (handlesOf(thread) !== held) return
    // Nothing was heard: nothing to carry either.
    if (text === '') return changeSession(thread, { phase: 'idle', interim: '', away: null })
    const away = held.shown === 0
    setDraftText(thread, inserting(away ? null : (held.field?.current ?? null), sessionOf(thread).at, text))
    changeSession(thread, { phase: 'idle', interim: '', arrived: away ? draftOf(thread).text : null })
  } catch {
    if (handlesOf(thread) !== held) return
    changeSession(thread, (now) => ({ phase: 'idle', interim: '', failed: together(now.failed, said) }))
  }
}

const nothingToWriteWith = () => Promise.reject(new Error('Nothing to write it down with.'))

const stopClock = (held: Handles) => {
  if (held.clock === null) return
  window.clearInterval(held.clock)
  held.clock = null
}

/** Stops listening in `thread`, its composer on screen or not, and writes down what was said. */
export const stopIn = (thread: string) => {
  const held = handlesOf(thread)
  stopClock(held)
  const now = held.recording
  held.recording = null
  if (now === null) return
  const { samples, sampleRate } = now.stop()
  changeSession(thread, (session) => ({ levels: session.levels.map(() => 0) }))
  if (samples.length < sampleRate * SHORTEST) {
    held.writer?.close()
    held.writer = null
    return changeSession(thread, { interim: '', phase: 'idle', away: null })
  }
  void writeIn(thread, { seconds: sessionOf(thread).seconds, samples, sampleRate })
}

/** Throws away what `thread` is hearing, its composer on screen or not. */
export const cancelIn = (thread: string) => {
  const held = handlesOf(thread)
  stopClock(held)
  held.recording?.cancel()
  held.recording = null
  held.writer?.close()
  held.writer = null
  changeSession(thread, (session) => ({ interim: '', levels: session.levels.map(() => 0), phase: 'idle', away: null }))
}

/** The clock while `thread` listens, wherever the person is, and its end at the longest anyone dictates. */
const startClock = (thread: string) => {
  const held = handlesOf(thread)
  stopClock(held)
  held.clock = window.setInterval(() => {
    changeSession(thread, (session) => ({ seconds: session.seconds + 1 }))
    if (sessionOf(thread).seconds >= LONGEST) stopIn(thread)
  }, 1000)
}

/** A ref for the composer's field that says whether the field is on screen: the composer shows, not just its view. */
const fieldRef = (onField: (field: HTMLTextAreaElement | null) => void): RefObject<HTMLTextAreaElement | null> => {
  let field: HTMLTextAreaElement | null = null
  return {
    get current() {
      return field
    },
    set current(next) {
      field = next
      onField(next)
    },
  }
}

/** Dictation into the draft kept under `key` (`drafts.ts`): the thread's, which it outlives its composer for. */
export function useDictation(key: string, options: DictationOptions = {}): Voice {
  const { record = recordMicrophone, projectId = null, to = null } = options
  const { host, client, cache } = useServices()
  const voice = host.dictation ?? NONE
  /* Whether the composer's field is on screen: a view can keep its dictation while it shows something else, its board or a task's outputs. */
  const [showing, setShowing] = useState(false)
  const [inputRef] = useState(() => fieldRef((field) => setShowing(field !== null)))
  const [known, setKnown] = useState<DictationState | null>(null)
  const [download, setDownload] = useState<Download | null>(null)
  const [open, setOpen] = useState(false)
  /* The system is asked for the microphone. */
  const [asking, setAsking] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const { phase, seconds, levels, interim, at, failed, arrived } = useSession(key)
  const draft = useDraftOf(key).text
  const vocabulary = useRef<{ readonly projectId: string | null; readonly words: Vocabulary }>({ projectId: null, words: NO_VOCABULARY })
  const prepared = useRef(false)
  /* Download was pressed: once the model is here, it listens, if the tray is still open. */
  const listenWhenHere = useRef(false)
  const chosen = useChosenMicrophone()
  const { microphones, refresh: refreshMicrophones } = useMicrophones()
  const input = microphoneToUse(chosen, microphones)

  const refresh = async () => {
    const state = await voice.state()
    setKnown(state)
    if (state.model.downloading) setDownload((d) => d ?? { got: state.model.got, size: state.model.size, rate: 0, at: Date.now() })
    return state
  }

  /** The microphone, asked for where the system asks; false, with the tray saying so, where it was refused. */
  const microphone = async (state: DictationState) => {
    if (state.microphone === 'granted') return true
    if (state.microphone === 'denied') {
      setProblem({ kind: 'denied' })
      setOpen(true)
      return false
    }
    setAsking(true)
    setOpen(true)
    const allowed = await voice.allow().catch(() => false)
    setAsking(false)
    if (!allowed) {
      setProblem({ kind: 'denied' })
      return false
    }
    setKnown({ ...state, microphone: 'granted' })
    return true
  }

  /** What was said, as text, with the project's names spelt as its code spells them. */
  const transcribe = async (recorded: Recorded) =>
    respell(await voice.transcribe(recorded.samples, recorded.sampleRate), vocabulary.current.words)

  /** The project's names, read once a window as someone first dictates in it; dictation goes on without them meanwhile. */
  const learn = () => {
    if (projectId === null || vocabulary.current.projectId === projectId) return
    vocabulary.current = { projectId, words: NO_VOCABULARY }
    cache
      .fetchQuery(reads(client).vocabulary(projectId))
      .then((words) => {
        if (vocabulary.current.projectId === projectId) vocabulary.current = { projectId, words: vocabularyOf(words) }
      })
      .catch(() => (vocabulary.current = { projectId: null, words: NO_VOCABULARY }))
  }

  const listen = async (state: DictationState) => {
    const held = handlesOf(key)
    if (!(await microphone(state))) return
    // The person left while the system asked: nothing to listen for.
    if (held.shown === 0) return
    // One thread listens at a time: one carried from elsewhere is written down first.
    for (const other of listeningIn()) if (other !== key) stopIn(other)
    held.transcribe = transcribe
    // The model loads while the person talks, so its first words don't wait for it; writing down waits if it must.
    if (!prepared.current) {
      prepared.current = true
      voice.prepare().catch(() => (prepared.current = false))
    }
    learn()
    const now = live(
      transcribe,
      (text) => changeSession(key, { interim: joined(text.settled, text.unsettled) }),
      // A pass as they stopped that wrote fewer words than showed goes in the window's log, as counts only, so a loss can be traced.
      (ended) => {
        if (ended.whole === null || ended.whole < ended.shown)
          console.warn('[dictation] the last pass wrote less than showed', JSON.stringify(ended))
      },
    )
    try {
      held.recording = await record((frame) => {
        changeSession(key, (session) => ({ levels: [...session.levels.slice(1 - BARS), frame.level] }))
        if (held.recording !== null) now.frame(frame, held.recording)
      }, input)
      held.hearing = input
      // The person left while the microphone opened: it closes, having heard nothing yet, so nothing listens where nobody sees.
      if (held.shown === 0) {
        held.recording?.cancel()
        held.recording = null
        now.close()
        return
      }
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? { kind: 'denied' } : { kind: 'noMicrophone' })
      setOpen(true)
      return
    }
    held.writer = now
    // The system names its microphones once one may be used.
    refreshMicrophones()
    changeSession(key, {
      at: held.field?.current?.selectionStart ?? held.field?.current?.value.length ?? 0,
      interim: '',
      seconds: 0,
      arrived: null,
      away: null,
      phase: 'listening',
    })
    startClock(key)
    setProblem(null)
    setOpen(false)
  }

  const stop = () => stopIn(key)

  /** The menu beside the microphone: kept for next time, and heard from now on where it is listening. */
  const chooseInput = (id: string | null) => chooseMicrophone(id === null ? null : (microphones.find((m) => m.id === id) ?? null))

  const startDownload = async (state: DictationState) => {
    setProblem(null)
    setDownload((d) => d ?? { got: state.model.got, size: state.model.size, rate: 0, at: Date.now() })
    await voice.download().catch(() => {
      setDownload(null)
      setProblem({ kind: 'stopped', got: state.model.got, size: state.model.size })
    })
  }

  /** The tray's Download: the microphone first, then the model, then listening once it is here. */
  const accept = async () => {
    const state = await refresh()
    if (!(await microphone(state))) return
    listenWhenHere.current = true
    await startDownload(state)
  }

  /** The composer's microphone. */
  const press = async () => {
    if (phase !== 'idle' || asking) return
    const state = await refresh().catch(() => null)
    if (state === null) return
    if (state.model.ready) return listen(state)
    if (open) {
      setOpen(false)
      if (problem?.kind !== 'stopped' && problem?.kind !== 'noRoom') setProblem(null)
    } else setOpen(true)
  }

  const heard = useEffectEvent((event: unknown) => {
    if (!isEvent(event)) return
    switch (event.type) {
      case 'progress':
        return setDownload((d) => {
          const at = Date.now()
          if (d === null || at <= d.at) return { got: event.got, size: event.size, rate: d?.rate ?? 0, at }
          const now = ((event.got - d.got) * 1000) / (at - d.at)
          return { got: event.got, size: event.size, rate: d.rate === 0 ? now : d.rate * 0.85 + now * 0.15, at }
        })
      case 'downloaded': {
        setDownload(null)
        setKnown((state) => state && { ...state, model: { ...state.model, ready: true, got: state.model.size, downloading: false } })
        const listening = listenWhenHere.current && open
        listenWhenHere.current = false
        if (listening && known !== null) void listen({ ...known, microphone: 'granted', model: { ...known.model, ready: true } })
        return
      }
      case 'stopped':
        setDownload(null)
        setProblem(problemOf(event.stop, event.got, event.size))
        return setOpen(true)
      case 'cancelled':
        setDownload(null)
        setProblem(null)
        listenWhenHere.current = false
        return setKnown((state) => state && { ...state, model: { ...state.model, ready: false, got: 0, downloading: false } })
    }
  })
  useEffect(() => voice?.onEvent(heard), [voice])

  const listening = phase === 'listening'

  // While listening, the microphone heard follows the one to hear: chosen in the menu, named once the system names them, gone, or back.
  useEffect(() => {
    const held = handlesOf(key)
    if (!listening || held.recording === null || held.hearing === input) return
    held.hearing = input
    void held.recording.use(input)
  }, [listening, input, key])

  // Escape while listening throws it away, before anything else hears it (going back from a task); only where its composer shows, so a pill carrying it is never lost by a key.
  const escape = useEffectEvent(() => cancelIn(key))
  useEffect(() => {
    if (!listening || !showing) return
    const onKey = (event: KeyboardEvent) => {
      // Escape in the list of microphones closes the list, not what is being said.
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('[role="menu"]') !== null)) return
      event.preventDefault()
      event.stopPropagation()
      escape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, showing])

  // Whose it is, for the pill that carries it once the person leaves.
  useEffect(() => {
    handlesOf(key).to = to
  }, [key, to])

  // The thread's composer shows: what is written down lands at its cursor, and nothing is carried. Leaving it, for another view or another face of this one, goes on listening, or writing down, carried with the person.
  useEffect(() => {
    if (!showing) return
    const held = handlesOf(key)
    held.shown += 1
    held.field = inputRef
    composerShown(key, true)
    changeSession(key, { away: null })
    return () => {
      held.shown -= 1
      if (held.field === inputRef) held.field = null
      composerShown(key, false)
      if (held.shown === 0 && sessionOf(key).phase !== 'idle') changeSession(key, { away: Date.now() })
    }
  }, [key, showing, inputRef])

  // The shortcut: pressed, it starts or stops; held down, letting go stops. Only the composer shown last hears it.
  const pressedAt = useRef<number | null>(null)
  const shortcutDown = useEffectEvent(() => {
    if (phase === 'listening') {
      pressedAt.current = null
      return stop()
    }
    pressedAt.current = Date.now()
    void press()
  })
  const shortcutUp = useEffectEvent(() => {
    const held = pressedAt.current !== null && Date.now() - pressedAt.current >= HELD
    pressedAt.current = null
    if (held && phase === 'listening') stop()
  })
  useEffect(() => {
    if (host.dictation === undefined || !showing) return
    const me = Symbol('dictation')
    claims.push(me)
    const mine = () => claims.at(-1) === me
    const onDown = (event: KeyboardEvent) => {
      if (!mine() || event.key.toLowerCase() !== 'd' || !commandDown(event) || !event.shiftKey || event.altKey) return
      event.preventDefault()
      if (!event.repeat) shortcutDown()
    }
    // On a Mac, letting go of D while ⌘ is down says nothing: letting go of any of the three ends the hold.
    const onUp = (event: KeyboardEvent) => {
      if (mine() && ['d', 'D', 'Meta', 'Control', 'Shift'].includes(event.key)) shortcutUp()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      claims.splice(claims.indexOf(me), 1)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [host.dictation, showing])

  if (host.dictation === undefined) return { dictation: undefined, tray: null, inputRef }

  const shown = ((): TrayState | null => {
    if (!open && problem === null && failed === null) return null
    if (problem !== null)
      switch (problem.kind) {
        case 'denied':
          return { kind: DictationSetup.Denied }
        case 'noMicrophone':
          return { kind: DictationSetup.NoMicrophone }
        case 'stopped':
          return {
            kind: DictationSetup.Stopped,
            got: bytes(problem.got),
            size: bytes(problem.size),
            progress: problem.got / problem.size,
          }
        case 'noRoom':
          return { kind: DictationSetup.NoRoom, need: bytes(problem.need), free: bytes(problem.free) }
      }
    // What couldn't be written down waits here, the person back or not, until they try again or throw it away.
    if (failed !== null) return { kind: DictationSetup.Failed, said: lengthOf(failed.seconds) }
    if (asking) return { kind: DictationSetup.Asking }
    if (download !== null) {
      const left = timeLeft(download.size - download.got, download.rate)
      return {
        kind: DictationSetup.Downloading,
        got: bytes(download.got),
        size: bytes(download.size),
        progress: download.got / download.size,
        ...(left === undefined ? {} : { left }),
      }
    }
    if (known !== null && !known.model.ready) return { kind: DictationSetup.Offer, size: bytes(known.model.size) }
    return null
  })()

  const settingsPane = problem?.kind === 'denied' ? 'privacy' : problem?.kind === 'noMicrophone' ? 'sound' : null
  const tray: Voice['tray'] =
    shown === null
      ? null
      : {
          state: shown,
          text: trayText(known?.platform ?? ''),
          onDownload: () => void accept(),
          onCancel: () => {
            listenWhenHere.current = false
            setOpen(false)
            setProblem(null)
            setDownload(null)
            void voice.cancel()
          },
          onRetry: () => {
            if (problem === null && failed !== null) {
              // Tried again once it has stopped listening, so the two never write over each other.
              if (phase !== 'idle') return
              changeSession(key, { failed: null })
              handlesOf(key).transcribe = transcribe
              return void writeIn(key, failed, null)
            }
            if (known !== null) void startDownload(known)
          },
          ...(settingsPane !== null && known?.settings === true ? { onOpenSettings: () => void voice.openSettings(settingsPane) } : {}),
          onDiscard: () => {
            changeSession(key, { failed: null })
            setOpen(false)
          },
          // What was said and couldn't be written down goes only by Throw it away: Escape doesn't lose it.
          ...(problem === null && failed !== null
            ? {}
            : {
                onDismiss: () => {
                  setOpen(false)
                  if (problem?.kind !== 'stopped' && problem?.kind !== 'noRoom') setProblem(null)
                },
              }),
        }

  return {
    dictation: {
      elapsed: listening ? lengthOf(seconds) : null,
      levels,
      interim,
      at,
      kbd: SHORTCUT,
      busy: phase === 'writing',
      // Written down while the person was away, and the draft not changed since.
      arrived: arrived !== null && arrived === draft,
      expanded: shown !== null,
      ...(download !== null && shown === null ? { progress: download.got / download.size } : {}),
      inputs: microphones,
      input: microphones.some((m) => m.id === input) ? input : null,
      onChooseInput: chooseInput,
      onStart: () => void press(),
      onStop: stop,
    },
    tray,
    inputRef,
  }
}
