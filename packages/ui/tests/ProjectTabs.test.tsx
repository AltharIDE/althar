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

describe('the settings’ tab', () => {
  const nav = (container: HTMLElement) => within(container.querySelector<HTMLElement>('nav')!)

  it('has none until settings are open', () => {
    const { container } = renderTabs()
    expect(nav(container).queryByRole('button', { name: 'Settings' })).toBeNull()
  })

  it('sits beside the home’s, and has the window alone while it does', () => {
    const { container } = renderTabs({ settings: { current: true, onSelect: vi.fn(), onClose: vi.fn() } })
    const tabs = nav(container)
    const [home, settings] = tabs.getAllByRole('button').filter((button) => !button.getAttribute('aria-label'))
    expect(home?.textContent).toBe('Home')
    expect(settings?.textContent).toBe('Settings')
    expect(settings?.getAttribute('aria-current')).toBe('page')
    // The project the window was in before keeps its tab, without the window.
    expect(tabs.getByRole('button', { name: /^Meridian/ }).getAttribute('aria-current')).toBeNull()
    expect(tabs.getByRole('button', { name: /^Home/ }).getAttribute('aria-current')).toBeNull()
  })

  it('stays beside the home’s while another tab has the window, and hands on its press and its close', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { container } = renderTabs({ current: null, settings: { current: false, onSelect, onClose } })
    const tabs = nav(container)
    const settings = tabs.getByRole('button', { name: 'Settings' })
    expect(settings.getAttribute('aria-current')).toBeNull()
    expect(tabs.getByRole('button', { name: /^Home/ }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(settings)
    expect(onSelect).toHaveBeenCalledOnce()
    fireEvent.click(tabs.getByRole('button', { name: 'Close Settings' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('a project’s tab, before it is pressed', () => {
  it('says it is pointed at or reached by keyboard, so what it shows can be read ahead', () => {
    const onPreview = vi.fn()
    const onSelect = vi.fn()
    const { container } = renderTabs({ current: null, onPreview, onSelect })
    const nav = (container: HTMLElement) => within(container.querySelector<HTMLElement>('nav')!)
    const tab = nav(container).getByRole('button', { name: new RegExp(`^${open[0]!.name}`) })
    fireEvent.pointerEnter(tab)
    expect(onPreview).toHaveBeenLastCalledWith(open[0]!.id)
    fireEvent.focus(nav(container).getByRole('button', { name: new RegExp(`^${open[1]!.name}`) }))
    expect(onPreview).toHaveBeenLastCalledWith(open[1]!.id)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
