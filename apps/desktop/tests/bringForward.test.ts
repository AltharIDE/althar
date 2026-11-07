import { describe, expect, it } from 'vitest'
import { bringForward, focusedLast, openFromEdge } from '../src/main/bringForward'

describe('bringing a window forward', () => {
  it('chooses the last focused window and activates before hiding the sheet', () => {
    const calls: string[] = []
    const make = (name: string) => ({
      isMinimized: () => true,
      restore: () => calls.push(`${name}:restore`),
      showInactive: () => calls.push(`${name}:inactive`),
      show: () => calls.push(`${name}:show`),
      focus: () => calls.push(`${name}:focus`),
    })
    const first = make('first')
    const second = make('second')
    const windows = new Set([first, second])
    focusedLast(windows, first)
    openFromEdge(
      () => {
        expect(
          bringForward(
            windows,
            () => make('new'),
            () => calls.push('activate'),
            false,
          ),
        ).toEqual({ window: first, fresh: false })
      },
      () => calls.push('hide'),
    )
    expect(calls).toEqual(['first:restore', 'activate', 'first:show', 'first:focus', 'hide'])
  })

  it('opens a fresh window without activation in quiet mode and still settles', () => {
    const calls: string[] = []
    const window = {
      isMinimized: () => false,
      restore: () => calls.push('restore'),
      showInactive: () => calls.push('inactive'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    }
    openFromEdge(
      () => {
        expect(
          bringForward(
            new Set<typeof window>(),
            () => window,
            () => calls.push('activate'),
            true,
          ).fresh,
        ).toBe(true)
      },
      () => calls.push('hide'),
    )
    expect(calls).toEqual(['inactive', 'hide'])
  })
})
