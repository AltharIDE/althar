import { describe, expect, it, vi } from 'vitest'

import { joined, live, type LiveText } from '../src/renderer/shared/dictation/live'
import type { Recorded, Recording } from '../src/renderer/shared/dictation/recorder'

/*
 * Writing down as someone speaks: what is unsettled is written again about
 * once a second, a pause settles a stretch, a stretch without one settles at
 * 25 seconds, and stopping writes down the whole again, unless it is long.
 * Each pass "says" how many seconds it heard, so what it was given shows.
 */

const RATE = 16_000

/** A recording as long as the last moment heard. */
const recording = () => {
  let length = 0
  const peek = vi.fn((from: number): Recorded => ({ samples: new Float32Array(Math.max(0, length - from)), sampleRate: RATE }))
  const fake: Recording = { peek, stop: () => peek(0), cancel: () => {} }
  return { fake, peek, grow: (seconds: number) => (length = Math.round(seconds * RATE)) }
}

/** Writes down how long each pass heard, in seconds, and waits for it when asked. */
const writer = () => {
  const passes: Array<number> = []
  let release: () => void = () => {}
  let held = false
  const transcribe = vi.fn(async (recorded: Recorded) => {
    const seconds = Math.round((recorded.samples.length / recorded.sampleRate) * 10) / 10
    passes.push(seconds)
    if (held) await new Promise<void>((resolve) => (release = resolve))
    return `${seconds}s`
  })
  return {
    transcribe,
    passes,
    hold: () => (held = true),
    release: () => {
      held = false
      release()
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Plays moments from `from` to `to` seconds, a tenth of a second apart, loud or quiet. */
const play = async (said: ReturnType<typeof live>, rec: ReturnType<typeof recording>, from: number, to: number, loud: boolean) => {
  for (let at = from; at <= to + 1e-9; at += 0.1) {
    rec.grow(at)
    said.frame({ level: 0, rms: loud ? 0.1 : 0.001, end: Math.round(at * RATE), rate: RATE }, rec.fake)
    await settle()
  }
}

/** A writer whose passes say what they are told, in turn. */
const saying = (...texts: Array<string>) => {
  let at = 0
  return vi.fn(async () => texts[Math.min(at++, texts.length - 1)] as string)
}

describe('what shows holds still', () => {
  it('keeps the words two passes agree on, adds what comes after, and hides the full stop until it settles', async () => {
    const shown: Array<LiveText> = []
    const said = live(saying('Open the.', 'Open the refund.', 'Open the refunds ledger.', 'Open a refund ledger now.'), (text) =>
      shown.push(text),
    )
    const rec = recording()
    await play(said, rec, 0.1, 4.2, true)
    // "refunds" was never said twice, so it doesn't stay; "the" was, so a pass that says "a" doesn't move it.
    expect(shown.map((text) => text.unsettled)).toEqual([
      'Open the',
      'Open the refund',
      'Open the refunds ledger',
      'Open the refund ledger now',
    ])
  })

  it('settles a stretch the last pass heard to its end as it showed, without writing it again', async () => {
    const shown: Array<LiveText> = []
    const transcribe = saying('Open the refund ledger.', 'Open the refund ledger.')
    const said = live(transcribe, (text) => shown.push(text))
    const rec = recording()
    await play(said, rec, 0.1, 2, true)
    await play(said, rec, 2.1, 3.5, false)
    // Quiet, but a pass was due and heard it all; the pause then settles it as it showed.
    expect(shown.at(-1)).toEqual({ settled: 'Open the refund ledger.', unsettled: '' })
    expect(transcribe).toHaveBeenCalledTimes(3)
  })

  it('keeps what showed when the pass as they stop comes back much shorter', async () => {
    const said = live(saying('Alpha beta gamma.', 'Alpha beta gamma.', 'Alpha beta gamma delta.', 'Zeta.'), () => {})
    const rec = recording()
    await play(said, rec, 0.1, 2, true)
    await play(said, rec, 2.1, 2.8, false)
    await play(said, rec, 2.9, 4, true)
    // The whole pass says one word where five showed: the settled stretch stands, and the rest is written.
    expect(await said.finish({ samples: new Float32Array(5 * RATE), sampleRate: RATE })).toBe('Alpha beta gamma delta. Zeta.')
  })

  it('hears a voice as speech however long it goes on without a pause', async () => {
    const w = writer()
    const said = live(w.transcribe, () => {})
    const rec = recording()
    // Forty seconds of steady speech: the room never gets as loud as the voice, so passes keep coming.
    await play(said, rec, 0.1, 40, true)
    expect(w.passes.length).toBeGreaterThan(30)
  })
})

describe('writing down as someone speaks', () => {
  it('writes the unsettled again about once a second, and settles a stretch at a pause', async () => {
    const shown: Array<LiveText> = []
    const w = writer()
    const said = live(w.transcribe, (text) => shown.push(text))
    const rec = recording()
    await play(said, rec, 0.1, 2, true)
    expect(shown.at(-1)).toEqual({ settled: '', unsettled: '2s' })
    // Quiet for over half a second: the two seconds settle, with a quarter of a second after the last sound.
    await play(said, rec, 2.1, 2.8, false)
    expect(shown.at(-1)).toEqual({ settled: '2.3s', unsettled: '' })
    // Quiet goes on: nothing more is written.
    const before = w.passes.length
    await play(said, rec, 2.9, 4, false)
    expect(w.passes.length).toBe(before)
    // Speech again: only what came after the settled stretch is written.
    await play(said, rec, 4.1, 5.5, true)
    expect(shown.at(-1)?.settled).toBe('2.3s')
    expect(rec.peek).toHaveBeenLastCalledWith(Math.round(2.25 * RATE))
  })

  it('doesn’t settle a stretch too short to stand alone', async () => {
    const shown: Array<LiveText> = []
    const said = live(writer().transcribe, (text) => shown.push(text))
    const rec = recording()
    await play(said, rec, 0.1, 0.5, true)
    await play(said, rec, 0.6, 2, false)
    expect(shown.every((text) => text.settled === '')).toBe(true)
  })

  it('settles a stretch that goes on without a pause', async () => {
    const shown: Array<LiveText> = []
    const said = live(writer().transcribe, (text) => shown.push(text))
    const rec = recording()
    await play(said, rec, 0.1, 25.2, true)
    expect(shown.some((text) => text.settled !== '')).toBe(true)
  })

  it('runs one pass at a time', async () => {
    const w = writer()
    const said = live(w.transcribe, () => {})
    const rec = recording()
    w.hold()
    await play(said, rec, 0.1, 4, true)
    expect(w.passes).toHaveLength(1)
    w.release()
    await settle()
    // Freed, it writes down all that is unsettled at once, then a second later again.
    await play(said, rec, 4.1, 5.2, true)
    expect(w.passes).toEqual([1, 4.1, 5.1])
  })

  it('writes down the whole again when they stop, and ignores what was still coming', async () => {
    const shown: Array<LiveText> = []
    const w = writer()
    const said = live(w.transcribe, (text) => shown.push(text))
    const rec = recording()
    w.hold()
    await play(said, rec, 0.1, 1.2, true)
    const whole = said.finish({ samples: new Float32Array(3 * RATE), sampleRate: RATE })
    w.release()
    expect(await whole).toBe('3s')
    await settle()
    expect(shown).toEqual([])
  })

  it('keeps what settled when they stop after a long while, and writes the rest', async () => {
    const said = live(writer().transcribe, () => {})
    const rec = recording()
    await play(said, rec, 0.1, 2, true)
    await play(said, rec, 2.1, 2.8, false)
    expect(await said.finish({ samples: new Float32Array(100 * RATE), sampleRate: RATE })).toBe('2.3s 97.8s')
  })

  it('shows nothing new for a pass that fails, and nothing once closed', async () => {
    const shown: Array<LiveText> = []
    const said = live(
      vi.fn(async () => Promise.reject(new Error('no'))),
      (text) => shown.push(text),
    )
    const rec = recording()
    await play(said, rec, 0.1, 1.2, true)
    expect(shown).toEqual([])
    said.close()
    await play(said, rec, 1.3, 3, true)
    expect(shown).toEqual([])
  })

  it('joins stretches with a space, leaving out what is empty, and goes on in lower case where a sentence didn’t end', () => {
    expect(joined('One.', 'Two.')).toBe('One. Two.')
    expect(joined('', 'Two.')).toBe('Two.')
    expect(joined('One.', '')).toBe('One.')
    expect(joined('I want to', 'Open the file.')).toBe('I want to open the file.')
    expect(joined('I want to', 'I think so.')).toBe('I want to I think so.')
    expect(joined('Check the', 'API first.')).toBe('Check the API first.')
  })
})
