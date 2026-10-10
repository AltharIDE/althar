import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CODEX, GEMINI_PRO } from '../src/fixtures/models'
import { RateLimit } from '../src/thread/RateLimit/RateLimit'

const options = [
  { model: CODEX, note: 'via Codex' },
  { model: GEMINI_PRO, note: 'via Gemini CLI' },
]

describe('RateLimit', () => {
  it('offers the next free model when the one it offered goes out', () => {
    const props = { runtime: 'Claude Code', resets: '14:00', onSwap: vi.fn() }
    const { rerender } = render(<RateLimit {...props} options={options} />)
    expect(screen.getByRole('button', { name: /^Continue with .*Codex/ })).toBeTruthy()
    rerender(<RateLimit {...props} options={[{ ...options[0]!, busy: true }, options[1]!]} />)
    expect(screen.getByRole('button', { name: /^Continue with .*Gemini/ })).toBeTruthy()
    expect(screen.queryByText('No other model is free now.')).toBeNull()
  })
})
