import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackCrumb } from '../src/chrome/BackCrumb/BackCrumb'
import { TitleBar } from '../src/chrome/TitleBar/TitleBar'
import { Snippet } from '../src/thread/Snippet/Snippet'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('renaming a task from its crumb', () => {
  const crumb = (onRename = vi.fn(), more: Partial<Parameters<typeof BackCrumb>[0]> = {}) =>
    render(<BackCrumb to="Meridian" onBack={vi.fn()} task="#12" title="Add a retry" onRename={onRename} {...more} />)
  const field = () => screen.getByRole('textbox', { name: 'Rename' })

  it('opens the title to edit, selected, and keeps a new one, trimmed, on Enter', () => {
    const onRename = vi.fn()
    crumb(onRename)
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Add a retry' }))
    expect(field()).toHaveFocus()
    expect(field()).toHaveValue('Add a retry')
    fireEvent.change(field(), { target: { value: '  Add a retry to checkout ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onRename).toHaveBeenCalledExactlyOnceWith('Add a retry to checkout')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps nothing where the title is the same', () => {
    const onRename = vi.fn()
    crumb(onRename)
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Add a retry' }))
    fireEvent.change(field(), { target: { value: 'Add a retry ' } })
    fireEvent.blur(field())
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename: Add a retry' })).toBeInTheDocument()
  })

  it('says an emptied title isn’t kept on Enter, until something is typed, and puts it back when the focus leaves', () => {
    const onRename = vi.fn()
    crumb(onRename)
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Add a retry' }))
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('Give the task a title.')
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(field(), { target: { value: ' ' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(field())
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Rename: Add a retry' })).toBeInTheDocument()
  })

  it('puts the title back on Escape, the blur after it keeping nothing', () => {
    const onRename = vi.fn()
    const onEditingChange = vi.fn()
    crumb(onRename, { onEditingChange })
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Add a retry' }))
    expect(onEditingChange).toHaveBeenLastCalledWith(true)
    const input = field()
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
    expect(onEditingChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps a title once, though its owner keeps the field open as the focus leaves it', () => {
    const onRename = vi.fn()
    crumb(onRename, { editing: true })
    fireEvent.change(field(), { target: { value: 'Add a retry to checkout' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.blur(field())
    expect(onRename).toHaveBeenCalledExactlyOnceWith('Add a retry to checkout')
  })

  it('leaves Enter and Escape to an input method composing', () => {
    const onRename = vi.fn()
    crumb(onRename)
    fireEvent.click(screen.getByRole('button', { name: 'Rename: Add a retry' }))
    fireEvent.change(field(), { target: { value: 'リトライ' } })
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field(), { key: 'Escape', isComposing: true })
    expect(field()).toHaveValue('リトライ')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('opens to edit where its owner says so, and reads the title as the page’s heading', () => {
    function Owned() {
      const [editing, setEditing] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setEditing(true)}>
            Rename from the menu
          </button>
          <BackCrumb
            to="Meridian"
            onBack={vi.fn()}
            title="Add a retry"
            titleLevel={1}
            onRename={vi.fn()}
            editing={editing}
            onEditingChange={setEditing}
          />
        </>
      )
    }
    render(<Owned />)
    expect(screen.getByRole('heading', { level: 1, name: 'Add a retry' })).toHaveAttribute('title', 'Add a retry')
    fireEvent.click(screen.getByRole('button', { name: 'Rename from the menu' }))
    expect(field()).toHaveFocus()
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('only reads the title without a way to rename it', () => {
    render(<BackCrumb to="Meridian" onBack={vi.fn()} title="Add a retry" editing kbd="⌘[" />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to Meridian' })).toHaveTextContent('Meridian⌘[')
  })
})

describe('a command to copy', () => {
  it('shows a long one whole on request, and short again', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    const { container } = render(<Snippet cmd={`curl ${'https://example.com/'.repeat(10)}`} />)
    const toggle = screen.getByRole('button', { name: 'Show all' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    expect(container.firstElementChild?.className).toMatch(/open/)
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument()
  })

  it('offers only the copy for one that fits, measured once where the width can’t be followed', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    render(<Snippet cmd="bun test" text={{ copy: { copy: 'Copy it' } }} />)
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Copy it'])
  })
})

describe('a window’s title bar', () => {
  it('draws the window’s own buttons where asked, wired to the window', () => {
    const frame = { onClose: vi.fn(), onMinimize: vi.fn(), onToggleMaximize: vi.fn(), maximized: true }
    render(
      <TitleBar lights="drawn" window={frame} text={{ close: 'Close it' }} end={<span>Status</span>}>
        <span>Meridian</span>
      </TitleBar>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore the window' }))
    expect(frame.onClose).toHaveBeenCalledOnce()
    expect(frame.onToggleMaximize).toHaveBeenCalledOnce()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('draws inert dots where asked to draw them with no window to wire, keeps the system’s room, or none', () => {
    const { container, rerender } = render(
      <TitleBar lights="drawn">
        <span>Meridian</span>
      </TitleBar>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')?.className).toMatch(/drawn/)
    rerender(
      <TitleBar>
        <span>Meridian</span>
      </TitleBar>,
    )
    expect(container.querySelector('[aria-hidden="true"]')?.className).not.toMatch(/drawn/)
    rerender(
      <TitleBar lights="none">
        <span>Meridian</span>
      </TitleBar>,
    )
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.querySelector('header')?.children).toHaveLength(1)
  })
})
