import { describe, expect, it } from 'vitest'

import { PALETTE, paletteJson } from '../src/palette'

describe('the palette', () => {
  it('names colours by six-digit hex, once each', () => {
    for (const c of PALETTE) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(PALETTE.map((c) => c.hex)).size).toBe(PALETTE.length)
  })

  it('is written as a file by name', () => {
    const json = JSON.parse(paletteJson()) as Record<string, { hex: string; role: string }>
    expect(json['cobalt']?.hex).toBe('#2b3bff')
    expect(json['cobalt-on-ink']).toBeDefined()
    expect(Object.keys(json)).toHaveLength(PALETTE.length)
  })
})
