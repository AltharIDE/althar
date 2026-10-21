import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from '../src/primitives/ResizeHandle/ResizeHandle'

/* A column whose width the handle drives, kept as the app keeps it. */
function Column({ edge, onCommit, onReset }: { edge?: 'start' | 'end'; onCommit?: (width: number) => void; onReset?: () => void }) {
  const [width, setWidth] = useState(400)
  return (
    <ResizeHandle
      value={width}
      min={300}
      max={600}
      onChange={setWidth}
      label="Width of the conversation"
      {...(edge ? { edge } : {})}
      {...(onCommit ? { onCommit } : {})}
      {...(onReset ? { onReset } : {})}
    />
  )
}

const handle = () => screen.getByRole('separator', { name: 'Width of the conversation' })
const width = () => Number(handle().getAttribute('aria-valuenow'))
const pointer = (
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  clientX: number,
  more: Partial<PointerEventInit> = {},
) => fireEvent[type](handle(), { pointerId: 1, button: 0, clientX, ...more })

describe('dragging a column’s edge', () => {
  it('follows the pointer within the column’s narrowest and widest, and keeps where it is let go', () => {
    const onCommit = vi.fn()
    render(<Column onCommit={onCommit} />)
    pointer('pointerDown', 100)
    pointer('pointerMove', 150)
    expect(width()).toBe(450)
    pointer('pointerMove', 900)
    expect(width()).toBe(600)
    pointer('pointerMove', -900)
    expect(width()).toBe(300)
    expect(onCommit).not.toHaveBeenCalled()
    pointer('pointerMove', 120)
    pointer('pointerUp', 120)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(420)
    // Let go, the pointer moves it no more.
    pointer('pointerMove', 300)
    expect(width()).toBe(420)
  })

  it('widens the column the other way from its start edge', () => {
    render(<Column edge="start" />)
    pointer('pointerDown', 500)
    pointer('pointerMove', 450)
    expect(width()).toBe(450)
  })

  it('keeps nothing where the drag ends where it began, or is cancelled', () => {
    const onCommit = vi.fn()
    render(<Column onCommit={onCommit} />)
    pointer('pointerDown', 100)
    pointer('pointerMove', 140)
    pointer('pointerMove', 100)
    pointer('pointerUp', 100)
    pointer('pointerDown', 100)
    pointer('pointerCancel', 100)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('lets the pointer go when the drag ends', () => {
    render(<Column />)
    const held = new Set<number>()
    vi.spyOn(handle(), 'setPointerCapture').mockImplementation((id) => void held.add(id))
    vi.spyOn(handle(), 'hasPointerCapture').mockImplementation((id) => held.has(id))
    const release = vi.spyOn(handle(), 'releasePointerCapture').mockImplementation((id) => void held.delete(id))
    pointer('pointerDown', 100)
    expect(held.has(1)).toBe(true)
    pointer('pointerUp', 130)
    expect(release).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('stops following where the edge loses the pointer', () => {
    render(<Column />)
    pointer('pointerDown', 100)
    fireEvent.lostPointerCapture(handle(), { pointerId: 1 })
    pointer('pointerMove', 200)
    expect(width()).toBe(400)
  })

  it('takes no press but the main button’s', () => {
    render(<Column />)
    pointer('pointerDown', 100, { button: 2 })
    pointer('pointerMove', 200)
    expect(width()).toBe(400)
  })
})

describe('moving a column’s edge by key', () => {
  it('moves a step with the arrows, to the narrowest and widest with Home and End, keeping each', () => {
    const onCommit = vi.fn()
    render(<Column onCommit={onCommit} />)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(width()).toBe(416)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(width()).toBe(400)
    fireEvent.keyDown(handle(), { key: 'End' })
    expect(width()).toBe(600)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(width()).toBe(600)
    fireEvent.keyDown(handle(), { key: 'Home' })
    expect(width()).toBe(300)
    expect(onCommit.mock.calls.map(([to]) => to)).toEqual([416, 400, 600, 600, 300])
  })

  it('turns the arrows round on a start edge', () => {
    render(<Column edge="start" />)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(width()).toBe(416)
  })

  it('leaves other keys alone', () => {
    const onCommit = vi.fn()
    render(<Column onCommit={onCommit} />)
    expect(fireEvent.keyDown(handle(), { key: 'ArrowUp' })).toBe(true)
    expect(width()).toBe(400)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('puts the width back on a double click', () => {
    const onReset = vi.fn()
    render(<Column onReset={onReset} />)
    fireEvent.doubleClick(handle())
    expect(onReset).toHaveBeenCalledOnce()
  })
})
