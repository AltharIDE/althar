import { expect, it } from 'vitest'

import { keyChord } from '../src/computer/protocol'

it('reads keys as a lead gives them: one key, a chord, or a chord written as one', () => {
  expect(keyChord(['return'])).toEqual({ modifiers: [], key: 'return' })
  expect(keyChord(['Enter'])).toEqual({ modifiers: [], key: 'return' })
  expect(keyChord(['cmd', 'space'])).toEqual({ modifiers: ['cmd'], key: 'space' })
  expect(keyChord(['Command+Space'])).toEqual({ modifiers: ['cmd'], key: 'space' })
  expect(keyChord(['cmd', 'shift', 'Tab'])).toEqual({ modifiers: ['cmd', 'shift'], key: 'tab' })
  expect(keyChord(['alt', 'esc'])).toEqual({ modifiers: ['option'], key: 'escape' })
  // Two keys at once, or none, isn’t a chord: they go one call at a time.
  expect(keyChord(['a', 'b'])).toBeNull()
  expect(keyChord(['cmd'])).toBeNull()
})
