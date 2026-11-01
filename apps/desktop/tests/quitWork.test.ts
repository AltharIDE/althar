import { describe, expect, it } from 'vitest'

import { idle, isQuitAnswer, workIn } from '../src/main/quitWork'

/* What Quit would stop, as the runtime counts it and the main process checks it. */

describe('work', () => {
  it('is read from whole counts, and from nothing else', () => {
    expect(workIn({ leads: 3, reviews: 1, runs: 0, left: 2 })).toEqual({ leads: 3, reviews: 1, runs: 0, left: 2 })
    expect(workIn(null)).toBeNull()
    expect(workIn('3 leads')).toBeNull()
    expect(workIn({ leads: 1, reviews: 0, runs: 0 })).toBeNull()
    expect(workIn({ leads: -1, reviews: 0, runs: 0, left: 0 })).toBeNull()
    expect(workIn({ leads: 1.5, reviews: 0, runs: 0, left: 0 })).toBeNull()
    expect(workIn({ leads: '1', reviews: 0, runs: 0, left: 0 })).toBeNull()
  })

  it('is idle only when nothing would stop', () => {
    expect(idle({ leads: 0, reviews: 0, runs: 0, left: 0 })).toBe(true)
    for (const busy of [{ leads: 1 }, { reviews: 1 }, { runs: 1 }, { left: 1 }])
      expect(idle({ leads: 0, reviews: 0, runs: 0, left: 0, ...busy })).toBe(false)
  })

  it('takes only the three answers', () => {
    expect([true, 'quit', 'background', 'cancel', 'now', undefined].map(isQuitAnswer)).toEqual([false, true, true, true, false, false])
  })
})
