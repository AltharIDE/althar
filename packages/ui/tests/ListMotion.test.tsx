import { fireEvent, render, screen } from '@testing-library/react'
import { Activity, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ListMotion } from '../src/lib/ListMotion'
import { MOTION } from '../src/lib/motion'

/*
 * jsdom lays nothing out and animates nothing. Here each item stands where
 * its place in its list puts it (lists side by side, rows 50 px apart), and
 * `animate` records what it was asked, finishing or cancelling on demand.
 */

interface Played {
  readonly el: Element
  readonly keyframes: Keyframe[]
  readonly timing: KeyframeAnimationOptions
  readonly animation: Animation
  /** Called when the animation is cancelled. */
  readonly cancel: () => void
  finish(): void
}

let played: Played[] = []
const live = new Map<Element, Animation[]>()

function stubAnimations() {
  Element.prototype.animate = function animate(
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    timing?: number | KeyframeAnimationOptions,
  ) {
    const listeners: Record<string, Array<() => void>> = {}
    const fire = (type: string) => {
      live.set(
        this,
        (live.get(this) ?? []).filter((one) => one !== animation),
      )
      for (const one of listeners[type] ?? []) one()
    }
    // As in a browser, the cancel event comes later.
    const cancel = vi.fn(() => queueMicrotask(() => fire('cancel')))
    const animation = {
      id: '',
      cancel,
      addEventListener: (type: string, listener: () => void) => {
        ;(listeners[type] ??= []).push(listener)
      },
    } as unknown as Animation
    live.set(this, [...(live.get(this) ?? []), animation])
    played.push({
      el: this,
      keyframes: keyframes as Keyframe[],
      timing: timing as KeyframeAnimationOptions,
      animation,
      cancel,
      finish: () => fire('finish'),
    })
    return animation
  }
  Element.prototype.getAnimations = function getAnimations(this: Element) {
    return live.get(this) ?? []
  }
}

/** Where layout puts an item: its list across, its place down (the first narrower, where `narrowFirst`); a copy where it is laid; anything else, nowhere. */
const placed = (el: Element) => {
  if (el.parentElement !== null && el.parentElement === layer()) {
    const { left, top, width, height } = (el as HTMLElement).style
    return new DOMRect(Number.parseFloat(left), Number.parseFloat(top), Number.parseFloat(width), Number.parseFloat(height))
  }
  const list = el.closest('ol')
  if (list === null || !el.hasAttribute('data-move')) return new DOMRect(0, 0, 0, 0)
  const lists = [...(list.parentElement?.querySelectorAll('ol') ?? [])]
  const place = [...list.querySelectorAll('[data-move]')].indexOf(el)
  return new DOMRect(lists.indexOf(list) * 300, place * 50, narrowFirst && place === 0 ? 200 : 280, 40)
}

let narrowFirst = false
let reduced = false
let visible = true

beforeEach(() => {
  played = []
  live.clear()
  narrowFirst = false
  reduced = false
  visible = true
  stubAnimations()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    return placed(this)
  })
  Object.defineProperty(Element.prototype, 'checkVisibility', { value: () => visible, configurable: true })
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: reduced && query.includes('reduce') }) as MediaQueryList)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (Element.prototype as Partial<Element>).animate
  delete (Element.prototype as Partial<Element>).getAnimations
  delete (Element.prototype as Partial<Element>).checkVisibility
  document.body.querySelectorAll('[aria-hidden="true"]').forEach((one) => one.remove())
})

/** Lists of keys, each a list side by side. */
function Lists({ lists, enter, still = false }: { lists: ReadonlyArray<ReadonlyArray<string>>; enter?: 'rise' | 'grow'; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      <ListMotion within={ref} still={still} {...(enter === undefined ? {} : { enter })}>
        {lists.map((keys, i) => (
          <ol key={i}>
            {keys.map((key) => (
              <li key={key} data-move={key}>
                {key}
              </li>
            ))}
          </ol>
        ))}
      </ListMotion>
    </div>
  )
}

