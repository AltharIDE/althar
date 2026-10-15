import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type KeptNote, ProjectNotes } from '../src/setup/ProjectNotes/ProjectNotes'

const NOTES: ReadonlyArray<KeptNote> = [
  { id: 'note_1', body: 'Issue drafts need an approval card, on every tracker.' },
  { id: 'note_2', body: 'Dependency setup runs outside the sandbox.' },
]

function Kept({ onRemove }: { onRemove: (id: string) => void }) {
  const [notes, setNotes] = useState(NOTES)
  return (
    <ProjectNotes
      notes={notes}
      onRemove={(id) => {
        setNotes((was) => was.filter((note) => note.id !== id))
        onRemove(id)
      }}
    />
  )
}

describe('a project’s notes', () => {
  it('take one out by its ×, and give focus to the next, then to the words above once none is left', () => {
    const onRemove = vi.fn()
    render(<Kept onRemove={onRemove} />)
    expect(screen.getByText(/^Decisions you made in conversation/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Issue drafts need an approval card, on every tracker.”' }))
    expect(onRemove).toHaveBeenCalledWith('note_1')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove “Dependency setup runs outside the sandbox.”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Dependency setup runs outside the sandbox.”' }))
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText(/^None yet\./))
  })
})
