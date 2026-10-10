import { type Dispatch, type RefObject, type SetStateAction, useEffect, useEffectEvent, useRef, useState } from 'react'

import { type Dictation, type DictationState as TrayState, DictationSetup, type DictationTrayProps } from '@althar/ui'

import { reads } from '../../data/reads'
import { type DictationEvent, type DictationHost, type DictationState, type DownloadStop, useServices } from '../../data/services'
import { joined, live } from './live'
import { type Record, type Recorded, record as recordMicrophone, type Recording } from './recorder'
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
 * ⌘⇧D (Ctrl+Shift+D elsewhere) starts and stops it from anywhere in the
 * window; held down, letting go stops it. Where two composers dictate, the
 * one shown last has it.
 *
 * Asking where things stand happens on the first press, not as the composer
 * shows, so a window that never dictates never starts the speech process.
 */

/** The longest anyone dictates in one go; it stops and writes it down there. */
const LONGEST = 5 * 60
/* Shorter than this is a tap on the button, not something said. */
const SHORTEST = 0.3
/* How many bars the composer draws. */
const BARS = 12

type Phase = 'idle' | 'asking' | 'listening' | 'writing'

type Problem =
  | { readonly kind: 'denied' }
  | { readonly kind: 'noMicrophone' }
  | { readonly kind: 'stopped'; readonly got: number; readonly size: number }
  | { readonly kind: 'noRoom'; readonly need: number; readonly free: number }
  /** What was said is kept, to try again. */
  | { readonly kind: 'failed'; readonly said: Said }

interface Said extends Recorded {
  readonly seconds: number
}

/* The shortcut, as the window's own system writes it. */
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)
export const SHORTCUT = MAC ? '⌘⇧D' : 'Ctrl+Shift+D'
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
  /** The microphone; tests give a fake. */
  readonly record?: Record
}

