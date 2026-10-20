import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Popover } from '../src/primitives/Popover/Popover'

/* How long a pointer rests before it opens, and may be away before it closes. */
const OPEN = 160
const CLOSE = 240

const popover = (props: Partial<Parameters<typeof Popover>[0]> = {}) =>
  render(
    <>
      <input aria-label="Message" />
      <Popover label="What the lead is listening to" trigger={<button type="button">Listening</button>} hover {...props}>
        <button type="button">Stop listening</button>
      </Popover>
    </>,
  )

const trigger = () => screen.getByRole('button', { name: 'Listening' })
const panel = () => screen.queryByRole('dialog', { name: 'What the lead is listening to' })
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const point = (target: HTMLElement, pointerType = 'mouse') => fireEvent.pointerEnter(target, { pointerType })
const leave = (target: HTMLElement, pointerType = 'mouse') => fireEvent.pointerLeave(target, { pointerType })

beforeEach(() => void vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('a popover that opens on pointing', () => {
  it('opens once the pointer rests on its button, leaving the focus where it was, and closes once it has gone', () => {
    const onOpenChange = vi.fn()
    popover({ onOpenChange })
    screen.getByRole('textbox', { name: 'Message' }).focus()
    point(trigger())
    wait(OPEN - 1)
    expect(panel()).toBeNull()
    wait(1)
    expect(panel()).not.toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    leave(trigger())
    wait(CLOSE - 1)
    expect(panel()).not.toBeNull()
    wait(1)
    expect(panel()).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('doesn’t open where the pointer passes over its button without resting', () => {
    popover()
    point(trigger())
    wait(OPEN / 2)
    leave(trigger())
    wait(OPEN + CLOSE)
    expect(panel()).toBeNull()
  })

  it('stays while the pointer goes from its button onto the panel, and closes once it leaves that too', () => {
    popover()
    point(trigger())
    wait(OPEN)
    leave(trigger())
    point(panel()!)
    wait(CLOSE * 2)
    expect(panel()).not.toBeNull()
    leave(panel()!)
    wait(CLOSE)
    expect(panel()).toBeNull()
  })

  it('stays once its button is pressed while it shows from pointing, though the pointer then goes', () => {
    popover()
    point(trigger())
    wait(OPEN)
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    leave(trigger())
    wait(CLOSE * 2)
    expect(panel()).not.toBeNull()
    // Pressed again, it closes as any popover.
    fireEvent.click(trigger())
    expect(panel()).toBeNull()
  })

  it('stays where it was opened by a press, though the pointer then goes', () => {
    popover()
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveFocus()
    leave(trigger())
    wait(CLOSE * 2)
    expect(panel()).not.toBeNull()
    // Pointing at it again while it shows starts nothing new.
    point(trigger())
    wait(OPEN * 2)
    expect(panel()).not.toBeNull()
  })

  it('takes no notice of a touch passing over it', () => {
    popover()
    point(trigger(), 'touch')
    wait(OPEN * 2)
    expect(panel()).toBeNull()
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    point(panel()!, 'touch')
    leave(panel()!, 'touch')
    leave(trigger(), 'touch')
    wait(CLOSE * 2)
    expect(panel()).not.toBeNull()
  })

  it('opens only on a press without being asked to open on pointing', () => {
    popover({ hover: false })
    point(trigger())
    wait(OPEN * 2)
    expect(panel()).toBeNull()
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    leave(trigger())
    wait(CLOSE * 2)
    expect(panel()).not.toBeNull()
  })

  it('opens and closes as its owner says, where the owner keeps whether it is open', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Popover label="Detail" trigger={<button type="button">Listening</button>} hover open={false} onOpenChange={onOpenChange}>
        <p>Detail</p>
      </Popover>,
    )
    point(trigger())
    wait(OPEN)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <Popover label="Detail" trigger={<button type="button">Listening</button>} hover open onOpenChange={onOpenChange}>
        <p>Detail</p>
      </Popover>,
    )
    expect(screen.getByRole('dialog', { name: 'Detail' })).toBeInTheDocument()
  })
})
