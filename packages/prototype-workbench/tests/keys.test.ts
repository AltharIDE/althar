import { describe, expect, it } from 'vitest'

import { leftAlone, step, type Press } from '../src/keys'
import { TODAY, type Offered, type Shown } from '../src/url'

const offered: Offered = { directions: [TODAY, 'A', 'B', 'C'], states: ['nothing', 'pushing', 'pushed'] }
const at: Shown = { direction: 'A', state: 'nothing', side: null, bar: true }

describe('the keys', () => {
  it('show a direction by its number, 1 for A, and Today by 0', () => {
    expect(step(at, '2', offered)?.direction).toBe('B')
    expect(step(at, '3', offered)?.direction).toBe('C')
    expect(step(at, '0', offered)?.direction).toBe(TODAY)
  })

  it('do nothing for a number with no direction, or 0 without Today', () => {
    expect(step(at, '7', offered)).toBeNull()
    expect(step(at, '0', { directions: ['A', 'B'], states: [] })).toBeNull()
  })

  it('do nothing for the direction already shown', () => {
    expect(step(at, '1', offered)).toBeNull()
  })

  it('step through the directions with ← and →, round from either end', () => {
    expect(step(at, 'ArrowRight', offered)?.direction).toBe('B')
    expect(step(at, 'ArrowLeft', offered)?.direction).toBe(TODAY)
    expect(step({ ...at, direction: 'C' }, 'ArrowRight', offered)?.direction).toBe(TODAY)
    expect(step({ ...at, direction: TODAY }, 'ArrowLeft', offered)?.direction).toBe('C')
  })

  it('step through the states with [ and ], round from either end', () => {
    expect(step(at, ']', offered)?.state).toBe('pushing')
    expect(step(at, '[', offered)?.state).toBe('pushed')
    expect(step({ ...at, state: 'pushed' }, ']', offered)?.state).toBe('nothing')
  })

  it('do nothing for the states where there are fewer than two', () => {
    expect(step(at, ']', { directions: ['A', 'B'], states: ['one'] })).toBeNull()
  })

  it('keep the state as the direction changes, and the direction as the state does', () => {
    expect(step({ ...at, state: 'pushing' }, '2', offered)).toEqual({ ...at, direction: 'B', state: 'pushing' })
    expect(step({ ...at, direction: 'C' }, ']', offered)).toEqual({ ...at, direction: 'C', state: 'pushing' })
  })

  it('put every direction side by side with S, and back with S again', () => {
    expect(step(at, 's', offered)?.side).toEqual([TODAY, 'A', 'B', 'C'])
    expect(step({ ...at, side: ['A', 'B'] }, 'S', offered)?.side).toBeNull()
  })

  it('have nothing to put side by side where there is one direction', () => {
    expect(step(at, 's', { directions: ['A'], states: [] })).toBeNull()
  })

  it('hide the bar with H, and show it with H again', () => {
    expect(step(at, 'h', offered)?.bar).toBe(false)
    expect(step({ ...at, bar: false }, 'H', offered)?.bar).toBe(true)
  })

  it('side by side, take a direction out by its number and put it back, in the bar’s order', () => {
    const side = { ...at, side: [TODAY, 'A', 'B', 'C'] }
    expect(step(side, '2', offered)?.side).toEqual([TODAY, 'A', 'C'])
    expect(step({ ...at, side: ['A', 'C'] }, '0', offered)?.side).toEqual([TODAY, 'A', 'C'])
    expect(step({ ...at, side: ['A', 'C'] }, '2', offered)?.side).toEqual(['A', 'B', 'C'])
  })

  it('side by side, never take the last direction out', () => {
    expect(step({ ...at, side: ['B'] }, '2', offered)).toBeNull()
  })

  it('side by side, leave ← and → alone', () => {
    expect(step({ ...at, side: ['A', 'B'] }, 'ArrowRight', offered)).toBeNull()
  })

  it('do nothing for any other key', () => {
    expect(step(at, 'x', offered)).toBeNull()
    expect(step(at, 'Enter', offered)).toBeNull()
  })
})

describe('what the page leaves alone', () => {
  const press = (over: Partial<Press>): Press => ({
    key: '1',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body,
    ...over,
  })

  it('takes a plain press on the page', () => {
    expect(leftAlone(press({}))).toBe(false)
    expect(leftAlone(press({ target: null }))).toBe(false)
  })

  it('leaves a press with ⌘, Ctrl or Alt to the prototype and the browser', () => {
    expect(leftAlone(press({ metaKey: true }))).toBe(true)
    expect(leftAlone(press({ ctrlKey: true }))).toBe(true)
    expect(leftAlone(press({ altKey: true }))).toBe(true)
  })

  it('leaves one something already handled, and one mid-composition', () => {
    expect(leftAlone(press({ defaultPrevented: true }))).toBe(true)
    expect(leftAlone(press({ isComposing: true }))).toBe(true)
  })

  it('leaves typing in a field alone', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(leftAlone(press({ target: document.createElement(tag) }))).toBe(true)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inside = document.createElement('span')
    editable.append(inside)
    expect(leftAlone(press({ target: inside }))).toBe(true)
  })
})
