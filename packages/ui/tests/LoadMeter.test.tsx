import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { heldSteps, LoadLevel, levelOf, percent } from '../src/chrome/LoadMeter/load'
import { LoadMeter } from '../src/chrome/LoadMeter/LoadMeter'
import { LOAD_IDLE } from '../src/fixtures/load'
import { MemoryPressure } from '../src/foundations/vocabulary'

/* How many of the CPU meter's steps are lit, Althar's part and the rest. */
const lit = (container: HTMLElement) => {
  const [cpu] = container.querySelectorAll('[aria-hidden="true"]')
  return cpu?.querySelectorAll('i[data-lit]').length ?? -1
}

describe('the load meter', () => {
  it('changes step only once the load is well past the middle between two', () => {
    // Held at none: a load just over the middle stays there; well over it, it lights one.
    expect(heldSteps(0.12, 5, 0)).toBe(0)
    expect(heldSteps(0.15, 5, 0)).toBe(1)
    // Held at one: back under the middle it stays; well under, it goes out.
    expect(heldSteps(0.09, 5, 1)).toBe(1)
    expect(heldSteps(0.05, 5, 1)).toBe(0)
    // A jump goes straight to its step; nothing held, it rounds.
    expect(heldSteps(0.9, 5, 1)).toBe(5)
    expect(heldSteps(0.5, 5, null)).toBe(3)
    expect(heldSteps(1.4, 5, null)).toBe(5)
  })

  it('holds its steps still through readings on the line between two', () => {
    const at = (cpu: number) => ({ ...LOAD_IDLE, cpu, work: 0 })
    const meter = render(<LoadMeter load={at(0.09)} />)
    expect(lit(meter.container)).toBe(0)
    meter.rerender(<LoadMeter load={at(0.12)} />)
    expect(lit(meter.container)).toBe(0)
    meter.rerender(<LoadMeter load={at(0.15)} />)
    expect(lit(meter.container)).toBe(1)
    meter.rerender(<LoadMeter load={at(0.1)} />)
    expect(lit(meter.container)).toBe(1)
    meter.rerender(<LoadMeter load={at(0.04)} />)
    expect(lit(meter.container)).toBe(0)
  })

  it('says how loaded in a word: full when the CPU is, or memory is short', () => {
    expect(levelOf({ cpu: 0.2, pressure: null })).toBe(LoadLevel.Quiet)
    expect(levelOf({ cpu: 0.5, pressure: MemoryPressure.Normal })).toBe(LoadLevel.Busy)
    expect(levelOf({ cpu: 0.92, pressure: MemoryPressure.Normal })).toBe(LoadLevel.Full)
    expect(levelOf({ cpu: 0.2, pressure: MemoryPressure.Warning })).toBe(LoadLevel.Full)
    expect([percent(-0.1), percent(0.555), percent(2)]).toEqual([0, 56, 100])
  })
})
