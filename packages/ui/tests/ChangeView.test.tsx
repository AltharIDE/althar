import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChangeView, type ChangeViewProps, type ViewedFile } from '../src/outputs/ChangeView/ChangeView'

/*
 * A task's change over the whole window: the files down the side, the one
 * you're on beside them, and j and k to go through them.
 */

const FILES: ViewedFile[] = [
  { path: 'src/charges/limit.ts', status: 'modified', add: 14, del: 3 },
  { path: 'src/refunds/router.ts', status: 'modified', add: 12, del: 1 },
]

const open = (more: Partial<ChangeViewProps> = {}) => {
  const onSelect = vi.fn()
  render(
    <ChangeView
      branch="althar/mer-231-rate-limit-refunds"
      files={FILES}
      selected="src/refunds/router.ts"
      onSelect={onSelect}
      view={{ state: 'ready', lines: [] }}
      onClose={() => {}}
      {...more}
    />,
  )
  return { onSelect, view: screen.getByRole('dialog', { name: 'Changes' }) }
}

describe('the change over the whole window', () => {
  it('names the branch alone where it has nowhere to go yet, and counts a single file', () => {
    open({ files: FILES.slice(0, 1), selected: null })
    expect(screen.getByText('althar/mer-231-rate-limit-refunds')).toBeInTheDocument()
    expect(screen.getByText('1 file')).toBeInTheDocument()
  })

  it('says nothing has changed in a file whose diff is empty', () => {
    open()
    expect(screen.getByText('Nothing has changed yet.')).toBeInTheDocument()
  })

  it('says why a diff could not be read, with no way to try again where none is given', () => {
    open({ view: { state: 'failed', message: 'The worktree is gone.' } })
    expect(screen.getByRole('alert')).toHaveTextContent('The worktree is gone.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('going through the files from the keyboard', () => {
  it('stops at the last file, and takes no keys held with a modifier or meant for something else', () => {
    const { onSelect, view } = open()
    fireEvent.keyDown(view, { key: 'j' })
    fireEvent.keyDown(view, { key: 'k', metaKey: true })
    fireEvent.keyDown(view, { key: 'x' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(view, { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenCalledWith('src/charges/limit.ts')
  })

  it('has nothing to go through when nothing changed', () => {
    const { onSelect, view } = open({ files: [], selected: null })
    fireEvent.keyDown(view, { key: 'j' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})
