import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SHOT_AFTER, SHOT_UNSIZED } from '../src/fixtures/shots'
import { WhatItMade } from '../src/outputs/WhatItMade/WhatItMade'

/* What a task made, on the Outputs page: its story, and its pictures. */

describe('what a task made', () => {
  it('keeps the rest of its story at the deepest heading level when it sits that deep', () => {
    render(
      <WhatItMade
        story={{ lede: 'Refunds retry with backoff.', rest: '## Why\n\nThe processor rate-limits bursts.' }}
        shots={[]}
        checked={[]}
        unverified={[]}
        headingLevel={6}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Read all of it' }))
    expect(screen.getByRole('heading', { level: 6, name: 'Why' })).toBeInTheDocument()
  })

  it('shows its pictures without a way to open them where nothing opens pictures, sized as they were taken or as they load', () => {
    render(
      <WhatItMade
        story={null}
        shots={[
          { ...SHOT_AFTER, caption: 'After' },
          { ...SHOT_UNSIZED, caption: 'Wide' },
        ]}
        checked={[]}
        unverified={[]}
      />,
    )
    expect(screen.queryByRole('button', { name: /View .* full size/ })).not.toBeInTheDocument()
    const frames = [...document.querySelectorAll<HTMLElement>('figure [class~="frame"]')]
    expect(frames.map((frame) => frame.style.aspectRatio)).toEqual(['1440 / 900', ''])
  })
})
