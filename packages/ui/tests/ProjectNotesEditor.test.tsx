import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type KeptNote, ProjectNotes } from '../src/setup/ProjectNotes/ProjectNotes'

/* A project's note being said in other words: its field, what it holds, and the keys that finish it. */

const NOTE: KeptNote = { id: 'note_1', body: 'Dependency setup runs outside the sandbox.' }

const editing = (limit?: number) => {
  const onEdit = vi.fn()
  render(<ProjectNotes notes={[NOTE]} onEdit={onEdit} onRemove={() => {}} {...(limit === undefined ? {} : { limit })} />)
  fireEvent.click(screen.getByRole('button', { name: `Edit “${NOTE.body}”` }))
  return { onEdit, field: screen.getByRole('textbox', { name: 'Note' }) }
}

describe('changing a note', () => {
  it('takes any length without a limit, and says nothing of what is left', () => {
    const { field } = editing()
    expect(field).not.toHaveAttribute('maxlength')
    expect(screen.queryByText(/characters? left/)).not.toBeInTheDocument()
  })

  it('keeps nothing when Enter is pressed on an emptied field, and stays open', () => {
    const { onEdit, field } = editing()
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
  })

  it('leaves Enter to an input method still composing', () => {
    const { onEdit, field } = editing()
    fireEvent.change(field, { target: { value: 'Setup runs in the sandbox now.' } })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(onEdit).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith('note_1', 'Setup runs in the sandbox now.')
  })

  it('says when one character is left', () => {
    const { field } = editing(NOTE.body.length + 1)
    expect(field).toHaveAttribute('maxlength', String(NOTE.body.length + 1))
    expect(screen.getByText('1 character left')).toBeInTheDocument()
  })
})
