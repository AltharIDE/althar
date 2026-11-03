import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RepositoryPick } from '../src/setup/RepositoryPick/RepositoryPick'

const FOUND = [
  { id: 'meridian', name: 'meridian', where: '~/Projects/meridian', facts: 'main · 2 h ago' },
  { id: 'halyard', name: 'halyard', where: '~/Projects/halyard' },
]

describe('the repositories to pick', () => {
  it('ticks one by its whole row, and chooses a folder from the button over them', () => {
    const onPick = vi.fn()
    const onAdd = vi.fn()
    render(<RepositoryPick repositories={FOUND} picked={['halyard']} onPick={onPick} onAdd={onAdd} />)
    expect(screen.getByRole('checkbox', { name: /halyard/ })).toBeChecked()
    expect(screen.getByText('main · 2 h ago')).toBeInTheDocument()
    fireEvent.click(screen.getByText('meridian'))
    expect(onPick).toHaveBeenCalledWith('meridian')
    fireEvent.click(screen.getByRole('button', { name: /Choose a folder/ }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('says it is still looking, and that it found none, with Choose a folder still there and nothing to find', () => {
    const { rerender } = render(<RepositoryPick repositories={null} picked={[]} onPick={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Looking…')).toHaveAttribute('aria-busy', 'true')
    rerender(<RepositoryPick repositories={[]} picked={[]} onPick={vi.fn()} onAdd={vi.fn()} text={{ none: 'Nothing here.' }} />)
    expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose a folder/ })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeDisabled()
  })
})

describe('finding a repository by typing', () => {
  const MANY = [...FOUND, { id: 'meridian-web', name: 'meridian-web', where: '~/Developer/web' }]

  it('keeps those whose name or place has every word typed, and says when none do', () => {
    render(<RepositoryPick repositories={MANY} picked={[]} onPick={vi.fn()} onAdd={vi.fn()} />)
    const find = screen.getByRole('searchbox')
    fireEvent.change(find, { target: { value: 'MERIDIAN web' } })
    expect(screen.getAllByRole('checkbox').map((row) => row.closest('label')?.textContent)).toEqual([
      expect.stringContaining('meridian-web'),
    ])
    fireEvent.change(find, { target: { value: 'developer' } })
    expect(screen.getByRole('checkbox', { name: /meridian-web/ })).toBeInTheDocument()
    fireEvent.change(find, { target: { value: 'nowhere' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('None match “nowhere”.')).toBeInTheDocument()
    // Escape empties the field, and every one is back.
    fireEvent.keyDown(find, { key: 'Escape' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('ticks the first found with Return, and walks from the field down the rows and back with the arrows', () => {
    const onPick = vi.fn()
    render(<RepositoryPick repositories={MANY} picked={[]} onPick={onPick} onAdd={vi.fn()} />)
    const find = screen.getByRole('searchbox')
    // With nothing typed, Return in the field ticks nothing: it is the step's own.
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.change(find, { target: { value: 'halyard' } })
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('halyard')
    fireEvent.change(find, { target: { value: '' } })
    fireEvent.keyDown(find, { key: 'ArrowDown' })
    const [first, second] = screen.getAllByRole('checkbox')
    expect(first).toHaveFocus()
    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second!, { key: 'Enter' })
    expect(onPick).toHaveBeenLastCalledWith('halyard')
    fireEvent.keyDown(second!, { key: 'ArrowUp' })
    fireEvent.keyDown(first!, { key: 'ArrowUp' })
    expect(find).toHaveFocus()
    // Typing on a row goes on in the field.
    fireEvent.keyDown(screen.getAllByRole('checkbox')[0]!, { key: 'm' })
    expect(find).toHaveFocus()
  })
})
