import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentsAtOnce } from '../src/setup/Preferences/Preferences'

const MACHINE = { count: 4, memory: 16, cores: 10 }

/* A 150px track from x=0, so the number is 1 + x/10: 1 at x=0, 16 at x=150. */
function track(props: Partial<Parameters<typeof AgentsAtOnce>[0]> = {}) {
  const onChange = vi.fn()
  render(<AgentsAtOnce count={4} machine={MACHINE} onChange={onChange} {...props} />)
  const slider = screen.getByRole('slider', { name: 'Agents at once' })
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 150 } as DOMRect)
  return { slider, onChange }
}

describe('AgentsAtOnce pointer', () => {
  it('shows the number under the pointer while dragging and sends it once the pointer is let go', () => {
    const { slider, onChange } = track()
    fireEvent.pointerDown(slider, { clientX: 100 })
    expect(slider.getAttribute('aria-valuenow')).toBe('11')
    fireEvent.pointerMove(slider, { clientX: 150 })
    expect(slider.getAttribute('aria-valuenow')).toBe('16')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(16)
  })

  it('pulls the thumb into the default as it passes, and sends null for it', () => {
    const { slider, onChange } = track({ count: 8 })
    fireEvent.pointerDown(slider, { clientX: 33 })
    expect(slider.getAttribute('aria-valuenow')).toBe('4')
    fireEvent.pointerUp(slider)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('stays within one and the most, and sends nothing when the number did not change', () => {
    const { slider, onChange } = track()
    fireEvent.pointerDown(slider, { clientX: -40 })
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
    fireEvent.pointerMove(slider, { clientX: 30 })
    fireEvent.pointerMove(slider, { clientX: 400 })
    expect(slider.getAttribute('aria-valuenow')).toBe('16')
    fireEvent.pointerMove(slider, { clientX: 33 })
    fireEvent.pointerUp(slider)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets go of a drag that is cancelled without sending it', () => {
    const { slider, onChange } = track()
    fireEvent.pointerDown(slider, { clientX: 100 })
    fireEvent.pointerCancel(slider)
    expect(slider.getAttribute('aria-valuenow')).toBe('4')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('AgentsAtOnce kept at the default’s own number', () => {
  it('offers the way back to the default, and sends null for it', () => {
    const onChange = vi.fn()
    render(<AgentsAtOnce count={4} own machine={MACHINE} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the default' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('says nothing of it when the default is what is in use', () => {
    render(<AgentsAtOnce count={4} own={false} machine={MACHINE} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Use the default' })).toBeNull()
  })

  it('sends null for a release on the same number', () => {
    const { slider, onChange } = track({ own: true })
    fireEvent.pointerDown(slider, { clientX: 33 })
    fireEvent.pointerUp(slider)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })
})

describe('AgentsAtOnce, compact', () => {
  it('says one plain line whatever the number, a step for each number, and no scale', () => {
    const { container } = render(<AgentsAtOnce compact count={9} machine={MACHINE} onChange={vi.fn()} />)
    expect(screen.getByText('The rest wait their turn')).toBeTruthy()
    expect(screen.queryByText(/well past|a little more/)).toBeNull()
    expect(screen.queryByText('4 · this Mac')).toBeNull()
    expect(container.querySelectorAll('[class*="step"]:not([class*="steps"])')).toHaveLength(16)
    // The steps filled are the ones up to the number.
    expect(container.querySelectorAll('[class*="stepIn"]')).toHaveLength(9)
  })

  it('still says which number is the default, to a screen reader', () => {
    render(<AgentsAtOnce compact count={4} machine={MACHINE} onChange={vi.fn()} />)
    expect(screen.getByRole('slider', { name: 'Agents at once' }).getAttribute('aria-valuetext')).toBe('4, this Mac’s default')
  })

  it('offers the way back to the default, after its line', () => {
    const onChange = vi.fn()
    render(<AgentsAtOnce compact count={7} machine={MACHINE} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use the default' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })
})

describe('AgentsAtOnce scale', () => {
  it.each([
    [1, 16],
    [16, 1],
  ])('names the default at an end of the scale once, not that end’s number too (%i)', (count) => {
    render(<AgentsAtOnce count={count} machine={{ count, memory: 8, cores: 8 }} onChange={vi.fn()} />)
    expect(screen.getAllByText(`${count} · this Mac`)).toHaveLength(1)
    // Only the big number shows it; the scale's end is left empty.
    expect(screen.getAllByText(String(count), { selector: 'span' })).toHaveLength(1)
  })
})

describe('AgentsAtOnce unchangeable', () => {
  it('takes no focus, key or press, and offers no reset, where the machine it is about takes no change from here', () => {
    const { slider, onChange } = track({ count: 6, own: true, disabled: true })
    expect(slider.getAttribute('aria-disabled')).toBe('true')
    expect(slider.hasAttribute('tabindex')).toBe(false)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.pointerDown(slider, { clientX: 100 })
    fireEvent.pointerUp(slider)
    expect(slider.getAttribute('aria-valuenow')).toBe('6')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /default/i })).toBeNull()
  })
})

describe('TaskFolders where only the person removes them', () => {
  it('lists held folders with nothing to press, and shows only when they go where they are not listed', async () => {
    const { TaskFolders } = await import('../src/setup/TaskFolders/TaskFolders')
    const held = [{ id: 't1', title: 'Fix the login', kind: 'done' as const, when: '2d', bytes: 10, why: 'uncommitted' as const, count: 2 }]
    const goes = [{ id: 't2', title: 'Old change', kind: 'merged' as const, when: '5d', bytes: 20 }]
    const { unmount } = render(
      <TaskFolders wait="smart" onWait={vi.fn()} disks={[{ id: 'd', folder: '~/Althar', total: 100, used: 50 }]} goes={goes} held={held} />,
    )
    expect(screen.queryByRole('button', { name: 'Clean up' })).toBeNull()
    unmount()
    render(<TaskFolders wait="week" onWait={vi.fn()} disks={[]} goes={[]} held={[]} listed={false} />)
    expect(screen.queryByText(/No finished tasks’ folders yet/)).toBeNull()
    expect(screen.getByText('Remove finished tasks’ folders')).toBeTruthy()
  })
})
