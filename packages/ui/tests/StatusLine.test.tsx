import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { asksFirst, StatusDrawer, type StatusItem, StatusLine } from '../src/chrome/StatusLine/StatusLine'
import { actionOf, macKeyOf, quotedPath } from '../src/chrome/TerminalView/session'

afterEach(cleanup)

const ITEMS: StatusItem[] = [
  { kind: 'run', id: 'ios', name: 'iOS simulator', phase: 'failed', code: 1 },
  { kind: 'run', id: 'sb', name: 'Storybook', phase: 'up', url: 'http://localhost:6006/' },
  { kind: 'terminal', id: 't1', name: 'althar' },
  { kind: 'terminal', id: 't2', name: 'althar 2', busy: 'bun' },
]

const line = (items = ITEMS) => {
  const handlers = { onPress: vi.fn(), onDismiss: vi.fn(), onNewTerminal: vi.fn() }
  render(<StatusLine items={items} {...handlers} />)
  return handlers
}

describe('the status line', () => {
  it('says how each run stands and what runs in a terminal', () => {
    line()
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['iOS simulatorExited 1', 'Storybooklocalhost:6006', 'althar', 'althar 2bun'])
  })

  it('raises the drawer on what is pressed, and opens a terminal from its end', async () => {
    const { onPress, onNewTerminal } = line()
    fireEvent.click(screen.getByRole('button', { name: /^Storybook/ }))
    expect(onPress).toHaveBeenCalledWith('sb')
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    expect(onNewTerminal).toHaveBeenCalledOnce()
  })

  it('closes a run that ended and an idle terminal at once, by its X or Delete', async () => {
    const { onDismiss } = line()
    fireEvent.click(screen.getByRole('button', { name: 'Close iOS simulator' }))
    expect(onDismiss).toHaveBeenCalledWith('ios')
    fireEvent.keyDown(screen.getByRole('button', { name: 'althar' }), { key: 'Delete' })
    expect(onDismiss).toHaveBeenCalledWith('t1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before closing stops something, and closes it only once told to', async () => {
    const { onDismiss } = line()
    fireEvent.click(screen.getByRole('button', { name: 'Close Storybook' }))
    const ask = await screen.findByRole('dialog', { name: 'Stop Storybook?' })
    expect(ask.textContent).toContain('It’s still running. Closing it stops it.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep' }))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close althar 2' }))
    const terminal = await screen.findByRole('dialog', { name: 'Close terminal' })
    expect(terminal.textContent).toContain('bun is still running in it. Closing the terminal stops it.')
    fireEvent.click(within(terminal).getByRole('button', { name: 'Close terminal' }))
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('t2')
  })

  it('asks first only where closing stops something', () => {
    expect(ITEMS.map(asksFirst)).toEqual([false, true, false, true])
    expect(asksFirst({ kind: 'run', id: 'x', name: 'x', phase: 'starting' })).toBe(true)
    expect(asksFirst({ kind: 'terminal', id: 'x', name: 'x', busy: 'vim', code: 130 })).toBe(false)
  })
})

