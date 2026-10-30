import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RuntimeState } from '../src/foundations/vocabulary'
import { Start, type StartProps, type StartRepository } from '../src/screens/Start/Start'
import type { RuntimeEntry } from '../src/setup/Runtimes/Runtimes'

/*
 * The first screen: the agents on this Mac, and the repositories to make a
 * first project of, ticked into it and left out again.
 */

const FOUND: StartRepository[] = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'halyard', name: 'halyard', where: '~/Developer/halyard', facts: 'main · 3 days ago' },
]
const TWO_READY: RuntimeEntry[] = [
  { id: 'claude-code', name: 'Claude Code', state: RuntimeState.Ready, account: 'you@meridian.dev · Max' },
  { id: 'local', name: 'Local model', state: RuntimeState.Ready },
]

const start = (more: Partial<StartProps> = {}) => {
  const props: StartProps = {
    runtimes: TWO_READY,
    repositories: FOUND,
    picked: [],
    onPick: vi.fn(),
    onAdd: vi.fn(),
    name: '',
    onNameChange: vi.fn(),
    onCreate: vi.fn(),
    ...more,
  }
  const { rerender } = render(<Start {...props} />)
  return { ...props, again: (next: Partial<StartProps>) => rerender(<Start {...props} {...next} />) }
}

describe('the first screen', () => {
  it('counts the agents that are ready, and says so in the words of the rows it is given', () => {
    start({ runtimesText: { checking: 'Asking…' }, runtimes: [...TWO_READY, { id: 'codex', name: 'Codex', state: RuntimeState.Checking }] })
    expect(screen.getByText('2 of 3 ready')).toBeInTheDocument()
    expect(screen.getByText('Asking…')).toBeInTheDocument()
  })

  it('leaves out a pick of a repository that is no longer listed', () => {
    start({ picked: ['gone'] })
    expect(screen.getByRole('heading', { name: 'Where should they work?' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Project name' })).not.toBeInTheDocument()
  })
})

describe('leaving a repository out of the first project', () => {
  it('gives focus to its tick when the last one is left out', () => {
    const { onPick, again } = start({ picked: ['meridian'], name: 'meridian' })
    fireEvent.click(screen.getByRole('button', { name: 'Leave meridian out' }))
    expect(onPick).toHaveBeenCalledWith('meridian')
    again({ picked: [] })
    expect(document.activeElement).toHaveAttribute('data-pick', 'meridian')
  })

  it('leaves focus where it is when it was somewhere else', () => {
    const { again } = start({ picked: ['meridian', 'halyard'], name: 'meridian' })
    const name = screen.getByRole('textbox', { name: 'Project name' })
    name.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Leave meridian out' }))
    again({ picked: ['halyard'] })
    expect(name).toHaveFocus()
  })
})
