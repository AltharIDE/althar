import { describe, expect, it } from 'vitest'

import { BORE, SECTION } from '../src/geometry'
import { MARK_STYLES, markBody, markSvg, placedMark } from '../src/mark'
import { num, svgDocument } from '../src/svg'

describe('the mark as a file', () => {
  it.each(Object.entries(MARK_STYLES))('draws %s with its section cut by the bore', (_name, style) => {
    const svg = markSvg(style)
    expect(svg).toContain(`d="${SECTION}${BORE}"`)
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('aria-label="Althar"')
  })

  it("gives the point its own colour, the section's when it has none, or leaves the bore open", () => {
    expect(markBody({ section: '#111', point: '#222' })).toContain('<circle fill="#222"')
    expect(markBody({ section: '#111' })).toContain('<circle fill="#111"')
    expect(markBody({ section: '#111', point: null })).not.toContain('<circle')
  })

  it('places the mark by its grid', () => {
    expect(placedMark({ section: '#111' }, 10, 20, 2)).toMatch(/^<g transform="translate\(10 20\) scale\(2\)">/)
  })
})

describe('svg helpers', () => {
  it('keeps numbers short and never writes -0', () => {
    expect(num(1.2345)).toBe('1.23')
    expect(num(2)).toBe('2')
    expect(num(-0.001)).toBe('0')
  })

  it('leaves a drawing without a title to the page', () => {
    expect(svgDocument([0, 0, 1, 1], '')).toContain('aria-hidden="true"')
    expect(svgDocument([0, 0, 1, 1], '', 'Name')).toContain('role="img"')
  })
})
