import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentsAtOnce, EdgeScene, NotificationSound, SettingSwitch } from '../src/setup/Preferences/Preferences'

/* The app's preferences, at their edges: a slider not laid out yet, a sound chosen away, a picture of the menu bar. */

const MACHINE = { count: 4, memory: 16, cores: 10 }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('agents at once, before its track is laid out', () => {
  it('keeps the number it has under a press, and sends nothing for it', () => {
    const onChange = vi.fn()
    render(<AgentsAtOnce count={6} machine={MACHINE} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Agents at once' })
    fireEvent.pointerDown(slider, { clientX: 120 })
    expect(slider).toHaveAttribute('aria-valuenow', '6')
    fireEvent.pointerUp(slider)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes no move or release that a press didn’t start, and no key that isn’t a step', () => {
    const onChange = vi.fn()
    render(<AgentsAtOnce count={6} machine={MACHINE} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Agents at once' })
    fireEvent.pointerMove(slider, { clientX: 140 })
    fireEvent.pointerUp(slider)
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(slider).toHaveAttribute('aria-valuenow', '6')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('a notification’s sound', () => {
  it('plays nothing when none is chosen', async () => {
    const onChange = vi.fn()
    const onPlay = vi.fn()
    render(<NotificationSound sounds={['Glass', 'Ping']} value="Glass" onChange={onChange} onPlay={onPlay} />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith(null)
    expect(onPlay).not.toHaveBeenCalled()
  })
})

describe('a row that depends on the one above', () => {
  it('sits indented under it', () => {
    const { container } = render(<SettingSwitch title="On battery too" checked={false} onChange={() => {}} indent />)
    expect(container.firstElementChild).toHaveClass('indent')
  })
})

describe('a picture of the menu bar', () => {
  it('hangs a sheet from the middle with no menu bar item to hang from, and keeps its scale where sizes can’t be watched', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const { container } = render(<EdgeScene sheet={<p>Island sheet</p>} />)
    expect(screen.getByText('Island sheet').parentElement).toHaveClass('hungMiddle')
    expect(container.querySelector<HTMLElement>('[class~="stage"]')?.style.transform).toBe('scale(0.6)')
  })
})
