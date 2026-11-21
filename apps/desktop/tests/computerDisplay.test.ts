import { expect, it } from 'vitest'

import { displayInputSafe } from '../src/main/computer/display'

const DISPLAY = { x: -1200, y: 50, width: 1200, height: 800 }
const FRAME = { width: 600, height: 400 }
const WINDOW = { x: -1000, y: 100, width: 250, height: 200 }
const BASE = { target: 'desktop', observation: 'current' } as const

it('maps screenshot pixels to desktop points and prevents input over Althar', () => {
  const at = (x: number, y: number) => ({ ...BASE, op: 'click' as const, at: { x, y } })
  expect(displayInputSafe(at(125, 80), FRAME, DISPLAY, [WINDOW])).toBe(false)
  expect(displayInputSafe(at(465, 180), FRAME, DISPLAY, [WINDOW])).toBe(true)
  expect(displayInputSafe(at(465, 180), undefined, DISPLAY, [WINDOW])).toBe(false)
})

it('prevents a display drag from crossing one of Althar’s windows', () => {
  expect(
    displayInputSafe(
      {
        ...BASE,
        op: 'drag',
        from: { x: 30, y: 70 },
        to: { x: 450, y: 70 },
      },
      FRAME,
      DISPLAY,
      [WINDOW],
    ),
  ).toBe(false)
})