describe('a terminal’s keys', () => {
  const key = (key: string, mods: Partial<Record<'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey', boolean>> = {}) => ({
    key,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...mods,
  })

  it('copies, pastes, selects all, clears and finds with each system’s keys, and leaves the rest to the shell', () => {
    expect(actionOf(key('c', { metaKey: true }), 'darwin', true)).toBe('copy')
    expect(actionOf(key('c', { metaKey: true }), 'darwin', false)).toBeUndefined()
    expect(actionOf(key('k', { metaKey: true }), 'darwin', false)).toBe('clear')
    expect(actionOf(key('f', { metaKey: true }), 'darwin', false)).toBe('find')
    expect(actionOf(key('a', { metaKey: true }), 'darwin', false)).toBe('selectAll')
    // ⌘V is the Edit menu's paste, which the terminal takes as it comes.
    expect(actionOf(key('v', { metaKey: true }), 'darwin', false)).toBeUndefined()
    expect(actionOf(key('c', { ctrlKey: true }), 'darwin', true)).toBeUndefined()
    expect(actionOf(key('C', { ctrlKey: true, shiftKey: true }), 'linux', false)).toBe('copy')
    expect(actionOf(key('V', { ctrlKey: true, shiftKey: true }), 'linux', false)).toBe('paste')
    expect(actionOf(key('c', { ctrlKey: true }), 'linux', true)).toBeUndefined()
    expect(actionOf(key('c', { ctrlKey: true }), 'win32', true)).toBe('copy')
    expect(actionOf(key('c', { ctrlKey: true }), 'win32', false)).toBeUndefined()
    expect(actionOf(key('v', { ctrlKey: true }), 'win32', false)).toBe('paste')
    expect(actionOf(key('f', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('find')
  })

  it('moves a word or a line at a time, and deletes them, as a Mac’s editors do', () => {
    expect(macKeyOf(key('ArrowLeft', { metaKey: true }))).toBe('\x01')
    expect(macKeyOf(key('ArrowRight', { metaKey: true }))).toBe('\x05')
    expect(macKeyOf(key('Backspace', { metaKey: true }))).toBe('\x15')
    expect(macKeyOf(key('ArrowLeft', { altKey: true }))).toBe('\x1bb')
    expect(macKeyOf(key('ArrowRight', { altKey: true }))).toBe('\x1bf')
    expect(macKeyOf(key('Backspace', { altKey: true }))).toBe('\x1b\x7f')
    expect(macKeyOf(key('ArrowLeft'))).toBeUndefined()
    expect(macKeyOf(key('ArrowLeft', { metaKey: true, shiftKey: true }))).toBeUndefined()
  })

  it('types a dropped file’s path as its shell reads it', () => {
    expect(quotedPath('/Users/me/app/src/index.ts', 'darwin')).toBe('/Users/me/app/src/index.ts')
    expect(quotedPath("/Users/me/My Files/it's.png", 'darwin')).toBe("'/Users/me/My Files/it'\\''s.png'")
    expect(quotedPath('C:\\Users\\me\\My Files\\a.txt', 'win32')).toBe('"C:\\Users\\me\\My Files\\a.txt"')
  })
})

describe('a run’s mark and words', () => {
  it('says each phase, and a failure with or without its exit code', () => {
    const phase = (item: StatusItem) => {
      const { container, unmount } = render(<StatusLine items={[item]} onPress={vi.fn()} onDismiss={vi.fn()} onNewTerminal={vi.fn()} />)
      const text = container.querySelector('[role="listitem"]')?.textContent
      unmount()
      return text
    }
    expect(phase({ kind: 'run', id: 'a', name: 'A', phase: 'starting' })).toBe('AStarting…')
    expect(phase({ kind: 'run', id: 'a', name: 'A', phase: 'finished' })).toBe('AFinished')
    expect(phase({ kind: 'run', id: 'a', name: 'A', phase: 'stopped' })).toBe('AStopped')
    expect(phase({ kind: 'run', id: 'a', name: 'A', phase: 'failed' })).toBe('AFailed')
    expect(phase({ kind: 'run', id: 'a', name: 'A', phase: 'up' })).toBe('A')
    expect(phase({ kind: 'terminal', id: 't', name: 'T', code: 2 })).toBe('TExited 2')
  })

  it('shows the key that opens a terminal, and leaves other keys on an item alone', () => {
    const { onDismiss } = (() => {
      const handlers = { onPress: vi.fn(), onDismiss: vi.fn(), onNewTerminal: vi.fn() }
      render(<StatusLine items={ITEMS} chosen="t1" newTerminalKbd="⌃`" {...handlers} />)
      return handlers
    })()
    expect(screen.getByRole('button', { name: 'althar' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'althar' }), { key: 'a' })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('the drawer', () => {
  const drawer = (height: number, max: number, extra: { actions?: boolean } = {}) => {
    const onHeight = vi.fn()
    const onLower = vi.fn()
    render(
      <StatusDrawer
        title="Storybook"
        {...(extra.actions ? { actions: <button type="button">Do</button> } : {})}
        height={height}
        max={max}
        onHeight={onHeight}
        onLower={onLower}
        label="Drawer"
      >
        <div className="xterm">
          <input aria-label="inside" />
        </div>
        <input aria-label="outside" />
      </StatusDrawer>,
    )
    return { onHeight, onLower }
  }

  it('keeps its height between the least and the most, and shows its actions where it has them', () => {
    drawer(50, 400, { actions: true })
    expect(screen.getByRole('region', { name: 'Drawer' }).style.height).toBe('160px')
    expect(screen.getByRole('button', { name: 'Do' })).toBeTruthy()
    cleanup()
    drawer(900, 300)
    expect(screen.getByRole('region', { name: 'Drawer' }).style.height).toBe('300px')
    expect(screen.queryByRole('button', { name: 'Do' })).toBeNull()
  })

  it('lowers on Escape outside a terminal, and leaves Escape to a terminal', () => {
    const { onLower } = drawer(300, 600)
    fireEvent.keyDown(screen.getByLabelText('inside'), { key: 'Escape' })
    expect(onLower).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('outside'), { key: 'a' })
    expect(onLower).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('outside'), { key: 'Escape' })
    expect(onLower).toHaveBeenCalledOnce()
  })

  it('moves its edge a step by the arrows, and by a drag', () => {
    const { onHeight } = drawer(300, 600)
    const edge = screen.getByRole('separator')
    expect(edge.getAttribute('aria-valuenow')).toBe('300')
    fireEvent.keyDown(edge, { key: 'ArrowUp' })
    expect(onHeight).toHaveBeenLastCalledWith(324)
    fireEvent.keyDown(edge, { key: 'ArrowDown' })
    expect(onHeight).toHaveBeenLastCalledWith(276)
    onHeight.mockClear()
    fireEvent.keyDown(edge, { key: 'Enter' })
    expect(onHeight).not.toHaveBeenCalled()

    const capture = { set: vi.fn(), release: vi.fn(), has: vi.fn(() => true) }
    Object.defineProperties(edge, {
      setPointerCapture: { value: capture.set, configurable: true },
      releasePointerCapture: { value: capture.release, configurable: true },
      hasPointerCapture: { value: capture.has, configurable: true },
    })
    fireEvent.pointerMove(edge, { clientY: 100 })
    expect(onHeight).not.toHaveBeenCalled()
    fireEvent.pointerDown(edge, { button: 2, clientY: 500 })
    fireEvent.pointerMove(edge, { clientY: 450 })
    expect(onHeight).not.toHaveBeenCalled()
    fireEvent.pointerDown(edge, { button: 0, clientY: 500 })
    fireEvent.pointerMove(edge, { clientY: 450 })
    expect(onHeight).toHaveBeenLastCalledWith(350)
    fireEvent.pointerUp(edge)
    expect(capture.release).toHaveBeenCalled()
    fireEvent.pointerMove(edge, { clientY: 400 })
    expect(onHeight).toHaveBeenCalledOnce()
    fireEvent.pointerDown(edge, { button: 0, clientY: 500 })
    capture.has.mockReturnValue(false)
    fireEvent.pointerCancel(edge)
    expect(capture.release).toHaveBeenCalledOnce()
  })
})
