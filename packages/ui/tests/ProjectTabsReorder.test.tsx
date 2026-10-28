import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { userEvent } from 'storybook/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ProjectTab, ProjectTabs } from '../src/chrome/ProjectTabs/ProjectTabs'
import { MARKED } from '../src/fixtures/marks'

/*
 * Moving a project's tab along the bar, by pointer and by key. jsdom lays
 * nothing out, so the bar is given a layout here: each tab 98 pixels wide
 * with 2 between them, in a list that shows `shown` pixels of them and
 * scrolls the rest.
 */
const WIDTH = 98
const GAP = 2
const STEP = WIDTH + GAP

const tab = (project: (typeof MARKED)[number], yours = 0): ProjectTab => ({
  id: project.id,
  name: project.name,
  seed: project.id,
  ink: project.ink,
  running: false,
  yours,
})
const FOUR = MARKED.map((project) => tab(project))
const extra = (id: string, name: string, fixed = false): ProjectTab => ({ ...FOUR[0]!, id, seed: id, name, ...(fixed ? { fixed } : {}) })

/* The bar with the order kept as the app keeps it: `id` before `beforeId`, or at the end. */
function Bar({
  initial,
  onReorder,
  onSelect,
}: {
  initial: readonly ProjectTab[]
  onReorder?: (id: string, beforeId: string | null) => void
  onSelect?: (id: string | null) => void
}) {
  const [tabs, setTabs] = useState(initial)
  return (
    <ProjectTabs
      tabs={tabs}
      current="meridian"
      lights="none"
      onSelect={onSelect ?? vi.fn()}
      onClose={vi.fn()}
      onReorder={(id, beforeId) => {
        onReorder?.(id, beforeId)
        const moved = tabs.find((one) => one.id === id)!
        const rest = tabs.filter((one) => one.id !== id)
        const at = rest.findIndex((one) => one.id === beforeId)
        setTabs(at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)])
      }}
    />
  )
}

const nav = () => within(screen.getByRole('navigation', { name: 'Projects' }))
const list = () => screen.getByRole('navigation', { name: 'Projects' }).querySelectorAll('ul')[1]!
const button = (name: string) => nav().getByRole('button', { name: new RegExp(`^${name}`) })
const order = () => Array.from(list().children).map((item) => item.querySelector('[class*="name"]')?.textContent)
const shift = (name: string) => button(name).closest('li')!.style.transform

const rect = (left: number, width: number) =>
  ({ left, right: left + width, width, top: 0, bottom: 30, height: 30, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

/* Lays out the tabs' list: `shown` pixels wide, scrolled as far as it is, each tab where a drag has it. */
const layOut = (shown: number) => {
  const element = list()
  let scroll = 0
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => shown })
  Object.defineProperty(element, 'scrollWidth', { configurable: true, get: () => element.children.length * STEP - GAP })
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => scroll,
    set: (to: number) => void (scroll = Math.max(0, Math.min(to, element.scrollWidth - shown))),
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === element) return rect(0, shown)
    if (this.parentElement === element) {
      const by = Number.parseFloat(/translateX\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? '0')
      return rect(Array.from(element.children).indexOf(this) * STEP - scroll + by, WIDTH)
    }
    return rect(0, 0)
  })
  // Where each tab is laid out in the list, whatever moves it.
  const place = (one: HTMLElement) => (one.parentElement === element ? Array.from(element.children).indexOf(one) : -1)
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.max(0, place(this)) * STEP
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return place(this) < 0 ? 0 : WIDTH
  })
}

