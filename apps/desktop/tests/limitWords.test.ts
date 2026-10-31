import { describe, expect, it } from 'vitest'

import { limitText } from '../src/renderer/features/task/LimitCall'

/* A step held for a usage limit, in words: whose, until when. */
describe('a held step in words', () => {
  it('says whose usage ran out, and until when, in a line', () => {
    expect(limitText.held('Codex', '14:00')).toBe('Codex is out of usage until 14:00.')
    expect(limitText.held('Codex', '14:00', 3)).toBe('Codex has 3% of its usage left, until 14:00.')
  })
})
