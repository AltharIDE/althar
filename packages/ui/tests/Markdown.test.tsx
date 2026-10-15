import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from '../src/thread/Markdown/Markdown'

describe('Markdown code', () => {
  const write = vi.fn((_text: string) => Promise.resolve())

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
  })
  afterEach(() => {
    write.mockClear()
  })

  it('gives a fenced block a copy button that copies its exact text, with no trailing newline', async () => {
    const code = 'Refund the charge.\n\n  Keep the key:  `idem-1`\n<tag>'
    render(<Markdown source={'```text\n' + code + '\n```'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(write).toHaveBeenCalledWith(code))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('gives each fenced block its own copy button', () => {
    render(<Markdown source={'```\none\n```\n\n```\ntwo\n```'} />)
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
  })

  it('gives inline code no copy button', () => {
    render(<Markdown source="Send `npm test` first." />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
