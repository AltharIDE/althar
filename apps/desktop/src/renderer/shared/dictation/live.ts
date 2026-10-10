import type { Frame, Recorded, Recording } from './recorder'

/*
 * Writing down as someone speaks (ADR-017). The speech model doesn't stream,
 * so what has been said since the last pause is written down again about
 * once a second while they talk; at a pause, that stretch is written down
 * once more and settles, so each pass stays short however long they go on.
 *
 * What shows holds still. A word stays once two passes in a row agree on it,
 * and later passes add to it rather than rewrite it; only the words after
 * those may change, and the full stop the model puts at the end of every
 * pass isn't shown until the stretch settles. A stretch the last pass heard
 * to its end settles as that pass wrote it, without writing it again.
 *
 * When they stop, all of it is written down in one go, which reads better
 * than the stretches joined, unless it is long. Nothing they saw is lost: if
 * that pass comes back much shorter than what showed, the settled stretches
 * stand and only the rest is written.
 *
 * One pass at a time: a pass that is due while another runs waits for the
 * next moment, so a slow machine shows words less often, not later and later.
 */

/** Less than this long and quiet, and it isn't a pause. */
const PAUSE = 0.6
/** Less than this long, and a stretch isn't worth settling on its own. */
const STRETCH = 1
/** A stretch that has gone on this long without a pause settles anyway. */
const LONG_STRETCH = 25
/** How often what is unsettled is written down again. */
const EVERY = 1
/** Up to this long, the whole is written down again when they stop. */
const WHOLE = 90
/** Kept after the last sound in a stretch, so its last word isn't cut. */
const TAIL = 0.25
/** How many seconds of the room are listened to for its quietest moment. */
const ROOM = 5
/** Speech is louder than the room by this much; but any sound this loud is speech, however loud the room has been. */
const ABOVE_ROOM = 3
const LOUD = 0.03
const QUIET = 0.006
/** The final pass may be this much shorter than what showed before it counts as having lost words. */
const KEPT = 0.8

/** Two stretches of text, as one: a stretch that didn't end a sentence goes on in lower case. */
export const joined = (first: string, second: string) => {
  if (first === '') return second
  if (second === '') return first
  const continues = !/[.!?…]["”’)]*$/.test(first) && /^[A-Z][a-z]/.test(second) && !/^I\b/.test(second)
  return `${first} ${continues ? `${second.charAt(0).toLowerCase()}${second.slice(1)}` : second}`
}

/** A word as two passes compare it: its letters and digits, in lower case. */
const plain = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** How many words two passes agree on, from the start. */
const agreeing = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  let n = 0
  while (n < a.length && n < b.length && plain(a[n] as string) === plain(b[n] as string)) n += 1
  return n
}

const wordsOf = (text: string) => text.split(/\s+/).filter((word) => word !== '')

/** How a dictation ended, for the log: counts only, never what was said. */
export interface LiveReport {
  readonly seconds: number
  /** Words that showed as they stop. */
  readonly shown: number
  /** Words the pass over the whole wrote; null when it was too long for one. */
  readonly whole: number | null
  /** Which was written: the whole pass, or the settled stretches and the rest. */
  readonly wrote: 'whole' | 'stretches'
}

export interface LiveText {
  /** Written down and settled. */
  readonly settled: string
  /** Written down so far since, and still changing at its end. */
  readonly unsettled: string
}

