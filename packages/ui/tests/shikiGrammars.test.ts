import { describe, expect, it } from 'vitest'

import { slices } from '../src/lib/shiki'

/*
 * A language reaches the colouring in a message to its worker, so it is only ever a name to look up: one that isn't a
 * grammar Althar has, even one every object answers to, is refused, never called.
 */
describe('which grammar colours a text', () => {
  it('is only one of its own, never what every object has', async () => {
    for (const lang of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nonsense'])
      await expect(slices('const a = 1', lang)).rejects.toThrow(`No grammar for ${lang}`)
  })

  it('colours a language it has', async () => {
    const next = await slices('const a = 1', 'typescript')
    expect(
      next()?.[0]
        ?.map((token) => token.content)
        .join(''),
    ).toBe('const a = 1')
    expect(next()).toBeNull()
  })
})
