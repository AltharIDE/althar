import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentInstall } from '../src/setup/AgentInstall/AgentInstall'

/* An agent that isn't on this device: only one with an installer of its own is ever sent to install it. */

describe('an agent that isn’t here', () => {
  it('sends one with its own installer and instructions to install it', () => {
    render(<AgentInstall name="Gemini CLI" onHelp={vi.fn()} />)
    expect(screen.getByText('Install Gemini CLI with its own installer, then come back here.')).toBeInTheDocument()
  })

  it('never sends one only Althar downloads to an installer, where this window can’t download it', () => {
    render(<AgentInstall name="Google Antigravity" size="125 MB" pinned={{ from: 'Google', version: '1.3.0' }} onCheck={vi.fn()} />)
    expect(screen.getByText('Althar can’t download Google Antigravity from this window.')).toBeInTheDocument()
    expect(screen.queryByText(/installer/)).toBeNull()
  })

  it('says its maker has no build for this device, with nothing to press', () => {
    render(<AgentInstall name="Google Antigravity" noBuild onCheck={vi.fn()} onInstall={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /Google Antigravity isn’t on this/ })).toBeInTheDocument()
    expect(screen.getByText(/There’s no build of Google Antigravity for this .*, so it can’t run here\./)).toBeInTheDocument()
    expect(screen.queryByText(/installer/)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