export function live(
  transcribe: (recorded: Recorded) => Promise<string>,
  onText: (text: LiveText) => void,
  report: (ended: LiveReport) => void = () => {},
) {
  let settled = ''
  let until = 0
  let busy = false
  let closed = false
  let voice = -1
  let wrote = 0
  /* The room's quietest moment in each of the last few seconds. */
  const room: Array<number> = []
  let second = -1
  /* This stretch: the words two passes agreed on, and the last pass's. */
  let kept: ReadonlyArray<string> = []
  let last: ReadonlyArray<string> = []
  /* Where the last pass's hearing ended, and what showed of it, with its full stop: a stretch it heard to its end settles as it showed. */
  let heardTo = 0
  let lastText = ''

  /** What a pass says of the unsettled, held still: agreed words stay, and later ones follow them. */
  const steady = (text: string) => {
    const now = wordsOf(text)
    const agreed = agreeing(last, now)
    if (agreed > kept.length) kept = now.slice(0, agreed)
    last = now
    // A pass that says the kept words otherwise keeps them, and adds only what comes after.
    const shown = [...kept, ...now.slice(Math.min(now.length, kept.length))]
    lastText = shown.join(' ')
    const end = shown.length - 1
    if (end >= 0) shown[end] = (shown[end] as string).replace(/[.!?…]+$/, '')
    return shown.join(' ')
  }

  const pass = async (recording: Recording, cut: number | null, end: number) => {
    busy = true
    const from = until
    try {
      const heard = recording.peek(from)
      const samples = cut === null ? heard.samples : heard.samples.subarray(0, cut - from)
      const text = await transcribe({ samples, sampleRate: heard.sampleRate })
      if (closed || from !== until) return
      if (cut === null) {
        heardTo = end
        return onText({ settled, unsettled: steady(text) })
      }
      settle(text, cut)
    } catch {
      // A pass that fails shows nothing new; stopping writes down all of it again.
    } finally {
      busy = false
      wrote = end
    }
  }

  /** A stretch settles with what was written of it, and the next starts empty. */
  const settle = (text: string, cut: number) => {
    settled = joined(settled, text)
    until = cut
    voice = -1
    kept = []
    last = []
    lastText = ''
    onText({ settled, unsettled: '' })
  }

  /** Whether a moment is speech: louder than the room by a margin, or loud whatever the room. */
  const speaking = (frame: Frame) => {
    const at = Math.floor(frame.end / frame.rate)
    if (at !== second) {
      second = at
      room.push(frame.rms)
      if (room.length > ROOM) room.shift()
    } else room[room.length - 1] = Math.min(room.at(-1) ?? frame.rms, frame.rms)
    return frame.rms > Math.min(LOUD, Math.max(QUIET, Math.min(...room) * ABOVE_ROOM))
  }

  return {
    /** A moment of the recording: hears whether it is speech, and writes down or settles what is due. */
    frame: (frame: Frame, recording: Recording) => {
      if (closed) return
      if (speaking(frame)) voice = frame.end
      if (busy || voice < 0) return
      const { rate, end } = frame
      if (end - voice >= PAUSE * rate && voice - until >= STRETCH * rate) {
        const cut = Math.min(end, voice + TAIL * rate)
        // The last pass heard all of this stretch: it settles as it showed, so nothing on screen moves.
        if (lastText !== '' && heardTo >= cut) settle(lastText, cut)
        else void pass(recording, cut, end)
      } else if (end - until >= LONG_STRETCH * rate) void pass(recording, end, end)
      else if (end - wrote >= EVERY * rate) void pass(recording, null, end)
    },
    /** All of it, written down once they stop. */
    finish: async (all: Recorded): Promise<string> => {
      closed = true
      const seconds = Math.round(all.samples.length / all.sampleRate)
      const shown = wordsOf(joined(settled, last.join(' '))).length
      const rest = async () => joined(settled, await transcribe({ samples: all.samples.subarray(until), sampleRate: all.sampleRate }))
      if (all.samples.length > WHOLE * all.sampleRate) {
        report({ seconds, shown, whole: null, wrote: 'stretches' })
        return rest()
      }
      const whole = await transcribe(all)
      // Much shorter than what showed: the whole pass lost words, and what settled stands.
      const kept = wordsOf(whole).length >= shown * KEPT
      report({ seconds, shown, whole: wordsOf(whole).length, wrote: kept ? 'whole' : 'stretches' })
      return kept ? whole : rest()
    },
    /** Stops, keeping nothing: what is still being written down is ignored. */
    close: () => {
      closed = true
    },
  }
}
