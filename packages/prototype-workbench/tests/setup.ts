import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

/*
 * jsdom lacks what the kit's components lean on in a browser, as in the
 * kit's own tests: a resize observer that never fires, a media query that
 * matches nothing, and pointer capture and scrolling that do nothing (Radix
 * calls them). A test that needs the observer to fire sets its own.
 */
class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: NoObserver })

// The plugin's tests run in Node, with no page.
if (typeof window !== 'undefined') {
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
    window.history.replaceState(null, '', '/')
  })
}
