import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RuntimeState } from '../src/foundations/vocabulary'
import { Runtimes, type RuntimeEntry, type RuntimesProps } from '../src/setup/Runtimes/Runtimes'

/* The agents on this machine, a row each: who it is signed in as, or what it needs. */

const rows = (runtimes: RuntimeEntry[], more: Partial<RuntimesProps> = {}) =>
  render(<Runtimes label="Agents on this Mac" runtimes={runtimes} {...more} />)

describe('an agent’s row', () => {
  it('says one task waits for an agent signed out', () => {
    rows([{ id: 'codex', name: 'Codex', state: RuntimeState.SignedOut, waiting: 1 }])
    expect(screen.getByText('Signed out · 1 task waits for it')).toBeInTheDocument()
  })

  it('says its work waits for the reset when no other agent takes it', () => {
    rows([{ id: 'claude-code', name: 'Claude Code', state: RuntimeState.OutOfUsage, resets: '16:00' }])
    expect(screen.getByRole('listitem')).toHaveTextContent('Out of usage until 16:00 · its work waits for the reset')
  })

  it('says where a pinned download comes from, and which version', () => {
    rows(
      [
        {
          id: 'opencode',
          name: 'OpenCode',
          state: RuntimeState.Missing,
          download: '38 MB',
          pinned: { from: 'opencode.ai', version: '1.4.2' },
        },
      ],
      { onInstall: () => {} },
    )
    expect(
      screen.getByText('Althar can fetch OpenCode 1.4.2 from opencode.ai, about 38 MB, check it, and keep it in its own folder.'),
    ).toBeInTheDocument()
  })

  it('offers only to check again for an agent it can neither fetch nor point to instructions for', () => {
    rows([{ id: 'amp', name: 'Amp', state: RuntimeState.Missing, guide: false }], { onCheck: () => {}, onHelp: () => {} })
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How to install' })).not.toBeInTheDocument()
  })
})
