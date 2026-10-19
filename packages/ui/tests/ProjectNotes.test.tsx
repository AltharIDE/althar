import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type KeptNote, ProjectNotes } from '../src/setup/ProjectNotes/ProjectNotes'

const NOTES: ReadonlyArray<KeptNote> = [
  { id: 'note_1', body: 'Issue drafts need an approval card, on every tracker.' },
  { id: 'note_2', body: 'Dependency setup runs outside the sandbox.' },
]

function Kept({ onRemove, onEdit = () => {} }: { onRemove: (id: string) => void; onEdit?: (id: string, body: string) => void }) {
  const [notes, setNotes] = useState(NOTES)
  return (
    <ProjectNotes
      notes={notes}
      limit={80}
      onEdit={(id, body) => {
        setNotes((was) => was.map((note) => (note.id === id ? { ...note, body } : note)))
        onEdit(id, body)
      }}
      onRemove={(id) => {
        setNotes((was) => was.filter((note) => note.id !== id))
        onRemove(id)
      }}
    />
  )
}

describe('a project’s notes', () => {
  it('take one out by its ×, and give focus to the next, then to the line saying none is left', () => {
    const onRemove = vi.fn()
    render(<Kept onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Issue drafts need an approval card, on every tracker.”' }))
    expect(onRemove).toHaveBeenCalledWith('note_1')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove “Dependency setup runs outside the sandbox.”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Dependency setup runs outside the sandbox.”' }))
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText(/^None yet\./))
  })

  it('say one in other words where it is: Enter keeps them on one line, Escape puts them back, and focus goes back to its pencil', () => {
    const onEdit = vi.fn()
    render(<Kept onRemove={vi.fn()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit “Dependency setup runs outside the sandbox.”' }))
    const field = screen.getByRole('textbox', { name: 'Note' })
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('maxlength')).toBe('80')
    fireEvent.change(field, { target: { value: ' Dependency setup runs\n outside   the sandbox, always. ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith('note_2', 'Dependency setup runs outside the sandbox, always.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit “Dependency setup runs outside the sandbox, always.”' }))
    // Escape puts back what was typed; the same words again change nothing.
    fireEvent.click(screen.getByRole('button', { name: /^Edit “Issue drafts/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Gone.' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Issue drafts need an approval card, on every tracker.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Edit “Issue drafts/ }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('set code in a note as code', () => {
    render(<ProjectNotes notes={[{ id: 'n', body: 'Run `bun install` outside the sandbox.' }]} onRemove={vi.fn()} />)
    expect(screen.getByText('bun install').tagName).toBe('CODE')
  })
})
