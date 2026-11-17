import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AltharLine } from '../src/thread/AltharLine/AltharLine'

/* A line of Althar's with its raw answer: one short line, the answer folded under Details. */

const RAW = JSON.stringify({ status: 200, body: { html_url: `https://github.com/${'x'.repeat(200)}` } }, null, 2)

describe('a note with details', () => {
  it('says its line, with the raw answer folded until Details is opened', () => {
    render(<AltharLine details={RAW}>Asked ana to review #698</AltharLine>)
    expect(screen.getByText('Asked ana to review #698')).toBeVisible()
    const trigger = screen.getByRole('button', { name: 'Details' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Not drawn at all until first opened: a long thread of notes costs nothing.
    expect(screen.queryByText(/"status": 200/)).toBeNull()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/"status": 200/)).toBeInTheDocument()
  })

  it('keeps the answer pretty-printed, in a block that wraps rather than scrolls sideways', () => {
    render(<AltharLine details={RAW}>Merged #662</AltharLine>)
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    const block = screen.getByText(/"status": 200/)
    expect(block.tagName).toBe('PRE')
    expect(block.textContent).toBe(RAW)
    expect(block.className).toMatch(/body/)
  })

  it('has no Details where it has no answer', () => {
    render(<AltharLine>Merged #662</AltharLine>)
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
})