/* A line with an order of its own, as up next has, the first of the lists, beside one of the board's. */
function Line({ keys, still }: { keys: ReadonlyArray<string>; still: boolean }) {
  const ref = useRef<HTMLOListElement>(null)
  const [order, setOrder] = useState<ReadonlyArray<string> | null>(null)
  const shown = order ?? keys
  return (
    <ListMotion within={ref} still={still}>
      <ol ref={ref}>
        {shown.map((key) => (
          <li key={key} data-move={key}>
            <button type="button" onClick={() => setOrder([key, ...shown.filter((one) => one !== key)])}>
              {key}
            </button>
          </li>
        ))}
      </ol>
    </ListMotion>
  )
}

function Nested({ line, rest, still = false }: { line: ReadonlyArray<string>; rest: ReadonlyArray<string>; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      <ListMotion within={ref}>
        <Line keys={line} still={still} />
        <ol>
          {rest.map((key) => (
            <li key={key} data-move={key}>
              {key}
            </li>
          ))}
        </ol>
      </ListMotion>
    </div>
  )
}

const item = (key: string) => document.querySelector<HTMLElement>(`[data-move="${key}"]`)!
const layer = () => document.querySelector<HTMLElement>('body > [aria-hidden="true"]')
const of = (el: Element) => played.filter((one) => one.el === el)

