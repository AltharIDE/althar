import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { below, Heading, type HeadingLevel } from '../src/primitives/Heading/Heading'

describe('Heading', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('renders an h%i at the rank it is given', (level) => {
    render(
      <Heading level={level} id="title" className="look">
        Checkout retries
      </Heading>,
    )
    const heading = screen.getByRole('heading', { level })
    expect(heading.tagName).toBe(`H${level}`)
    expect(heading).toHaveAttribute('id', 'title')
    expect(heading).toHaveClass('look')
  })

  it('steps one rank down for inner headings, stopping at 6', () => {
    const levels: HeadingLevel[] = [1, 2, 3, 4, 5, 6]
    expect(levels.map(below)).toEqual([2, 3, 4, 5, 6, 6])
  })
})
