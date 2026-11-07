import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Pacer, usePacedText, wordEnd } from '../src/lib/pace'

/*
 * Text an agent is still writing, shown at an even pace (lib/pace.ts): the
 * pacer on its own, on times the test gives it, and the hook on the test's
 * frames.
 */

const WORDS = Array.from({ length: 200 }, (_, at) => `word${at}`).join(' ')

describe('wordEnd', () => {
  it('moves a cut inside a word on to its end, keeps one between words, and never splits a character', () => {
    expect(wordEnd('Charges wrap', 3)).toBe(7)
    expect(wordEnd('Charges wrap', 7)).toBe(7)
    expect(wordEnd('Charges wrap', 8)).toBe(8)
    expect(wordEnd('Charges', 3)).toBe(3)
    // A word longer than it looks ahead for, as a path is, shows in part.
    expect(wordEnd(`a ${'x'.repeat(60)} b`, 10)).toBe(10)
    expect(wordEnd('a 😀 b', 3)).toBe(4)
    expect(wordEnd('abc', 9)).toBe(3)
    expect(wordEnd('abc', 0)).toBe(0)
  })
})

describe('the pacer', () => {
  it('shows what was there when it began at once, and nothing more until more arrives', () => {
    const pacer = new Pacer(5)
    expect(pacer.advance('Hello', 0, 16)).toBe(5)
  })

  it('shows a burst over the frames after it, a whole word at a time, at about the pace text has been arriving', () => {
    const pacer = new Pacer(0)
    // A second of text at 240 characters a second, in bursts every 50 ms.
    let text = ''
    for (let at = 0; at <= 1000; at += 50) {
      text = WORDS.slice(0, (240 * at) / 1000)
      pacer.arrive(text.length, at)
    }
    const shown: Array<number> = []
    for (let at = 1016; at < 1200; at += 16) shown.push(pacer.advance(text, at, 16))
    // It moves on every few frames, never back, and doesn't show it all at once.
    expect(shown.every((one, at) => at === 0 || one >= (shown[at - 1] ?? 0))).toBe(true)
    expect(shown.at(-1)).toBeLessThan(text.length)
    expect(shown[0]).toBeLessThan(20)
    // Each stop is between words.
    for (const one of shown) expect(/\s/.test(text[one - 1] ?? ' ') || /\s/.test(text[one] ?? ' ')).toBe(true)
  })

  it('speeds up when it falls behind, and catches up within a few frames when far behind', () => {
    // Arriving at 240 characters a second for `seconds`, with no frame drawn meanwhile (a window hidden, say): then how much
    // shows a tenth of a second on.
    const after = (seconds: number) => {
      const pacer = new Pacer(0)
      const end = seconds * 1000
      for (let at = 0; at <= end; at += 50) pacer.arrive(Math.floor((240 * at) / 1000), at)
      const text = WORDS.repeat(4).slice(0, Math.floor(240 * seconds))
      let shown = 0
      for (let at = end + 16; at <= end + 112; at += 16) shown = pacer.advance(text, at, 16)
      return shown / text.length
    }
    // A moment behind, it goes at the pace it arrives: little of it in a tenth of a second.
    expect(after(0.4)).toBeLessThan(0.5)
    // Seconds behind, most of it.
    expect(after(5)).toBeGreaterThan(0.6)
  })

  it('starts again from where a shorter text ends', () => {
    const pacer = new Pacer(0)
    pacer.arrive(40, 0)
    pacer.advance(WORDS.slice(0, 40), 500, 500)
    pacer.arrive(10, 600)
    expect(pacer.advance(WORDS.slice(0, 10), 616, 16)).toBe(10)
  })

  it('goes by what came in the last second and a half', () => {
    const pacer = new Pacer(0)
    pacer.arrive(3000, 0)
    expect(pacer.pace(0)).toBe(6000)
    // Long after, what arrived then no longer counts: the pace it starts at.
    expect(pacer.pace(5000)).toBe(240)
  })
})

function Paced({ text, streaming }: { text: string; streaming: boolean }) {
  return <p data-testid="paced">{usePacedText(text, streaming)}</p>
}

describe('usePacedText', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }))
  afterEach(() => vi.useRealTimers())

  const shown = () => screen.getByTestId('paced').textContent ?? ''

  it('shows what grows a frame at a time while it streams, and all of it at once when it stops', () => {
    const view = render(<Paced text="word0" streaming />)
    expect(shown()).toBe('word0')
    // More arrived: nothing more shows until the next frame.
    view.rerender(<Paced text={WORDS} streaming />)
    expect(shown()).toBe('word0')
    act(() => vi.advanceTimersByTime(48))
    const early = shown().length
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(WORDS.length)
    act(() => vi.advanceTimersByTime(48))
    expect(shown().length).toBeGreaterThanOrEqual(early)
    view.rerender(<Paced text={WORDS} streaming={false} />)
    expect(shown()).toBe(WORDS)
  })

  it('shows it as it arrives where the person asked for less motion', () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const view = render(<Paced text="word0" streaming />)
    view.rerender(<Paced text={WORDS} streaming />)
    expect(shown()).toBe(WORDS)
    media.mockRestore()
  })
})
