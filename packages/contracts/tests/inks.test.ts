import { describe, expect, it } from 'vitest'

import { inkFor } from '../src/inks'

describe("a new project's ink", () => {
  it('is the same for the same seed, and passes over the inks taken while one is free', () => {
    expect(inkFor('proj_a', [])).toBe(inkFor('proj_a', []))
    const first = inkFor('proj_a', [])
    expect(inkFor('proj_a', [first])).not.toBe(first)
    const all = ['clay', 'ochre', 'sand', 'olive', 'moss', 'teal', 'slate', 'indigo', 'plum', 'rose', 'brick', 'umber']
    expect(inkFor('proj_a', all)).toBe(first)
    expect(
      inkFor(
        'proj_b',
        all.filter((ink) => ink !== 'teal'),
      ),
    ).toBe('teal')
  })
})
