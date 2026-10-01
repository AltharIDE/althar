import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * jsdom lacks what the kit's components lean on in a browser; each stand-in
 * is the least that lets them run (as the kit's own test setup has them).
 */
class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

if (typeof window !== 'undefined') {
  Object.assign(globalThis, { ResizeObserver: NoObserver, IntersectionObserver: NoObserver })
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
  afterEach(() => {
    cleanup()
    // What a view keeps in storage, like the person's pinned models, starts empty in each test.
    window.localStorage.clear()
  })
}
