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
    await userEvent.click(screen.getByRole('button', { name: 'Undo from here' }))
    expect(undo).toHaveBeenCalledOnce()
  })

  it('keeps secondary scope details folded and lets the full selected message be read', async () => {
    const prompt = 'Keep the timeout behavior and error messages. '.repeat(8)
    render(<UndoTurnDialog prompt={prompt} onUndo={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/Other edits, Git history/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'What stays' }))
    expect(screen.getByText(/Other edits, Git history/)).toBeVisible()
    const expand = screen.getByRole('button', { name: 'Show full message' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(expand.getAttribute('aria-controls') ?? '')?.textContent).toBe(prompt)
    await userEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Show full message' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['edited', 'staged'] as const)('blocks a %s file conflict and opens its edits instead of repeating undo', async (kind) => {
    const undo = vi.fn()
    const review = vi.fn()
    render(
      <UndoTurnDialog
        prompt="Change retry.ts."
        error="These files need attention."
        errorFiles={['src/retry.ts']}
        errorKind={kind}
        onReviewEdits={review}
        onUndo={undo}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').querySelector('code')?.textContent).toBe('src/retry.ts')
    expect(screen.getByRole('alert')).toHaveTextContent(kind === 'edited' ? 'Keep or move them' : 'Unstage them')
    await userEvent.click(screen.getByRole('button', { name: 'Undo from here' }))
    expect(undo).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Review edits' }))
    expect(review).toHaveBeenCalledOnce()
  })

  it('keeps the dialog open during undo and announces a recoverable refusal', async () => {
    const undo = vi.fn()
    const close = vi.fn()
    const { rerender } = render(<UndoTurnDialog prompt="Change the retry limit." busy onUndo={undo} onClose={close} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo from here' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Undo from here' }))
    expect(undo).toHaveBeenCalledOnce()
  })
})
