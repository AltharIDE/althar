import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it } from 'vitest'

import { SHOT_NOT_KEPT } from '../src/fixtures/shots'
import { WhatItMade } from '../src/outputs/WhatItMade/WhatItMade'

describe('what it made', () => {
  it('reads all of its story at the deepest heading, and shows a picture it has no size of, and nothing to open, as it is', async () => {
    render(
      <WhatItMade
        story={{ lede: 'Refunds are limited per partner.', rest: '### Why\n\nPartners asked.' }}
        shots={[{ ...SHOT_NOT_KEPT, caption: 'The refunds page' }]}
        checked={[]}
        unverified={[]}
        headingLevel={6}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read all of it' }))
    expect(screen.getByText('Partners asked.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy()
    // Outside a thread there is nothing to open it in, and one not kept opens to nothing anyway.
    expect(screen.getByText('The refunds page')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /full size/ })).toBeNull()
  })
})
