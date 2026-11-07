import { act, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { PageFrame } from '../src/browser/PageFrame/PageFrame'
import { PagePanel } from '../src/browser/PagePanel/PagePanel'
import { Popover } from '../src/primitives/Popover/Popover'
import { SidePanel } from '../src/primitives/SidePanel/SidePanel'

/*
 * The page beside the conversation (ADR-100): its bar's address is typed
 * over whole, Escape inside what the bar opened closes only that, and
 * Escape in the panel itself closes the panel.
 */

const VIEWPORTS = [
  { value: 'fit', label: 'Fit the panel' },
  { value: 'phone', label: 'Phone', hint: '390 × 844' },
] as const

const panel = (overrides: Partial<Parameters<typeof PagePanel<'fit' | 'phone'>>[0]> = {}) => {
  const props = {
    address: 'localhost:5173/refunds',
    full: 'http://localhost:5173/refunds',
    canBack: false,
    canForward: false,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onNavigate: vi.fn(),
    keep: 'until the task is done',
    onClear: vi.fn(),
    viewport: 'fit' as const,
    viewports: VIEWPORTS,
    onViewport: vi.fn(),
    onClose: vi.fn(),
    children: <PageFrame />,
    ...overrides,
  }
  const { rerender } = render(<PagePanel<'fit' | 'phone'> {...props} />)
  return { ...props, rerender: (changed: Partial<typeof props>) => rerender(<PagePanel<'fit' | 'phone'> {...props} {...changed} />) }
}

describe('the page’s bar', () => {
  it('shows the full address as it is focused, selected, so what is typed at once takes its place', async () => {
    const { onNavigate } = panel()
    const field = screen.getByRole('textbox', { name: 'Address' })
    expect(field).toHaveValue('localhost:5173/refunds')
    await userEvent.click(field)
    expect(field).toHaveValue('http://localhost:5173/refunds')
    expect((field as HTMLInputElement).selectionStart).toBe(0)
    expect((field as HTMLInputElement).selectionEnd).toBe('http://localhost:5173/refunds'.length)
    await userEvent.keyboard('file:///etc/hosts{Enter}')
    expect(onNavigate).toHaveBeenCalledWith('file:///etc/hosts')
  })

  it('keeps what was typed as focus leaves and comes back, until it is sent, put back, or the page goes elsewhere meanwhile', async () => {
    const props = panel()
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    // Focus goes as another window or a menu closing takes it, and comes back: what was typed is there, typed on from its end.
    await userEvent.click(field)
    await userEvent.keyboard('file:///etc')
    act(() => field.blur())
    expect(field).toHaveValue('localhost:5173/refunds')
    act(() => field.focus())
    expect(field).toHaveValue('file:///etc')
    expect([field.selectionStart, field.selectionEnd]).toEqual([11, 11])
    await userEvent.keyboard('/hosts{Enter}')
    expect(props.onNavigate).toHaveBeenCalledWith('file:///etc/hosts')
    // Sent, it is gone: focused again, the field has the page's address, whole.
    act(() => field.focus())
    expect(field).toHaveValue('http://localhost:5173/refunds')
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'http://localhost:5173/refunds'.length])
    // Put back with Escape, it is gone too.
    await userEvent.keyboard('althar.ai{Escape}')
    act(() => field.focus())
    expect(field).toHaveValue('http://localhost:5173/refunds')
    // The page going elsewhere as the field has focus keeps it; going elsewhere as it hasn't takes it.
    await userEvent.keyboard('example.com')
    props.rerender({ address: 'localhost:5173/orders', full: 'http://localhost:5173/orders' })
    expect(field).toHaveValue('example.com')
    act(() => field.blur())
    act(() => field.focus())
    expect(field).toHaveValue('example.com')
    act(() => field.blur())
    props.rerender({ address: 'localhost:5173/receipts', full: 'http://localhost:5173/receipts' })
    act(() => field.focus())
    expect(field).toHaveValue('http://localhost:5173/receipts')
  })

  it('puts the address back on Escape, without closing the panel', async () => {
    const { onClose, onNavigate } = panel()
    const field = screen.getByRole('textbox', { name: 'Address' })
    await userEvent.click(field)
    await userEvent.keyboard('althar.ai{Escape}')
    expect(field).toHaveValue('localhost:5173/refunds')
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers Comment, the person’s browser and a tab only where the host gives them; reload becomes stop while loading', () => {
    panel({ loading: true, onStop: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open in your browser' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open as a tab' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop loading' })).toBeInTheDocument()
  })

  it('says the size on Viewport where it isn’t the panel’s own', () => {
    panel({ viewport: 'phone', onComment: vi.fn(), pointing: true, onOutside: vi.fn(), docked: 'tab', onDock: vi.fn() })
    expect(screen.getByRole('button', { name: 'Viewport: Phone' })).toHaveTextContent('390 × 844')
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Back beside the conversation' })).toBeInTheDocument()
  })
})

describe('a side panel’s Escape', () => {
  it('closes what the panel opened over the window alone, and the panel only from inside it', async () => {
    const onClose = vi.fn()
    render(
      <SidePanel label="Page" head={null} onClose={onClose}>
        <Popover label="Its own session" trigger={<button type="button">Session</button>}>
          <button type="button">Inside</button>
        </Popover>
      </SidePanel>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Session' }))
    expect(await screen.findByRole('button', { name: 'Inside' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => fireEvent.keyDown(screen.getByRole('button', { name: 'Session' }), { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
