import { act, fireEvent, render, screen } from '@testing-library/react'
import { Component, type ReactNode, useCallback, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bringItemIntoView, virtualThreadIn } from '../src/lib/virtual'
import { VirtualBlocks } from '../src/thread/Thread/VirtualBlocks'
import { ThreadNavigator } from '../src/thread/ThreadNavigator/ThreadNavigator'

/*
 * jsdom lays nothing out, so these tests lay the thread out themselves: a
 * scroller 400px tall at the window's top, whose column stacks its children
 * one under the other, each as tall as its `data-h` says, or a gap as its
 * style says, with no margins. Enough for the list to measure what it draws,
 * lay its gaps and keep the view where it was.
 */

const VIEW = 400

let scroller: HTMLElement | null = null
let observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = []

/** Where each element of the scroller's column is, from the column's top, and how tall the column is. */
const columnOf = () => {
  const tops = new Map<Element, { top: number; height: number }>()
  let y = 0
  const lay = (el: Element) => {
    const own = (el as HTMLElement).dataset?.h
    const gap = (el as HTMLElement).style?.height
    const height = own !== undefined ? Number(own) : el.hasAttribute('data-virtual-gap') ? Number.parseFloat(gap) || 0 : null
    if (height !== null) {
      tops.set(el, { top: y, height })
      y += height
      return
    }
    const top = y
    for (const child of el.children) lay(child)
    tops.set(el, { top, height: y - top })
  }
  if (scroller !== null) for (const child of scroller.children) lay(child)
  return { tops, height: y }
}

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

let scrolled = 0
/** Each test's thread, whose heights are kept apart from every other test's. */
let memory = ''
let tests = 0
const scrollTo = (to: number) => {
  scrolled = Math.max(0, Math.min(to, columnOf().height - VIEW))
}