const pointer = (
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture',
  name: string,
  clientX: number,
  more: Partial<PointerEventInit> = {},
) => fireEvent[type](button(name), { pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerUp' ? 0 : 1, clientX, ...more })

beforeEach(() => void vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('dragging a project’s tab along the bar', () => {
  it('lifts the tab with the pointer, the others giving way, and lands it where it is let go', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270)
    // Its leading edge has passed the middles of Halyard and Tessera: they give way by a tab, Ferrous stays.
    expect(shift('Meridian')).toBe('translateX(250px)')
    expect(shift('Halyard')).toBe(`translateX(-${STEP}px)`)
    expect(shift('Tessera')).toBe(`translateX(-${STEP}px)`)
    expect(shift('Ferrous')).toBe('')
    pointer('pointerUp', 'Meridian', 270)
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('meridian', 'ferrous')
    expect(order()).toEqual(['Halyard', 'Tessera', 'Meridian', 'Ferrous'])
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
  })

  it('moves a tab back towards the start, the ones it passes giving way the other way', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Ferrous', 320)
    pointer('pointerMove', 'Ferrous', 150)
    expect(shift('Ferrous')).toBe('translateX(-170px)')
    expect(shift('Halyard')).toBe(`translateX(${STEP}px)`)
    expect(shift('Tessera')).toBe(`translateX(${STEP}px)`)
    expect(shift('Meridian')).toBe('')
    pointer('pointerUp', 'Ferrous', 150)
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('ferrous', 'halyard')
    expect(order()).toEqual(['Meridian', 'Ferrous', 'Halyard', 'Tessera'])
  })

  it('goes no further than the first place and the last, however far the pointer goes', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Tessera', 220)
    pointer('pointerMove', 'Tessera', -500)
    expect(shift('Tessera')).toBe(`translateX(-${2 * STEP}px)`)
    pointer('pointerMove', 'Tessera', 2000)
    expect(shift('Tessera')).toBe(`translateX(${STEP}px)`)
    pointer('pointerUp', 'Tessera', 2000)
    // To the end: before nothing.
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('tessera', null)
    expect(order()).toEqual(['Meridian', 'Halyard', 'Ferrous', 'Tessera'])
  })

  it('lets go where it was taken from without moving anything', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Halyard', 120)
    pointer('pointerMove', 'Halyard', 140)
    expect(shift('Halyard')).toBe('translateX(20px)')
    pointer('pointerUp', 'Halyard', 140)
    expect(onReorder).not.toHaveBeenCalled()
    expect(order()).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
  })

  it('takes a press that doesn’t move as a click, which switches to the tab', () => {
    const onSelect = vi.fn()
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} onSelect={onSelect} />)
    layOut(600)
    pointer('pointerDown', 'Tessera', 220)
    // Less than a few pixels: still a press.
    pointer('pointerMove', 'Tessera', 222)
    expect(shift('Tessera')).toBe('')
    pointer('pointerUp', 'Tessera', 222)
    fireEvent.click(button('Tessera'))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('tessera')
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('doesn’t take the click that ends a drag as a switch, though the next one is', () => {
    const onSelect = vi.fn()
    render(<Bar initial={FOUR} onSelect={onSelect} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270)
    pointer('pointerUp', 'Meridian', 270)
    fireEvent.click(button('Meridian'))
    expect(onSelect).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(0))
    fireEvent.click(button('Meridian'))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('meridian')
  })

  it('puts the tab back on Escape, and the release after it moves nothing', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270)
    // Another key does nothing to the drag.
    fireEvent.keyDown(button('Meridian'), { key: 'Enter' })
    expect(shift('Meridian')).toBe('translateX(250px)')
    fireEvent.keyDown(button('Meridian'), { key: 'Escape' })
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
    pointer('pointerUp', 'Meridian', 270)
    expect(onReorder).not.toHaveBeenCalled()
    expect(order()).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
  })

  it.each([
    ['the press is cancelled', 'pointerCancel'],
    ['the tab loses the pointer', 'lostPointerCapture'],
  ] as const)('puts the tab back where %s', (_, type) => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270)
    pointer(type, 'Meridian', 270)
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
    expect(onReorder).not.toHaveBeenCalled()
    expect(order()).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
  })

  it('takes a move with no button down as hover after a missed release, moving nothing', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270, { buttons: 0 })
    pointer('pointerMove', 'Meridian', 300, { buttons: 0 })
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
    pointer('pointerUp', 'Meridian', 300)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('follows only the pointer that pressed', () => {
    render(<Bar initial={FOUR} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270, { pointerId: 2 })
    expect(shift('Meridian')).toBe('')
    pointer('pointerUp', 'Meridian', 270, { pointerId: 2 })
    pointer('pointerCancel', 'Meridian', 270, { pointerId: 2 })
    pointer('lostPointerCapture', 'Meridian', 270, { pointerId: 2 })
    pointer('pointerMove', 'Meridian', 270)
    expect(shift('Meridian')).toBe('translateX(250px)')
  })

  it.each([
    ['a press with another button', { button: 2 }],
    ['a press by a second finger', { isPrimary: false }],
  ])('doesn’t drag on %s', (_, more) => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20, more)
    pointer('pointerMove', 'Meridian', 270)
    pointer('pointerUp', 'Meridian', 270)
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('keeps every tab where it is without a way to reorder them', () => {
    render(<ProjectTabs tabs={FOUR} current="meridian" lights="none" onSelect={vi.fn()} onClose={vi.fn()} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 270)
    expect(list().querySelectorAll('li[style*="transform"]')).toHaveLength(0)
    button('Meridian').focus()
    fireEvent.keyDown(button('Meridian'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(order()).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous'])
  })

  it('keeps a project still being made at the end: it doesn’t move, and nothing lands after it', () => {
    const onReorder = vi.fn()
    render(<Bar initial={[...FOUR, extra('draft', 'Draft', true)]} onReorder={onReorder} />)
    layOut(600)
    pointer('pointerDown', 'Draft', 420)
    pointer('pointerMove', 'Draft', 100)
    expect(shift('Draft')).toBe('')
    pointer('pointerUp', 'Draft', 100)
    // Ferrous, dragged past the new one, stops at the last place before it.
    pointer('pointerDown', 'Ferrous', 320)
    pointer('pointerMove', 'Ferrous', 900)
    expect(shift('Ferrous')).toBe('')
    expect(shift('Draft')).toBe('')
    pointer('pointerUp', 'Ferrous', 900)
    pointer('pointerDown', 'Tessera', 220)
    pointer('pointerMove', 'Tessera', 900)
    expect(shift('Tessera')).toBe(`translateX(${STEP}px)`)
    pointer('pointerUp', 'Tessera', 900)
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('tessera', 'draft')
    expect(order()).toEqual(['Meridian', 'Halyard', 'Ferrous', 'Tessera', 'Draft'])
  })

  it('scrolls the tabs while the pointer is held at an edge, the tab going with it', () => {
    const six = [...FOUR, extra('ledger', 'Ledger'), extra('infra', 'Infra')]
    render(<Bar initial={six} />)
    layOut(300)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 290)
    expect(shift('Meridian')).toBe('translateX(270px)')
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollLeft).toBe(10)
    expect(shift('Meridian')).toBe('translateX(280px)')
    act(() => void vi.advanceTimersToNextFrame())
    expect(shift('Meridian')).toBe('translateX(290px)')
    // Away from the edge, it stops.
    pointer('pointerMove', 'Meridian', 150)
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollLeft).toBe(20)
    // At the start's edge, back the other way, as far as the start.
    pointer('pointerMove', 'Meridian', 10)
    act(() => void vi.advanceTimersToNextFrame())
    act(() => void vi.advanceTimersToNextFrame())
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollLeft).toBe(0)
    expect(shift('Meridian')).toBe('')
    pointer('pointerUp', 'Meridian', 10)
    // Let go, it scrolls no more.
    pointer('pointerMove', 'Meridian', 290, { buttons: 0 })
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollLeft).toBe(0)
  })
})