export function useDictation(setDraft: Dispatch<SetStateAction<string>>, options: DictationOptions = {}): Voice {
  const { record = recordMicrophone, projectId = null } = options
  const { host, client, cache } = useServices()
  const voice = host.dictation ?? NONE
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [known, setKnown] = useState<DictationState | null>(null)
  const [download, setDownload] = useState<Download | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<ReadonlyArray<number>>(() => Array.from({ length: BARS }, () => 0))
  const recording = useRef<Recording | null>(null)
  const writer = useRef<ReturnType<typeof live> | null>(null)
  const [interim, setInterim] = useState('')
  /* Where what is said lands: the field's cursor as it started listening. */
  const [at, setAt] = useState(0)
  const vocabulary = useRef<{ readonly projectId: string | null; readonly words: Vocabulary }>({ projectId: null, words: NO_VOCABULARY })
  const prepared = useRef(false)
  /* Download was pressed: once the model is here, it listens, if the tray is still open. */
  const listenWhenHere = useRef(false)

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
    setPhase('asking')
    setOpen(true)
    const allowed = await voice.allow().catch(() => false)
    setPhase('idle')
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

  /** Writes down all of what was said, at where it started: by the live writer as it stops, or again as it is retried. */
  const write = async (said: Said, now = writer.current) => {
    writer.current = null
    setPhase('writing')
    try {
      const text = now === null ? await transcribe(said) : await now.finish(said)
      setPhase('idle')
      setInterim('')
      if (text !== '') setDraft(inserting(inputRef.current, at, text))
    } catch {
      setPhase('idle')
      setInterim('')
      setProblem({ kind: 'failed', said })
      setOpen(true)
    }
  }

  const listen = async (state: DictationState) => {
    if (!(await microphone(state))) return
    // The model loads while the person talks, so its first words don't wait for it; writing down waits if it must.
    if (!prepared.current) {
      prepared.current = true
      voice.prepare().catch(() => (prepared.current = false))
    }
    learn()
    const now = live(
      transcribe,
      (text) => setInterim(joined(text.settled, text.unsettled)),
      // A pass as they stopped that wrote fewer words than showed goes in the window's log, as counts only, so a loss can be traced.
      (ended) => {
        if (ended.whole === null || ended.whole < ended.shown)
          console.warn('[dictation] the last pass wrote less than showed', JSON.stringify(ended))
      },
    )
    try {
      recording.current = await record((frame) => {
        setLevels((bars) => [...bars.slice(1 - BARS), frame.level])
        if (recording.current !== null) now.frame(frame, recording.current)
      })
    } catch (error) {
      setPhase('idle')
      const name = error instanceof DOMException ? error.name : ''
      setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? { kind: 'denied' } : { kind: 'noMicrophone' })
      setOpen(true)
      return
    }
    writer.current = now
    setAt(inputRef.current?.selectionStart ?? inputRef.current?.value.length ?? 0)
    setInterim('')
    setSeconds(0)
    setProblem(null)
    setOpen(false)
    setPhase('listening')
  }

  const stop = () => {
    const now = recording.current
    recording.current = null
    if (now === null) return
    const { samples, sampleRate } = now.stop()
    setLevels((bars) => bars.map(() => 0))
    if (samples.length < sampleRate * SHORTEST) {
      writer.current?.close()
      writer.current = null
      setInterim('')
      return setPhase('idle')
    }
    void write({ seconds, samples, sampleRate })
  }

  const cancelListening = () => {
    recording.current?.cancel()
    recording.current = null
    writer.current?.close()
    writer.current = null
    setInterim('')
    setLevels((bars) => bars.map(() => 0))
    setPhase('idle')
  }

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
    if (phase !== 'idle') return
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

  // The clock while listening, and its end at the longest anyone dictates.
  const listening = phase === 'listening'
  useEffect(() => {
    if (!listening) return
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [listening])
  const tooLong = useEffectEvent(() => stop())
  useEffect(() => {
    if (listening && seconds >= LONGEST) tooLong()
  }, [listening, seconds])

  // Escape while listening throws it away, before anything else hears it (going back from a task).
  const escape = useEffectEvent(() => cancelListening())
  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      escape()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening])

  // Leaving while listening keeps nothing.
  useEffect(
    () => () => {
      recording.current?.cancel()
      writer.current?.close()
    },
    [],
  )

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
    if (host.dictation === undefined) return
    const me = Symbol('dictation')
    claims.push(me)
    const mine = () => claims.at(-1) === me
    const onDown = (event: KeyboardEvent) => {
      if (!mine() || event.key.toLowerCase() !== 'd' || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
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
  }, [host.dictation])

  if (host.dictation === undefined) return { dictation: undefined, tray: null, inputRef }

  const shown = ((): TrayState | null => {
    if (!open && problem === null) return null
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
        case 'failed':
          return { kind: DictationSetup.Failed, said: lengthOf(problem.said.seconds) }
      }
    if (phase === 'asking') return { kind: DictationSetup.Asking }
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
            if (problem?.kind === 'failed') {
              setProblem(null)
              return void write(problem.said, null)
            }
            if (known !== null) void startDownload(known)
          },
          ...(settingsPane !== null && known?.settings === true ? { onOpenSettings: () => void voice.openSettings(settingsPane) } : {}),
          onDiscard: () => {
            setProblem(null)
            setOpen(false)
          },
          onDismiss: () => {
            setOpen(false)
            if (problem?.kind !== 'stopped' && problem?.kind !== 'noRoom') setProblem(null)
          },
        }

  return {
    dictation: {
      elapsed: listening ? lengthOf(seconds) : null,
      levels,
      interim,
      at,
      kbd: SHORTCUT,
      busy: phase === 'writing',
      expanded: shown !== null,
      ...(download !== null && shown === null ? { progress: download.got / download.size } : {}),
      onStart: () => void press(),
      onStop: stop,
    },
    tray,
    inputRef,
  }
}