beforeEach(() => {
  scrolled = 0
  memory = `thread-${++tests}`
  observers = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> }
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: new Set() }
        observers.push(this.entry)
      }
      observe(target: Element) {
        this.entry.targets.add(target)
      }
      unobserve(target: Element) {
        this.entry.targets.delete(target)
      }
      disconnect() {
        this.entry.targets.clear()
      }
    },
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === scroller) return rect(0, VIEW)
    const at = columnOf().tops.get(this)
    return at === undefined ? rect(0, 0) : rect(at.top - scrolled, at.height)
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.isConnected ? [rect(0, 1)] : []) as unknown as DOMRectList
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this === scroller ? VIEW : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this === scroller ? columnOf().height : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this === scroller ? scrolled : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, to: number) {
    if (this === scroller) scrollTo(to)
  })
})
afterEach(() => {
  scroller = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A frame, for what waits for one, and what React does after it. */
const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

/** Scrolls the person's way: the scroller moves, then says so. */
const scrollBy = async (by: number) => {
  scrollTo(scrolled + by)
  act(() => {
    fireEvent.scroll(scroller!)
  })
  await frame()
  await frame()
}

/** What any element observed for its size hears, as if each had changed. */
const resized = () =>
  act(() => {
    for (const { callback, targets } of observers)
      if (targets.size > 0)
        callback(
          [...targets].map((target) => ({ target }) as ResizeObserverEntry),
          {} as ResizeObserver,
        )
  })

interface Block {
  readonly id: string
  readonly h: number
  readonly before?: number
  readonly rhythm?: string
}

const blocks = (from: number, to: number, h = 100): Block[] => Array.from({ length: to - from }, (_, k) => ({ id: `item-${from + k}`, h }))

function Column({ list, follow = true, navigator = false }: { list: ReadonlyArray<Block>; follow?: boolean; navigator?: boolean }) {
  const box = useRef<HTMLDivElement | null>(null)
  // One function for the life of the column, so a rerender doesn't let go of the scroller and take it again.
  const attach = useCallback((el: HTMLDivElement | null) => {
    scroller = el
    box.current = el
  }, [])
  return (
    <>
      <div ref={attach} style={{ overflowY: 'auto' }}>
        <section>
          <div data-h="0">Above</div>
          <VirtualBlocks
            count={list.length}
            keyOf={(i) => list[i]!.id}
            render={(i) => (
              <>
                {list[i]!.before === undefined ? null : <div data-h={list[i]!.before} />}
                <div data-h={list[i]!.h} data-rhythm={list[i]!.rhythm} data-item={list[i]!.id}>
                  <button type="button">{`Block ${list[i]!.id}`}</button>
                </div>
              </>
            )}
            holds={(i, itemId) => list[i]!.id === itemId}
            stopOf={(i) => (i % 2 === 0 ? { prompt: `Asked ${list[i]!.id}`, reply: '' } : null)}
            {...(follow ? { memory } : {})}
          />
        </section>
      </div>
      {navigator && <ThreadNavigator scroll={box} />}
    </>
  )
}

const drawn = () => screen.queryAllByRole('button').map((button) => button.textContent)
const shows = (id: string) => screen.queryByText(`Block ${id}`) !== null
const topOf = (id: string) => screen.getByText(`Block ${id}`).parentElement!.getBoundingClientRect().top

describe('a thread drawn only near the view', () => {
  it('draws a short thread whole', async () => {
    render(<Column list={blocks(0, 3)} />)
    await frame()
    expect(drawn()).toEqual(['Block item-0', 'Block item-1', 'Block item-2'])
  })

  it('opens a long thread at its bottom, drawing only what is near it, with the rest a gap as tall', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    expect(shows('item-299')).toBe(true)
    expect(shows('item-0')).toBe(false)
    expect(drawn().length).toBeLessThan(40)
    // The column is as tall as every block would be: 300 of 100px.
    expect(columnOf().height).toBe(300 * 100)
    expect(scrolled).toBe(300 * 100 - VIEW)
  })

  it('draws what scrolls into view, and lets go of what scrolls far out of it', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    await scrollBy(-scrolled)
    expect(shows('item-0')).toBe(true)
    expect(shows('item-299')).toBe(false)
    expect(topOf('item-0')).toBe(0)
    await scrollBy(15_000)
    expect(shows('item-150')).toBe(true)
    expect(topOf('item-150')).toBe(0)
  })

  it('follows the bottom as blocks arrive, until the person scrolls up from it', async () => {
    const { rerender } = render(<Column list={blocks(0, 300)} />)
    await frame()
    rerender(<Column list={blocks(0, 301)} />)
    await frame()
    expect(shows('item-300')).toBe(true)
    expect(scrolled).toBe(301 * 100 - VIEW)
    await scrollBy(-1000)
    const was = topOf('item-290')
    rerender(<Column list={blocks(0, 302)} />)
    await frame()
    expect(topOf('item-290')).toBe(was)
    expect(scrolled).toBe(302 * 100 - VIEW - 100 - 1000)
  })

  it('following the bottom, keeps what is in view where it was as the commit ends when a block above it grows', async () => {
    // Where the last block stands as each commit ends, as what moves a message in place (ListMotion) reads it, around the list.
    const read: number[] = []
    class Reads extends Component<{ children: ReactNode }> {
      override componentDidUpdate() {
        read.push(topOf('item-299'))
      }
      override render() {
        return this.props.children
      }
    }
    const list = blocks(0, 300)
    const { rerender } = render(
      <Reads>
        <Column list={list} />
      </Reads>,
    )
    await frame()
    const was = topOf('item-299')
    const above = list.findIndex((one) => shows(one.id))
    expect(topOf(list[above]!.id)).toBeLessThan(0)
    // A block drawn above the view grows as the thread is drawn again: a task's card with a new line under its title.
    rerender(
      <Reads>
        <Column list={list.map((one, i) => (i === above ? { ...one, h: 140 } : one))} />
      </Reads>,
    )
    expect(read).toEqual([was])
    await frame()
    expect(topOf('item-299')).toBe(was)
    expect(scrolled).toBe(columnOf().height - VIEW)
  })

  it('keeps the visible part of a block still as an item above it grows within the same block', async () => {
    const list = blocks(0, 300)
    list[294] = { ...list[294]!, before: 60 }
    const { rerender } = render(<Column list={list} />)
    await frame()
    await scrollBy(topOf('item-294'))
    expect(topOf('item-294')).toBe(0)

    const grown = list.map((block, index) => (index === 294 ? { ...block, before: 110 } : block))
    rerender(<Column list={grown} />)
    expect(topOf('item-294')).toBe(0)
    await frame()
    expect(topOf('item-294')).toBe(0)
  })

  it('leaves the bottom a little at a time, as a trackpad scrolls, without being pulled back to it', async () => {
    const { rerender } = render(<Column list={blocks(0, 300)} />)
    await frame()
    const bottom = scrolled
    for (let i = 0; i < 30; i++) await scrollBy(-40)
    expect(scrolled).toBe(bottom - 1200)
    // A nudge up from the bottom stays as it was as the thread grows below it.
    await scrollBy(1200)
    await scrollBy(-40)
    rerender(<Column list={blocks(0, 301)} />)
    await frame()
    expect(scrolled).toBe(301 * 100 - VIEW - 40)
  })

  it('lets a scroll up from the bottom stand when a block grows in the same frame, before its event comes', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    for (let step = 1; step <= 5; step++) {
      // The scroller moves; a block far above the view grows, and its size is heard before the scroll is.
      const to = scrolled - 40
      scrollTo(to)
      const grown = document.querySelector<HTMLElement>('[data-item]')!
      grown.dataset.h = String(Number(grown.dataset.h) + 10)
      resized()
      // Within the slack it keeps the person's distance from the bottom; past it, it has left the bottom where they put it.
      if (40 * step < 90) expect(columnOf().height - VIEW - scrolled).toBe(40 * step)
      else expect(scrolled).toBe(to)
      act(() => {
        fireEvent.scroll(scroller!)
      })
      await frame()
    }
  })

  it('keeps the block in view where it was as earlier blocks come before it', async () => {
    const { rerender } = render(<Column list={blocks(100, 300)} />)
    await frame()
    await scrollBy(-scrolled + 500)
    const was = topOf('item-105')
    rerender(<Column list={blocks(0, 300)} />)
    await frame()
    expect(topOf('item-105')).toBe(was)
    expect(shows('item-0')).toBe(false)
  })

  it('keeps the block in view where it was as a block above it grows', async () => {
    const list = blocks(0, 300)
    const { rerender } = render(<Column list={list} />)
    await frame()
    await scrollBy(-scrolled + 15_000)
    const was = topOf('item-150')
    const grown = list.map((one) => (one.id === 'item-148' ? { ...one, h: 400 } : one))
    rerender(<Column list={grown} />)
    resized()
    expect(topOf('item-150')).toBe(was)
  })

  it('brings a block it holds into view, for a search or a link to an item in it', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    expect(shows('item-12')).toBe(false)
    act(() => {
      expect(bringItemIntoView('item-12')).toBe(true)
    })
    await frame()
    expect(shows('item-12')).toBe(true)
    expect(topOf('item-12')).toBeCloseTo(VIEW / 3)
    expect(bringItemIntoView('nowhere')).toBe(false)
  })

  it('keeps what has focus drawn, wherever the view goes', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    const focused = screen.getByText('Block item-299')
    act(() => focused.focus())
    await scrollBy(-scrolled)
    expect(shows('item-0')).toBe(true)
    expect(shows('item-299')).toBe(true)
    expect(document.activeElement).toBe(focused)
    act(() => focused.blur())
    await scrollBy(1)
    expect(shows('item-299')).toBe(false)
  })

  it('keeps what the person selected drawn, from where it starts to where it ends', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    const range = document.createRange()
    range.setStart(screen.getByText('Block item-292').firstChild!, 0)
    range.setEnd(screen.getByText('Block item-298').firstChild!, 3)
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await scrollBy(-scrolled)
    for (const id of ['item-0', 'item-292', 'item-295', 'item-298']) expect(shows(id)).toBe(true)
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    await scrollBy(1)
    expect(shows('item-295')).toBe(false)
  })

  it('draws every block a selection spans as it is copied, from before the thread to after it', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    expect(shows('item-0')).toBe(false)
    expect(shows('item-150')).toBe(false)
    // Select All: from the page's start to its end, anchored outside any block.
    const range = document.createRange()
    range.selectNodeContents(document.body)
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(shows('item-0')).toBe(false)
    act(() => {
      document.dispatchEvent(new Event('copy'))
    })
    // Drawn by the time the browser reads the page to copy it, all 300 of them, in order.
    expect(drawn().filter((text) => text?.startsWith('Block '))).toEqual(blocks(0, 300).map((one) => `Block ${one.id}`))
    // And kept while the selection stands, however far the view goes.
    await scrollBy(-scrolled)
    expect(shows('item-299')).toBe(true)
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    await scrollBy(1)
    expect(shows('item-299')).toBe(false)
  })

  it('draws only the blocks between where a selection starts and the thread’s end when it runs past it', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    await scrollBy(-scrolled)
    await scrollBy(10_000)
    const range = document.createRange()
    range.setStart(screen.getByText(`Block ${drawn()[0]!.slice(6)}`).firstChild!, 0)
    range.setEndAfter(scroller!.parentElement!)
    act(() => {
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
    })
    const start = Number(drawn()[0]!.slice(11))
    act(() => {
      document.dispatchEvent(new Event('copy'))
    })
    const now = drawn().filter((text) => text?.startsWith('Block '))
    expect(now).toEqual(blocks(start, 300).map((one) => `Block ${one.id}`))
    expect(shows('item-0')).toBe(false)
  })

  it('spaces a gap as the block it stands for last, so what follows it is spaced as it would be', async () => {
    const list = blocks(0, 300).map((one, i) => ({ ...one, rhythm: i % 3 === 0 ? 'step' : 'line' }))
    render(<Column list={list} />)
    await frame()
    // Down from the top a little at a time, so the blocks above the window were drawn and measured on the way.
    await scrollBy(-scrolled)
    for (let i = 0; i < 10; i++) await scrollBy(300)
    const first = screen.getAllByRole('button')[0]!.parentElement!
    const gap = first.previousElementSibling as HTMLElement
    expect(gap).toHaveAttribute('data-virtual-gap')
    const before = list[list.findIndex((one) => one.id === first.dataset.item) - 1]!
    expect(gap.dataset.rhythm).toBe(before.rhythm)
  })

  it('tells the navigator every message it holds, drawn or not, and where each is', async () => {
    render(<Column list={blocks(0, 300)} />)
    await frame()
    const thread = virtualThreadIn(scroller)!
    expect(thread.stops()).toHaveLength(150)
    expect(thread.stops()[0]).toEqual({ key: 'item-0', prompt: 'Asked item-0', reply: '' })
    expect(thread.topOf('item-10')).toBe(1000)
    expect(thread.topOf('item-299')).toBe(29_900)
    expect(thread.topOf('nowhere')).toBeNull()
    act(() => thread.bring('item-10', 30))
    await frame()
    expect(topOf('item-10')).toBe(30)
    const heard = vi.fn()
    const stop = thread.subscribe(heard)
    await scrollBy(1)
    stop()
  })

  it('remembers its blocks’ heights for the thread opened again', async () => {
    const tall = blocks(0, 300, 250)
    const first = render(<Column list={tall} />)
    await frame()
    await scrollBy(-scrolled)
    first.unmount()
    render(<Column list={tall} />)
    await frame()
    // Blocks measured before are laid out at their heights, the rest as the measured ones suggest.
    expect(columnOf().height).toBe(300 * 250)
  })
})

