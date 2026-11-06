import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProjectTabs } from '../src/chrome/ProjectTabs/ProjectTabs'
import { TitleBar } from '../src/chrome/TitleBar/TitleBar'
import { WindowButtons } from '../src/chrome/WindowButtons/WindowButtons'

/* The window's own buttons in each desktop's manner (ADR-097): real buttons, named, in the order and at the end the desktop says. */

const names = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)

describe('the window’s own buttons', () => {
  it.each(['dots', 'gnome', 'kde', 'windows'] as const)('in the %s manner, are named buttons that act', (look) => {
    const onClose = vi.fn()
    const onMinimize = vi.fn()
    const onToggleMaximize = vi.fn()
    render(<WindowButtons look={look} onClose={onClose} onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close the window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize the window' }))
    expect([onClose, onMinimize, onToggleMaximize].map((one) => one.mock.calls.length)).toEqual([1, 1, 1])
  })

  it('show only the buttons asked for, in their order, and say restore once maximized', () => {
    render(<WindowButtons look="gnome" buttons={['close']} />)
    expect(names()).toEqual(['Close the window'])
    render(<WindowButtons look="kde" buttons={['maximize', 'close']} maximized />)
    expect(names()).toEqual(['Close the window', 'Restore the window', 'Close the window'])
  })
})

describe('a bar with the desktop’s buttons', () => {
  const window = { onClose: vi.fn(), onMinimize: vi.fn(), onToggleMaximize: vi.fn() }

  it('puts them at its end, after what the bar holds, where the desktop does', () => {
    render(
      <TitleBar
        lights="drawn"
        window={window}
        controls={{ look: 'gnome', start: [], end: ['minimize', 'close'] }}
        end={<button type="button">Panel</button>}
      >
        <button type="button">Project</button>
      </TitleBar>,
    )
    expect(names()).toEqual(['Project', 'Panel', 'Minimize the window', 'Close the window'])
  })

  it('splits them between its ends where the desktop does', () => {
    render(
      <ProjectTabs
        tabs={[]}
        current={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        lights="drawn"
        controls={{ look: 'kde', start: ['close'], end: ['maximize'] }}
        end={<button type="button">Gear</button>}
      />,
    )
    const all = names()
    expect(all[0]).toBe('Close the window')
    expect(all.slice(-2)).toEqual(['Gear', 'Maximize the window'])
  })

  it('draws none where the window manager draws the frame', () => {
    render(
      <TitleBar lights="none">
        <span>Project</span>
      </TitleBar>,
    )
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
