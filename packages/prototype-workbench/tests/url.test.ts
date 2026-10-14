import { describe, expect, it } from 'vitest'

import { TODAY, firstOf, fit, read, write, type Offered, type Shown } from '../src/url'

const offered: Offered = { directions: [TODAY, 'A', 'B', 'C'], states: ['nothing', 'pushing', 'pushed'] }
const plain: Offered = { directions: ['A', 'B'], states: [] }

describe('reading the address', () => {
  it('opens on the first direction of the prototype’s own, not Today, at the first state, with the bar', () => {
    expect(read('', offered)).toEqual({ direction: 'A', state: 'nothing', side: null, bar: true })
  })

  it('shows the direction and state it names', () => {
    expect(read('?d=B&s=pushing', offered)).toMatchObject({ direction: 'B', state: 'pushing' })
    expect(read('?d=today', offered).direction).toBe(TODAY)
  })

  it('takes a key in any case, and gives it back as the prototype writes it', () => {
    expect(read('?d=b&s=PUSHED', offered)).toMatchObject({ direction: 'B', state: 'pushed' })
  })

  it('falls back to the defaults for what the prototype doesn’t have', () => {
    expect(read('?d=Z&s=gone', offered)).toMatchObject({ direction: 'A', state: 'nothing' })
  })

  it('has no state where the prototype has none', () => {
    expect(read('?s=pushing', plain).state).toBe('')
  })

  it('stands all the directions side by side for side=all, or a bare side', () => {
    expect(read('?side=all', offered).side).toEqual([TODAY, 'A', 'B', 'C'])
    expect(read('?side', offered).side).toEqual([TODAY, 'A', 'B', 'C'])
  })

  it('stands those it names side by side, in the bar’s order, leaving out what the prototype hasn’t', () => {
    expect(read('?side=C,a,Z', offered).side).toEqual(['A', 'C'])
  })

  it('stands them all side by side where it names none the prototype has', () => {
    expect(read('?side=Z', offered).side).toEqual([TODAY, 'A', 'B', 'C'])
  })

  it('hides the bar for bar=0, and only for that', () => {
    expect(read('?bar=0', offered).bar).toBe(false)
    expect(read('?bar=1', offered).bar).toBe(true)
  })

  it('opens on Today where the prototype has nothing else', () => {
    expect(firstOf({ directions: [TODAY], states: [] })).toBe(TODAY)
    expect(firstOf({ directions: [], states: [] })).toBe('')
  })
})

describe('writing the address', () => {
  const shown: Shown = { direction: 'B', state: 'pushing', side: null, bar: true }

  it('says the direction and state, so a link points at one exact view', () => {
    expect(write(shown, offered)).toBe('?d=B&s=pushing')
  })

  it('keeps the prototype’s own parameters', () => {
    expect(write(shown, offered, '?task=42&d=A&side=all')).toBe('?d=B&s=pushing&task=42')
  })

  it('leaves out the state where there is none', () => {
    expect(write({ ...shown, state: '' }, plain, '?s=old')).toBe('?d=B')
  })

  it('lists the directions side by side with plain commas, or says all', () => {
    expect(write({ ...shown, side: ['A', 'C'] }, offered)).toBe('?d=B&s=pushing&side=A,C')
    expect(write({ ...shown, side: [TODAY, 'A', 'B', 'C'] }, offered)).toBe('?d=B&s=pushing&side=all')
  })

  it('says a hidden bar, and drops it once the bar is back', () => {
    expect(write({ ...shown, bar: false }, offered)).toBe('?d=B&s=pushing&bar=0')
    expect(write(shown, offered, '?bar=0&side=all')).toBe('?d=B&s=pushing')
  })

  it('reads back as what it wrote', () => {
    const views: Shown[] = [
      shown,
      { direction: TODAY, state: 'pushed', side: ['B', 'C'], bar: false },
      { ...shown, side: [TODAY, 'A', 'B', 'C'] },
    ]
    for (const view of views) expect(read(write(view, offered), offered)).toEqual(view)
  })
})

describe('fitting what is shown to what the prototype offers now', () => {
  it('gives way to the first direction where the one shown was taken out', () => {
    expect(fit({ direction: 'C', state: 'pushed', side: null, bar: true }, { directions: ['A', 'B'], states: ['pushed'] })).toEqual({
      direction: 'A',
      state: 'pushed',
      side: null,
      bar: true,
    })
  })
})
