import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomePending, PagePending, PartPending, pendingText, ThreadPending } from '../src/renderer/shared/Pending'

/* What a place shows while a slow read comes: the shape of what is coming, said for those who can't see it, and no spinner. */

describe('a place still being read', () => {
  it('shows the shape of what is coming, and says what is being read', () => {
    const { container, unmount } = render(<ThreadPending />)
    expect(screen.getByRole('status', { name: pendingText.thread })).toBeTruthy()
    expect(container.querySelector('[class*="spin"]')).toBeNull()
    unmount()
    render(<HomePending />)
    expect(screen.getByRole('status', { name: pendingText.home })).toBeTruthy()
  })

  it('does the same for a page, and for a part of a screen', () => {
    render(
      <>
        <PagePending />
        <PartPending label="Reading the board" />
      </>,
    )
    expect(screen.getByRole('status', { name: pendingText.page })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Reading the board' })).toBeTruthy()
  })
})
