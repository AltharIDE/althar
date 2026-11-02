import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RepositoryPick } from '../src/setup/RepositoryPick/RepositoryPick'

const FOUND = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'halyard', name: 'halyard', where: '~/Projects/halyard' },
]

describe('the repositories to pick', () => {
  it('ticks one by its whole row, and adds a folder from the row under them', () => {
    const onPick = vi.fn()
    const onAdd = vi.fn()
    render(<RepositoryPick repositories={FOUND} picked={['halyard']} onPick={onPick} onAdd={onAdd} />)
    expect(screen.getByRole('checkbox', { name: /halyard/ })).toBeChecked()
    expect(screen.getByText('main · 2 h ago')).toBeInTheDocument()
    fireEvent.click(screen.getByText('meridian'))
    expect(onPick).toHaveBeenCalledWith('meridian')
    fireEvent.click(screen.getByRole('button', { name: /Add a folder/ }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('says it is still looking, and that it found none, with Add a folder still there', () => {
    const { rerender } = render(<RepositoryPick repositories={null} picked={[]} onPick={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Looking…')).toHaveAttribute('aria-busy', 'true')
    rerender(<RepositoryPick repositories={[]} picked={[]} onPick={vi.fn()} onAdd={vi.fn()} text={{ none: 'Nothing here.' }} />)
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add a folder/ })).toBeInTheDocument()
  })
})
