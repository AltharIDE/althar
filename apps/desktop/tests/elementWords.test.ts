import { describe, expect, it } from 'vitest'

import { elementLine, onLine, selectorLine, sized, sizeLine } from '../src/main/browser/elementWords'
import type { Picked } from '../src/main/browser/picked'
import { commentsText, text } from '../src/renderer/shared/comments'

/*
 * An element in words, as a comment says what it is on and as the lead reads
 * the element it clicked: one wording for both (ADR-100).
 */

const picked = (overrides: Partial<Picked> = {}): Picked => ({
  selector: 'span.needs',
  label: 'span.needs',
  text: 'x64 and arm64',
  rect: { x: 10, y: 20, width: 80, height: 24 },
  font: '12px · 400 · Inter Variable',
  colour: '#8f887e',
  background: '#ffffff',
  page: { width: 1280, height: 800 },
  ...overrides,
})

describe('an element in words', () => {
  it('says a size as width by height', () => {
    expect(sized(320, 120)).toBe('320 × 120')
    expect(sizeLine(picked())).toBe('80 × 24')
  })

  it('says what it is on: the element at a glance, its words where it has any, and its size', () => {
    expect(elementLine(picked())).toBe('On `span.needs` (“x64 and arm64”), 80 × 24')
    expect(elementLine(picked({ text: '' }))).toBe('On `span.needs`, 80 × 24')
    expect(onLine('button#save', 'Save', '64 × 32')).toBe('On `button#save` (“Save”), 64 × 32')
  })

  it('says the selector that finds it again', () => {
    expect(selectorLine('section > span.needs')).toBe('Selector: `section > span.needs`')
  })

  it('is the wording a comment’s message uses, so the lead reads the same from a click as from a comment', () => {
    const spot = { kind: 'page' as const, picked: picked(), address: 'http://localhost:5173/refunds', viewport: 'fit' as const }
    const message = commentsText([{ id: 'c1', note: 'Too faint.', on: spot, crop: null }], 0, false)
    expect(message).toContain(`- ${elementLine(spot.picked)}`)
    expect(message).toContain(`- ${selectorLine(spot.picked.selector)}`)
    expect(text.on('a', 'b', 'c')).toBe(onLine('a', 'b', 'c'))
    expect(text.sized(1, 2)).toBe(sized(1, 2))
  })
})
