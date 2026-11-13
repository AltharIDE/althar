import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { You } from '../src/thread/You/You'
import { UndoTurnDialog } from '../src/thread/UndoTurn/UndoTurnDialog'

describe('undoing a delivered chat turn', () => {
  it('offers undo only when the host supplies the action', async () => {
    const undo = vi.fn()
    const { rerender } = render(<You onUndo={undo}>Change the retry limit.</You>)
    await userEvent.click(screen.getByRole('button', { name: 'Undo from here' }))
    expect(undo).toHaveBeenCalledOnce()
    rerender(<You>Change the retry limit.</You>)
    expect(screen.queryByRole('button', { name: 'Undo from here' })).toBeNull()
  })

  it('explains the scope and waits for an explicit choice', async () => {
    const undo = vi.fn()
    const close = vi.fn()
    render(<UndoTurnDialog prompt="Change the retry limit." onUndo={undo} onClose={close} />)
    expect(screen.getByRole('dialog', { name: 'Undo from here?' })).toBeTruthy()
    expect(undo).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(close).toHaveBeenCalledOnce()
    expect(undo).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Undo files and conversation' }))
    expect(undo).toHaveBeenCalledOnce()
  })

  it('keeps the dialog open during undo and announces a recoverable refusal', async () => {
    const undo = vi.fn()
    const close = vi.fn()
    const { rerender } = render(<UndoTurnDialog prompt="Change the retry limit." busy onUndo={undo} onClose={close} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo files and conversation' }))
    await userEvent.keyboard('{Escape}')
    expect(undo).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    rerender(
      <UndoTurnDialog
        prompt="Change the retry limit."
        error="retry.ts changed after this turn. Keep or move those edits before undoing."
        onUndo={undo}
        onClose={close}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('retry.ts changed')
    await userEvent.click(screen.getByRole('button', { name: 'Undo files and conversation' }))
    expect(undo).toHaveBeenCalledOnce()
  })
})
