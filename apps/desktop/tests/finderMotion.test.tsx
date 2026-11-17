import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import {
  arrive,
  chipOf,
  clearFlights,
  close,
  drop,
  into,
  leave,
  lift,
  measure,
  open,
  slideFrom,
  useGlide,
} from '../src/renderer/features/finder/morph'

// jsdom has no layout or Web Animations. Keep the DOM real and control the
// geometry and completion events so interruption and cleanup need no timer.
type Flight = EventTarget & { cancel: ReturnType<typeof vi.fn> }
const animations: Flight[] = []
const animate = vi.fn(function (
  this: HTMLElement,
  _frames: Keyframe[] | PropertyIndexedKeyframes | null,
  _options?: number | KeyframeAnimationOptions,
) {
  const events = new EventTarget()
  const cancel = vi.fn(() => events.dispatchEvent(new Event('cancel')))
  const flight = Object.assign(events, { cancel })
  animations.push(flight)
  return events as unknown as Animation
})
const element = (text = 'Project') => {
  const el = document.createElement('span')
  el.textContent = text
  el.style.fontSize = '14px'
  el.id = 'real-identity'
  const rect = new DOMRect(10, 20, 120, 24)
  el.getClientRects = () => [rect] as unknown as DOMRectList
  el.getBoundingClientRect = () => rect
  document.body.append(el)
  return el
}
const prepare = (reduced = false) => {
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true })
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: reduced, media: query }) as MediaQueryList)
}
afterEach(() => {
  clearFlights()
  document.body.replaceChildren()
  animations.length = 0
  animate.mockClear()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks()
})

it('does not measure absent or hidden elements and can measure the chip’s own text', () => {
  const hidden = document.createElement('span')
  expect(measure(null)).toBeNull()
  expect(measure(undefined)).toBeNull()
  expect(measure(hidden)).toBeNull()
  expect(chipOf(hidden)).toBeNull()
  expect(chipOf(null)).toBeNull()
  const el = element()
  expect(measure(el)?.font).toBe(14)
  expect(chipOf(el)?.text).toEqual(el.getBoundingClientRect())
  const text = element('Inner')
  text.dataset.chipText = ''
  el.append(text)
  expect(chipOf(el)?.text).toEqual(text.getBoundingClientRect())
})

it('keeps real text visible while decorative copies fly, interrupt, and finish', () => {
  prepare()
  const from = element('Row')
  const to = element('Chip')
  lift(measure(from), to)
  const shelf = document.querySelector('[aria-hidden="true"]')!
  expect(shelf.children.length).toBe(1)
  expect(shelf.querySelector('[id]')).toBeNull()
  expect(to.isConnected).toBe(true)
  expect(to.style.visibility).toBe('')
  const first = animations[1]!
  drop(chipOf(to), from)
  expect((first as Flight).cancel).toHaveBeenCalledOnce()
  expect(shelf.children.length).toBe(1)
  // seen, shell, pill are started in that order for each flight.
  animations[4]!.dispatchEvent(new Event('finish'))
  expect(shelf.children.length).toBe(0)
  lift(measure(from), to)
  clearFlights()
  expect(shelf.children.length).toBe(0)
  expect(from.id).toBe('real-identity')
  expect(to.id).toBe('real-identity')
})

it.each([true, false])('arrives and leaves without a destination, respecting reduced motion (%s)', (reduced) => {
  prepare(reduced)
  const el = element()
  const next = element('Following')
  arrive(el, next)
  expect(animate).toHaveBeenCalledTimes(reduced ? 1 : 2)
  const frames = animate.mock.calls[0]?.[0] as unknown as Keyframe[]
  expect(frames[0]?.transform).toBe(reduced ? 'none' : 'scale(0.86)')
  leave(chipOf(el))
  const shelf = document.querySelector('[aria-hidden="true"]')!
  expect(shelf.children.length).toBe(1)
  animations.at(-1)!.dispatchEvent(new Event('cancel'))
  expect(shelf.children.length).toBe(0)
  lift(null, el)
  drop(chipOf(el), null)
  animations.at(-1)!.dispatchEvent(new Event('finish'))
  expect(shelf.children.length).toBe(0)
  if (reduced) {
    lift(measure(next), el)
    drop(chipOf(el), next)
    animations.at(-1)!.dispatchEvent(new Event('finish'))
  }
})

it('slides following text only when it moved and opens the box with its scrim', () => {
  prepare()
  const el = element()
  slideFrom(null, 12)
  slideFrom(el, null)
  slideFrom(el, 0)
  expect(animate).not.toHaveBeenCalled()
  slideFrom(el, 100)
  expect(animate).toHaveBeenCalledOnce()
  open(el, element('Scrim'))
  expect(animate).toHaveBeenCalledTimes(3)
  open(null, null)
  arrive(null)
  drop(null, el)
  leave(null)
  lift(null, null)
})

it.each([true, false])('closes immediately and removes the inert exit copy on completion (reduced=%s)', async (reduced) => {
  prepare(reduced)
  const box = element('Box')
  const scrim = element('Scrim')
  close(box, scrim)
  await Promise.resolve()
  expect(animate).not.toHaveBeenCalled() // Still mounted: StrictMode cleanup is harmless.
  close(box, scrim)
  box.remove()
  scrim.remove()
  await Promise.resolve()
  expect(box.inert).toBe(true)
  expect(box.style.pointerEvents).toBe('none')
  animations[0]!.dispatchEvent(new Event('finish'))
  expect(box.isConnected).toBe(false)
  expect(scrim.isConnected).toBe(false)
})

it('navigates at once and carries a decorative title into the page without hiding it', async () => {
  prepare()
  const row = element('Project')
  const heading = document.createElement('h1')
  const target = element('Project')
  heading.append(target)
  document.body.append(heading)
  const closed = vi.fn()
  const go = vi.fn()
  into(row, 'Project', closed, go)
  expect(closed).toHaveBeenCalledOnce()
  expect(go).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(document.querySelector('[aria-hidden="true"]')?.children.length).toBe(1)
  expect(target.style.visibility).toBe('')
  animations[0]!.dispatchEvent(new Event('finish'))
  expect(document.querySelector('[aria-hidden="true"]')?.children.length).toBe(0)
})

it('retargets a resizing palette from its current height and cancels work when unmounted', () => {
  prepare()
  let resize!: ResizeObserverCallback
  const disconnect = vi.fn()
  class Observer {
    constructor(callback: ResizeObserverCallback) {
      resize = callback
    }
    observe() {}
    disconnect = disconnect
  }
  vi.stubGlobal('ResizeObserver', Observer)
  const box = element('Box')
  const content = element('Rows')
  let height = 100
  Object.defineProperty(content, 'offsetHeight', { get: () => height })
  Object.defineProperty(box, 'offsetHeight', { get: () => 150 })
  const hook = renderHook(() => useGlide({ current: box }, { current: content }))
  const changed = () => resize([], {} as ResizeObserver)
  changed()
  expect(animate).not.toHaveBeenCalled()
  height = 200
  changed()
  expect(animate).toHaveBeenCalledOnce()
  height = 300
  changed()
  expect(animations[0]!.cancel).toHaveBeenCalledOnce()
  expect(animate.mock.calls[1]?.[0]).toEqual([{ height: '150px' }, { height: '300px' }])
  animations[1]!.dispatchEvent(new Event('finish'))
  height = 300.5
  changed()
  expect(animate).toHaveBeenCalledTimes(2)
  height = 400
  changed()
  hook.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(animations[2]!.cancel).toHaveBeenCalledOnce()
  vi.unstubAllGlobals()
})