describe('dragging a tab where the browser animates', () => {
  // The bar's list moves as a whole (ListMotion) once the browser animates: a drag is its own.
  let animated: Element[]
  beforeEach(() => {
    animated = []
    Element.prototype.animate = function animate(this: Element) {
      animated.push(this)
      return { cancel: vi.fn(), addEventListener: vi.fn() } as unknown as Animation
    }
  })
  afterEach(() => void delete (Element.prototype as Partial<Element>).animate)

  it('lets the tab follow the pointer, and lands it, with nothing of the list’s motion pulling it back', () => {
    render(<Bar initial={FOUR} />)
    layOut(600)
    pointer('pointerDown', 'Meridian', 20)
    pointer('pointerMove', 'Meridian', 100)
    pointer('pointerMove', 'Meridian', 180)
    pointer('pointerMove', 'Meridian', 270)
    expect(shift('Meridian')).toBe('translateX(250px)')
    pointer('pointerUp', 'Meridian', 270)
    expect(order()).toEqual(['Halyard', 'Tessera', 'Meridian', 'Ferrous'])
    expect(animated).toEqual([])
  })
})

describe('moving a project’s tab by key', () => {
  const key = (name: string, key: string, more: Partial<KeyboardEventInit> = {}) =>
    fireEvent.keyDown(button(name), { key, altKey: true, shiftKey: true, ...more })

  it('moves the focused tab one place either way with ⌥⇧← and ⌥⇧→', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    expect(key('Halyard', 'ArrowRight')).toBe(false)
    expect(onReorder).toHaveBeenLastCalledWith('halyard', 'ferrous')
    expect(order()).toEqual(['Meridian', 'Tessera', 'Halyard', 'Ferrous'])
    key('Halyard', 'ArrowRight')
    expect(onReorder).toHaveBeenLastCalledWith('halyard', null)
    expect(order()).toEqual(['Meridian', 'Tessera', 'Ferrous', 'Halyard'])
    key('Halyard', 'ArrowLeft')
    expect(onReorder).toHaveBeenLastCalledWith('halyard', 'ferrous')
    expect(order()).toEqual(['Meridian', 'Tessera', 'Halyard', 'Ferrous'])
  })

  it('goes no further than the first place and the last, nor past a project still being made', () => {
    const onReorder = vi.fn()
    render(<Bar initial={[...FOUR, extra('draft', 'Draft', true)]} onReorder={onReorder} />)
    key('Meridian', 'ArrowLeft')
    key('Ferrous', 'ArrowRight')
    key('Draft', 'ArrowLeft')
    expect(onReorder).not.toHaveBeenCalled()
    expect(order()).toEqual(['Meridian', 'Halyard', 'Tessera', 'Ferrous', 'Draft'])
  })

  it.each([
    ['without ⇧', { shiftKey: false }],
    ['without ⌥', { altKey: false }],
    ['with ⌘ too', { metaKey: true }],
    ['with ⌃ too', { ctrlKey: true }],
  ])('leaves the arrows alone %s', (_, more) => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    expect(key('Halyard', 'ArrowRight', more)).toBe(true)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('leaves other keys alone', () => {
    const onReorder = vi.fn()
    render(<Bar initial={FOUR} onReorder={onReorder} />)
    expect(key('Halyard', 'ArrowDown')).toBe(true)
    expect(onReorder).not.toHaveBeenCalled()
  })
})