describe('ListMotion', () => {
  it('moves nothing the first time a list is drawn', () => {
    render(<Lists lists={[['a', 'b', 'c']]} />)
    expect(played).toEqual([])
  })

  it('slides an item that changed places from where it stood, on the move spring', () => {
    const { rerender } = render(<Lists lists={[['a', 'b', 'c']]} />)
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    const c = of(item('c'))[0]!
    expect(c.keyframes).toEqual([{ translate: '0px 100px' }, { translate: '0px 0px' }])
    expect(c.timing).toEqual(MOTION.move)
    expect(of(item('a'))[0]!.keyframes[0]).toEqual({ translate: '0px -50px' })
    // The one that went furthest rides above the others while they pass.
    expect(item('c').style.zIndex).toBe('2')
    expect(item('a').style.zIndex).toBe('1')
    c.finish()
    expect(item('c').style.zIndex).toBe('')
    expect(item('c').style.position).toBe('')
  })

  it('lets a move on its way to the same place carry on, and turns one sent elsewhere from where it is', () => {
    const { rerender } = render(<Lists lists={[['a', 'b', 'c']]} />)
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    const first = of(item('c'))[0]!
    // Drawn again, nothing changed: what moves goes on.
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    expect(first.cancel).not.toHaveBeenCalled()
    expect(of(item('c'))).toHaveLength(1)
    // Sent elsewhere mid-way: it stops, puts back what it changed, and goes on from there.
    rerender(<Lists lists={[['a', 'b', 'c']]} />)
    expect(first.cancel).toHaveBeenCalled()
    expect(of(item('c'))).toHaveLength(2)
    expect(of(item('c'))[1]!.keyframes[0]).toEqual({ translate: '0px -100px' })
  })

  it('carries an item that changed lists above the page, while it waits unseen in its new place', () => {
    const { rerender } = render(<Lists lists={[['a', 'b'], ['c']]} />)
    rerender(<Lists lists={[['a'], ['b', 'c']]} />)
    const b = item('b')
    expect(b.style.visibility).toBe('hidden')
    const twin = layer()!.firstElementChild as HTMLElement
    expect(twin.textContent).toBe('b')
    expect(twin.hasAttribute('data-move')).toBe(false)
    expect(twin.style.left).toBe('300px')
    const trip = of(twin)[0]!
    expect(trip.keyframes).toEqual([{ translate: '-300px 50px' }, { translate: '0px 0px' }])
    // Where it showed when the page changed again mid-way is the copy's place, not its own.
    trip.finish()
    expect(b.style.visibility).toBe('')
    expect(twin.isConnected).toBe(false)
  })

  it('brings a new item in, rising, or growing where the list says', () => {
    const { rerender, unmount } = render(<Lists lists={[['a']]} />)
    rerender(<Lists lists={[['a', 'b']]} />)
    expect(of(item('b'))[0]!.keyframes).toEqual([
      { opacity: 0, translate: '0px 6px', scale: '0.96' },
      { opacity: 1, translate: '0px 0px', scale: '1' },
    ])
    expect(of(item('b'))[0]!.timing).toEqual(MOTION.enter)
    unmount()
    const grown = render(<Lists lists={[['a']]} enter="grow" />)
    grown.rerender(<Lists lists={[['a', 'b']]} enter="grow" />)
    expect(of(item('b'))[0]!.keyframes[0]).toEqual({ opacity: 0, scale: '0.9' })
  })

  it('fades a gone item where it stood, as its own copy, quicker than it came', () => {
    const { rerender } = render(<Lists lists={[['a', 'b']]} />)
    const b = item('b')
    rerender(<Lists lists={[['a']]} />)
    expect(b.parentElement).toBe(layer())
    expect(b.style.top).toBe('50px')
    const fade = of(b)[0]!
    expect(fade.keyframes.at(-1)).toEqual({ opacity: 0, scale: '0.96' })
    expect(fade.timing).toEqual(MOTION.exit)
    fade.finish()
    expect(b.isConnected).toBe(false)
  })

  it('fades an item gone mid-slide where it showed, its slide put away first', async () => {
    const { rerender } = render(<Lists lists={[['a', 'b', 'c']]} />)
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    const c = item('c')
    rerender(<Lists lists={[['a', 'b']]} />)
    await Promise.resolve()
    expect(c.parentElement).toBe(layer())
    // The slide's own cancel, coming after, changes nothing of the copy.
    expect(c.style.position).toBe('absolute')
    expect(c.style.zIndex).toBe('')
    expect(of(c).at(-1)!.keyframes.at(-1)).toEqual({ opacity: 0, scale: '0.96' })
  })

  it('ends a journey under way where its item is drawn again elsewhere: one copy travels on, from where the first showed', () => {
    const { rerender } = render(<Lists lists={[['a', 'b'], [], []]} />)
    rerender(<Lists lists={[['a'], ['b'], []]} />)
    const first = played.at(-1)!
    rerender(<Lists lists={[['a'], [], ['b']]} />)
    expect(first.cancel).toHaveBeenCalled()
    expect(first.el.isConnected).toBe(false)
    expect(layer()!.childElementCount).toBe(1)
    expect(of(layer()!.firstElementChild!)[0]!.keyframes[0]).toEqual({ translate: '-300px 0px' })
    expect(item('b').style.visibility).toBe('hidden')
  })

  it('puts away what it set moving when its list goes: nothing of one screen travels over the next', () => {
    const { rerender, unmount } = render(
      <Lists
        lists={[
          ['a', 'b'],
          ['c', 'd'],
        ]}
      />,
    )
    rerender(<Lists lists={[['a'], ['b', 'c']]} />)
    // b travels, d fades where it stood.
    expect(layer()!.childElementCount).toBe(2)
    unmount()
    expect(layer()!.childElementCount).toBe(0)
  })

  it('puts away what it set moving when its screen hides, and shows the item it travelled for', () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Lists lists={[['a', 'b'], ['c']]} />
      </Activity>,
    )
    rerender(
      <Activity mode="visible">
        <Lists lists={[['a'], ['b', 'c']]} />
      </Activity>,
    )
    const b = item('b')
    expect(b.style.visibility).toBe('hidden')
    rerender(
      <Activity mode="hidden">
        <Lists lists={[['a'], ['b', 'c']]} />
      </Activity>,
    )
    expect(layer()!.childElementCount).toBe(0)
    expect(b.style.visibility).toBe('')
  })

  it('leaves a list to a drag while it is still: what moved stops, and nothing moves until the drag lets go', () => {
    const { rerender } = render(<Lists lists={[['a', 'b', 'c']]} />)
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    const slide = of(item('c'))[0]!
    rerender(<Lists lists={[['c', 'a', 'b']]} still />)
    expect(slide.cancel).toHaveBeenCalled()
    played = []
    rerender(<Lists lists={[['a', 'c', 'b']]} still />)
    // Let go: the order it lands in is the drag's.
    rerender(<Lists lists={[['a', 'b', 'c']]} />)
    expect(played).toEqual([])
    rerender(<Lists lists={[['c', 'a', 'b']]} />)
    expect(of(item('c'))).toHaveLength(1)
  })

  it('moves a list within another, changed by its own state, once, from the outer one', () => {
    render(<Nested line={['a', 'b', 'c']} rest={['x']} />)
    fireEvent.click(screen.getByRole('button', { name: 'c' }))
    expect(of(item('c'))).toHaveLength(1)
    expect(of(item('c'))[0]!.keyframes[0]).toEqual({ translate: '0px 100px' })
    expect(of(item('a'))[0]!.keyframes[0]).toEqual({ translate: '0px -50px' })
  })

  it('carries an item from a list within to the outer one once: no arrival, and no fading where it stood', () => {
    const { rerender } = render(<Nested line={['a', 'b', 'c']} rest={['x']} />)
    rerender(<Nested line={['a', 'b']} rest={['c', 'x']} />)
    expect(layer()!.childElementCount).toBe(1)
    expect(of(layer()!.firstElementChild!)[0]!.keyframes[0]).toEqual({ translate: '-300px 100px' })
    expect(of(item('c'))).toEqual([])
  })

  it('leaves a still list within to its drag, though the outer one moves', () => {
    const { rerender } = render(<Nested line={['a', 'b']} rest={['x']} />)
    rerender(<Nested line={['b', 'a']} rest={['y', 'x']} still />)
    expect(of(item('a'))).toEqual([])
    expect(of(item('b'))).toEqual([])
    expect(of(item('x'))[0]!.keyframes[0]).toEqual({ translate: '0px -50px' })
    expect(of(item('y'))).toHaveLength(1)
  })

  it('lets a whole list go at once: its items leave with it', () => {
    const { rerender } = render(<Lists lists={[['a'], ['b']]} />)
    const b = item('b')
    rerender(<Lists lists={[['a']]} />)
    expect(of(b)).toEqual([])
  })

  it('draws a list changed all at once afresh: more than six coming, or going, show or go at once', () => {
    const many = ['1', '2', '3', '4', '5', '6', '7']
    const { rerender } = render(<Lists lists={[['a']]} />)
    rerender(<Lists lists={[['a', ...many]]} />)
    expect(played).toEqual([])
    rerender(<Lists lists={[['a']]} />)
    expect(played).toEqual([])
  })

  it('leaves an item still where its width changed: the window or a lane did, not the order', () => {
    narrowFirst = true
    const { rerender } = render(<Lists lists={[['a', 'b', 'c']]} />)
    rerender(<Lists lists={[['c', 'b', 'a']]} />)
    expect(played).toEqual([])
  })

  it('with reduced motion, moves nothing: what comes and goes only fades', () => {
    reduced = true
    const { rerender } = render(<Lists lists={[['a', 'b', 'c'], []]} />)
    const c = item('c')
    rerender(<Lists lists={[['d', 'b', 'a'], ['x']]} />)
    expect(of(item('a'))).toEqual([])
    expect(of(item('d'))[0]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(of(c)[0]!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }])
  })

  it('moves nothing while the list does not show, nor where the browser does not animate', () => {
    visible = false
    const { rerender } = render(<Lists lists={[['a', 'b']]} />)
    rerender(<Lists lists={[['b', 'a', 'c']]} />)
    expect(played).toEqual([])
    visible = true
    delete (Element.prototype as Partial<Element>).animate
    rerender(<Lists lists={[['a', 'b']]} />)
    expect(played).toEqual([])
  })
})
