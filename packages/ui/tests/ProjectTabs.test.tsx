import { fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { type ProjectTab, ProjectTabs } from '../src/chrome/ProjectTabs/ProjectTabs'
import { MARKED } from '../src/fixtures/marks'

const tab = (project: (typeof MARKED)[number]): ProjectTab => ({
  id: project.id,
  name: project.name,
  seed: project.id,
  ink: project.ink,
  running: project.running,
  yours: 0,
})

const open = [tab(MARKED[0]!), tab(MARKED[1]!)]

const renderTabs = (props: Partial<Parameters<typeof ProjectTabs>[0]> = {}) =>
  render(<ProjectTabs tabs={open} current={open[0]!.id} onSelect={vi.fn()} onClose={vi.fn()} lights="drawn" {...props} />)

describe('the window’s own buttons', () => {
  it('draws them where the system draws none, and hands each press on', () => {
    const onCloseWindow = vi.fn()
    const onMinimize = vi.fn()
    const onToggleMaximize = vi.fn()
    const { container } = renderTabs({ onCloseWindow, onMinimize, onToggleMaximize })
    const lights = within(container.querySelector<HTMLElement>('[class*="lights"]')!)

    fireEvent.click(lights.getByRole('button', { name: 'Close the window' }))
    fireEvent.click(lights.getByRole('button', { name: 'Minimize the window' }))
    fireEvent.click(lights.getByRole('button', { name: 'Maximize the window' }))
    expect(onCloseWindow).toHaveBeenCalledOnce()
    expect(onMinimize).toHaveBeenCalledOnce()
    expect(onToggleMaximize).toHaveBeenCalledOnce()
  })

  it('keeps only the system’s place where macOS draws the lights', () => {
    const { container } = renderTabs({ lights: 'space' })
    const lights = container.querySelector<HTMLElement>('[class*="lights"]')!
    expect(lights.getAttribute('aria-hidden')).toBe('true')
    expect(within(lights).queryByRole('button')).toBeNull()
  })

  it('gives every button a focus stop, in the order macOS draws them, as plain buttons', () => {
    const { container } = renderTabs({ onCloseWindow: vi.fn(), onMinimize: vi.fn(), onToggleMaximize: vi.fn() })
    const lights = within(container.querySelector<HTMLElement>('[class*="lights"]')!)
    const buttons = lights.getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Close the window',
      'Minimize the window',
      'Maximize the window',
    ])
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button')
    buttons[0]!.focus()
    expect(document.activeElement).toBe(buttons[0])
  })
})
