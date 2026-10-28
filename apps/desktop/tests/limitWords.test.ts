import { describe, expect, it } from 'vitest'

import { limitText } from '../src/renderer/features/task/LimitCall'

/* A step held for a usage limit, in words: its verbs agree with its work, one review or many fixes. */
describe('a held step in words', () => {
  it('says the review waits, and the fixes wait', () => {
    expect(limitText.held('Codex', '14:00', 'review', 'waits')).toBe(
      'Codex ran out of usage during the review. This project waits for usage to reset, so the review waits until 14:00. To carry on now, pick another model, or skip the review.',
    )
    expect(limitText.held('Codex', '14:00', 'settle', 'nothing_free')).toBe(
      "Codex ran out of usage while fixing what the review found. No other model was free, so the fixes wait until 14:00, when it's back. To carry on now, pick another model.",
    )
    expect(limitText.held('Codex', '14:00', 'settle', 'asked')).toBe(
      'Codex ran out of usage while fixing what the review found. The fixes wait until 14:00, as you said. To carry on now, pick another model.',
    )
  })

  it('says what runs again at the reset, and what carries on on another model', () => {
    expect(limitText.waitingNote('implement')).toBe('the work runs again then')
    expect(limitText.waitingNote('settle')).toBe('the fixes run again then')
    expect(limitText.movedNote('review')).toBe('the review carries on there')
    expect(limitText.movedNote('settle')).toBe('the fixes carry on there')
  })
})
