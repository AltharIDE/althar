import type { Frame, Recorded, Recording } from './recorder'

/*
 * Writing down as someone speaks (ADR-017). The speech model doesn't stream,
 * so what has been said since the last pause is written down again about
 * once a second while they talk, and shown faint; at a pause, that stretch is
 * written down once more and settles, so each pass stays short however long
 * they go on. When they stop, all of it is written down in one go, which
 * reads better than the stretches joined, unless it is long: then the
 * settled stretches stand and only the rest is written.
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
/** A quiet room, with noise suppression on, before the room is heard. */
const QUIET = 0.002
/** Kept after the last sound in a stretch, so its last word isn't cut. */
const TAIL = 0.25

/** Two stretches of text, as one. */
export const joined = (first: string, second: string) => [first, second].filter((part) => part !== '').join(' ')

export interface LiveText {
  /** Written down and settled. */
  readonly settled: string
  /** Written down so far since, and still changing. */
  readonly unsettled: string
}

export function live(transcribe: (recorded: Recorded) => Promise<string>, onText: (text: LiveText) => void) {
  let settled = ''
  let until = 0
  let busy = false
  let closed = false
  let floor = QUIET
  let voice = -1
  let wrote = 0

  const pass = async (recording: Recording, cut: number | null, end: number) => {
    busy = true
    const from = until
    try {
      const heard = recording.peek(from)
      const samples = cut === null ? heard.samples : heard.samples.subarray(0, cut - from)
      const text = await transcribe({ samples, sampleRate: heard.sampleRate })
      if (closed || from !== until) return
      if (cut === null) return onText({ settled, unsettled: text })
      settled = joined(settled, text)
      until = cut
      voice = -1
      onText({ settled, unsettled: '' })
    } catch {
      // A pass that fails shows nothing new; stopping writes down all of it again.
    } finally {
      busy = false
      wrote = end
    }
  }

  return {
    /** A moment of the recording: hears whether it is speech, and writes down or settles what is due. */
    frame: (frame: Frame, recording: Recording) => {
      if (closed) return
      // The room's own sound: from a quiet room, it falls at once to anything quieter, and rises slowly, so a voice from the first moment counts.
      floor = frame.rms < floor ? frame.rms : floor + (frame.rms - floor) * 0.002
      if (frame.rms > Math.max(0.008, floor * 4)) voice = frame.end
      if (busy || voice < 0) return
      const { rate, end } = frame
      if (end - voice >= PAUSE * rate && voice - until >= STRETCH * rate) void pass(recording, Math.min(end, voice + TAIL * rate), end)
      else if (end - until >= LONG_STRETCH * rate) void pass(recording, end, end)
      else if (end - wrote >= EVERY * rate) void pass(recording, null, end)
    },
    /** All of it, written down once they stop. */
    finish: async (all: Recorded): Promise<string> => {
      closed = true
      if (all.samples.length <= WHOLE * all.sampleRate) return transcribe(all)
      return joined(settled, await transcribe({ samples: all.samples.subarray(until), sampleRate: all.sampleRate }))
    },
    /** Stops, keeping nothing: what is still being written down is ignored. */
    close: () => {
      closed = true
    },
  }
}
