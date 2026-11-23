import { expect, it } from 'vitest'

import { displayInputProblem } from '../src/main/computer/display'

const DISPLAY = { x: -1200, y: 50, width: 1200, height: 800 }
const FRAME = { width: 600, height: 400 }
const WINDOW = { x: -1000, y: 100, width: 250, height: 200 }
const BASE = { target: 'desktop', observation: 'current' } as const
const key = (...keys: Array<string>) => ({ ...BASE, op: 'key' as const, keys })

it('maps screenshot pixels to desktop points and prevents input over Althar', () => {
  const at = (x: number, y: number) => ({ ...BASE, op: 'click' as const, at: { x, y } })
  expect(displayInputProblem(at(125, 80), FRAME, DISPLAY, [WINDOW], false)).toMatch(/on Althar’s own window/)
  expect(displayInputProblem(at(465, 180), FRAME, DISPLAY, [WINDOW], false)).toBeUndefined()
  expect(displayInputProblem(at(465, 180), undefined, DISPLAY, [WINDOW], false)).toMatch(/Observe "desktop" first/)
})

it('prevents a display drag from crossing one of Althar’s windows', () => {
  expect(
    displayInputProblem({ ...BASE, op: 'drag', from: { x: 30, y: 70 }, to: { x: 450, y: 70 } }, FRAME, DISPLAY, [WINDOW], false),
  ).toMatch(/on Althar’s own window/)
})

it('lets a click reach the Dock while Althar is in front, as a person’s would', () => {
  const dock = { ...BASE, op: 'click' as const, at: { x: 300, y: 395 } }
  expect(displayInputProblem(dock, FRAME, DISPLAY, [WINDOW], true)).toBeUndefined()
})

it('keeps keys and typing off Althar while it is in front, but for Spotlight and the app switcher', () => {
  const type = { ...BASE, op: 'type' as const, text: 'Akiflow' }
  expect(displayInputProblem(key('cmd', 'space'), FRAME, DISPLAY, [WINDOW], true)).toBeUndefined()
  expect(displayInputProblem(key('Command+Space'), FRAME, DISPLAY, [WINDOW], true)).toBeUndefined()
  expect(displayInputProblem(key('cmd', 'tab'), FRAME, DISPLAY, [WINDOW], true)).toBeUndefined()
  expect(displayInputProblem(key('return'), FRAME, DISPLAY, [WINDOW], true)).toMatch(/Bring the app forward first/)
  expect(displayInputProblem(key('cmd', 'w'), FRAME, DISPLAY, [WINDOW], true)).toMatch(/Bring the app forward first/)
  expect(displayInputProblem(type, FRAME, DISPLAY, [WINDOW], true)).toMatch(/Bring the app forward first/)
  // Once another app is in front, Spotlight say, keys and typing go to it.
  expect(displayInputProblem(key('return'), FRAME, DISPLAY, [WINDOW], false)).toBeUndefined()
  expect(displayInputProblem(type, FRAME, DISPLAY, [WINDOW], false)).toBeUndefined()
})
