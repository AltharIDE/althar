import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { setProjectAnnotations } from '@storybook/react-vite'
import { afterEach, beforeAll, vi } from 'vitest'

import preview from '../.storybook/preview'

/*
 * jsdom lacks what the components lean on in a browser. Each stand-in is the
 * least that lets them run: a resize observer that never fires, an
 * intersection observer that sees everything it is given (a story is on
 * screen), a media query that matches nothing, pointer capture that is a
 * no-op (Radix calls it), and a 2D context that draws nothing.
 */
class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
class SeesAll {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
Object.assign(globalThis, { ResizeObserver: NoObserver, IntersectionObserver: SeesAll })

window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList

const missing = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} }
for (const [name, value] of Object.entries(missing)) {
  if (!(name in Element.prototype)) Object.defineProperty(Element.prototype, name, { value, configurable: true })
}
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']

const annotations = setProjectAnnotations([preview])
beforeAll(() => annotations.beforeAll())
afterEach(() => cleanup())