describe('more tabs open than fit', () => {
  const MANY = [...FOUR.map((one, i) => (i === 1 ? { ...one, yours: 2 } : one)), extra('ledger', 'Ledger'), extra('infra', 'Infra')]

  it('keeps the tab with the window in sight by where it is laid out, not where it shows while it slides', () => {
    const tabs = (current: string) => <ProjectTabs tabs={MANY} current={current} lights="none" onSelect={vi.fn()} onClose={vi.fn()} />
    const { rerender } = render(tabs('meridian'))
    layOut(250)
    const element = list()
    rerender(tabs('infra'))
    expect(element.scrollLeft).toBe(5 * STEP + WIDTH - 250)
    rerender(tabs('meridian'))
    expect(element.scrollLeft).toBe(0)
  })

  it('leaves tabs that all fit unscrolled, though one sliding into its place shows past the end', () => {
    const tabs = (current: string) => <ProjectTabs tabs={MANY} current={current} lights="none" onSelect={vi.fn()} onClose={vi.fn()} />
    const { rerender } = render(tabs('meridian'))
    layOut(600)
    const element = list()
    // The last tab slides in from 100 px further on; the bar stops clear of its fading edge where it can.
    Object.defineProperty(element, 'scrollWidth', { configurable: true, get: () => 700 })
    const style = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((one, pseudo) =>
      one === element ? ({ scrollPaddingInlineStart: '32px' } as CSSStyleDeclaration) : style(one, pseudo),
    )
    rerender(tabs('infra'))
    expect(element.scrollLeft).toBe(0)
    expect(screen.queryByRole('button', { name: 'All open projects' })).toBeNull()
  })

  it('offers every open project in a menu once they scroll, with what waits on you in each', async () => {
    const onSelect = vi.fn()
    vi.useRealTimers()
    render(<ProjectTabs tabs={MANY} current="meridian" lights="none" onSelect={onSelect} onClose={vi.fn()} />)
    expect(nav().queryByRole('button', { name: 'All open projects' })).toBeNull()
    layOut(300)
    fireEvent.scroll(list())
    // At the start, more after it.
    expect(list().className).toMatch(/moreAfter/)
    expect(list().className).not.toMatch(/moreBefore/)
    list().scrollLeft = 300
    fireEvent.scroll(list())
    expect(list().className).toMatch(/moreBefore/)
    expect(list().className).not.toMatch(/moreAfter/)
    await userEvent.click(nav().getByRole('button', { name: 'All open projects' }))
    const menu = within(await screen.findByRole('menu', { name: 'All open projects' }))
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Meridian',
      'Halyard, 2 calls wait on you',
      'Tessera',
      'Ferrous',
      'Ledger',
      'Infra',
    ])
    await userEvent.click(menu.getByRole('menuitem', { name: /^Ledger/ }))
    expect(onSelect).toHaveBeenCalledWith('ledger')
  })

  it('moves them across with a wheel that turns up and down', () => {
    render(<ProjectTabs tabs={MANY} current="meridian" lights="none" onSelect={vi.fn()} onClose={vi.fn()} />)
    layOut(300)
    expect(fireEvent.wheel(list(), { deltaY: 40, deltaX: 0 })).toBe(false)
    expect(list().scrollLeft).toBe(40)
    // A wheel that turns sideways scrolls them itself.
    expect(fireEvent.wheel(list(), { deltaY: 5, deltaX: 30 })).toBe(true)
    expect(list().scrollLeft).toBe(40)
  })

  it('leaves the wheel alone while every tab fits', () => {
    render(<ProjectTabs tabs={FOUR} current="meridian" lights="none" onSelect={vi.fn()} onClose={vi.fn()} />)
    layOut(600)
    expect(fireEvent.wheel(list(), { deltaY: 40, deltaX: 0 })).toBe(true)
    expect(list().scrollLeft).toBe(0)
  })
})
