import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ContextRing } from '../src/composer/ContextRing/ContextRing'
import { Button } from '../src/primitives/Button/Button'
import { ClearChatDialog, type ClearKind } from '../src/thread/ClearChat/ClearChatDialog'
import { ClearedLine } from '../src/thread/ClearChat/ClearedLine'

/*
 * Clearing the coordinator's chat: one question with two kinds, the one to
 * forget red and never the default; the line where a cleared view begins; the
 * bar that holds Clear; and the context ring's foot, where the same question is
 * asked on forgetting.
 */

/** The control that asks it, as a screen has one: focus goes into the question and comes back. */
function Asked({ startOn, clearable = true, onClear }: { startOn?: ClearKind; clearable?: boolean; onClear: (kind: ClearKind) => void }) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button onClick={() => setAsking(true)}>Open</Button>
      {asking && (
        <ClearChatDialog
          {...(startOn === undefined ? {} : { startOn })}
          clearable={clearable}
          onClear={onClear}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  )
}

describe('the question', () => {
  it('opens on clearing the view, and clears only that when its button is pressed', async () => {
    const onClear = vi.fn()
    render(<Asked onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(dialog).toHaveAccessibleDescription('Only the view is cleared. The coordinator keeps the conversation.')
    // Each choice is read with its note.
    expect(screen.getByRole('radio', { name: /^Clear only the view\s*The conversation stays here, a press away\.$/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^Forget the conversation too\s*Can’t be undone\.$/ })).not.toBeChecked()
    // Neither the red button nor a default one waits to be pressed: the button says what it does.
    await userEvent.click(screen.getByRole('button', { name: 'Clear the view' }))
    expect(onClear).toHaveBeenCalledExactlyOnceWith('view')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on forgetting where asked to, and then says so and turns red', async () => {
    const onClear = vi.fn()
    render(<Asked startOn="forget" onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(screen.getByRole('radio', { name: /Forget the conversation too/ })).toBeChecked()
    expect(dialog).toHaveAccessibleDescription('The coordinator forgets this conversation. Its notes, tasks and errands stay.')
    const forget = screen.getByRole('button', { name: 'Clear and forget' })
    expect(forget.className).toMatch(/danger/)
    await userEvent.click(forget)
    expect(onClear).toHaveBeenCalledExactlyOnceWith('forget')
  })

  it('can be taken back to clearing the view from the warning, and the button follows the choice', async () => {
    const onClear = vi.fn()
    render(<Asked startOn="forget" onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Clear only the view/ }))
    expect(screen.queryByRole('button', { name: 'Clear and forget' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Clear the view' }))
    expect(onClear).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('says the view is already clear, and leaves forgetting chosen and one press away', async () => {
    const onClear = vi.fn()
    render(<Asked clearable={false} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const light = await screen.findByRole('radio', { name: /^Clear only the view\s*The view is already clear\.$/ })
    expect(light).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Forget the conversation too/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Clear and forget' }))
    expect(onClear).toHaveBeenCalledExactlyOnceWith('forget')
  })

  it('moves focus in, forgets nothing on Enter or Escape, and gives focus back to its control', async () => {
    const onClear = vi.fn()
    render(<Asked startOn="forget" onClear={onClear} />)
    const open = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    // Inside the question, on what is chosen, not on the button that would forget.
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Forget the conversation too/ }))
    await userEvent.keyboard('{Enter}')
    expect(onClear).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClear).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(open)
  })

  it('is left with Cancel without clearing anything', async () => {
    const onClear = vi.fn()
    render(<Asked onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClear).not.toHaveBeenCalled()
  })

  it('gives focus to where it says when the control that opened it has gone', async () => {
    function Gone() {
      const [stage, setStage] = useState<'closed' | 'open'>('closed')
      return (
        <>
          <button type="button">Ring</button>
          {stage === 'closed' && (
            <Button
              onClick={() => {
                setStage('open')
              }}
            >
              Open
            </Button>
          )}
          {stage === 'open' && (
            <ClearChatDialog
              startOn="forget"
              clearable
              onClear={() => {}}
              onClose={() => setStage('closed')}
              returnFocus={() => screen.getByRole('button', { name: 'Ring' })}
            />
          )}
        </>
      )
    }
    render(<Gone />)
    const open = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(open)
    // The control that opened it goes meanwhile, as a popover's button does when the popover closes.
    open.remove()
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ring' }))
  })
})

describe('the line where a cleared view begins', () => {
  it('offers the earlier conversation and Undo', async () => {
    const handlers = { onShowEarlier: vi.fn(), onBackToNow: vi.fn(), onUndo: vi.fn() }
    render(<ClearedLine earlierOpen={false} {...handlers} />)
    expect(screen.getByText('Cleared')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(handlers.onShowEarlier).toHaveBeenCalledOnce()
    expect(handlers.onUndo).toHaveBeenCalledOnce()
    expect(handlers.onBackToNow).not.toHaveBeenCalled()
  })

  it('offers the way back to now, with the earlier conversation open, and Undo', async () => {
    const handlers = { onShowEarlier: vi.fn(), onBackToNow: vi.fn(), onUndo: vi.fn() }
    const scrolled = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrolled })
    render(<ClearedLine earlierOpen {...handlers} />)
    expect(screen.getByText('Earlier conversation')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back to now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(handlers.onBackToNow).toHaveBeenCalledOnce()
    expect(handlers.onUndo).toHaveBeenCalledOnce()
    // It brings itself into view, after the thread has drawn what it holds.
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled())
  })

  it('keeps its dots out of what a screen reader says', () => {
    const { container } = render(<ClearedLine earlierOpen={false} onShowEarlier={() => {}} onBackToNow={() => {}} onUndo={() => {}} />)
    expect([...container.querySelectorAll('[aria-hidden="true"]')].filter((one) => one.textContent?.includes('·'))).toHaveLength(2)
  })
})

describe('the context ring', () => {
  it('asks to clear the chat from its foot, before Compact', async () => {
    const onClear = vi.fn()
    const onCompact = vi.fn()
    render(<ContextRing used={96} total={200} defaultOpen onClear={onClear} onCompact={onCompact} />)
    const buttons = (await screen.findAllByRole('button')).map((one) => one.textContent)
    expect(buttons.filter((one) => one === 'Clear chat…' || one === 'Compact')).toEqual(['Clear chat…', 'Compact'])
    await userEvent.click(screen.getByRole('button', { name: 'Clear chat…' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('keeps Compact alone where there is no chat to clear', async () => {
    render(<ContextRing used={96} total={200} defaultOpen onCompact={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Compact' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Clear chat…' })).toBeNull()
  })
})