describe('a navigator over a thread drawn only near the view', () => {
  it('has a stop for every message, drawn or not, and its stop draws one far off', async () => {
    render(<Column list={blocks(0, 300)} navigator />)
    await frame()
    await frame()
    const navigation = await screen.findByRole('navigation', { name: 'Conversation navigation' })
    const stops = navigation.querySelectorAll('button')
    expect(stops).toHaveLength(150)
    // The message at the top of the view, as the navigator always marks it: item-296 of the last four in view.
    expect(stops[148]).toHaveAttribute('aria-current', 'location')
    expect(shows('item-100')).toBe(false)
    act(() => {
      stops[50]!.click()
    })
    await frame()
    await frame()
    expect(shows('item-100')).toBe(true)
    expect(topOf('item-100')).toBe(30)
    expect(navigation.querySelectorAll('button')[50]).toHaveAttribute('aria-current', 'location')
  })

  it('gains the stop of a message that comes below the drawn part, without the view moving', async () => {
    const { rerender } = render(<Column list={blocks(0, 300)} navigator />)
    await frame()
    await frame()
    const navigation = await screen.findByRole('navigation', { name: 'Conversation navigation' })
    expect(navigation.querySelectorAll('button')).toHaveLength(150)
    // Up from the bottom until the window has an end of its own, a message the thread holds below it.
    await scrollBy(-scrolled)
    await scrollBy(10_000)
    expect(shows('item-299')).toBe(false)
    const at = scrolled
    // An even-numbered message, which is one the person said: its stop is new, with nothing drawn changing.
    rerender(<Column list={blocks(0, 301)} navigator />)
    await frame()
    await frame()
    expect(shows('item-300')).toBe(false)
    expect(scrolled).toBe(at)
    expect(navigation.querySelectorAll('button')).toHaveLength(151)
  })
})
