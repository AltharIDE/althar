import type { Picked } from '../main/browser/picked'
import { describe } from './describe'

/*
 * Point and comment, in a page beside the conversation (ADR-100). The main
 * process runs this in an isolated world of the page (pages.ts), never in
 * the page's own: it shares the page's elements but none of its scripts, so
 * the page can't call it, change what it does or read what it holds, and it
 * reaches nothing of Althar's but what it returns. Everything it draws is in
 * a closed shadow root over the page: while the person points, a layer that
 * takes the pointer, so the page sees no hover and no press, with the
 * element under it outlined and named; and the numbered pins of the
 * comments made on this page. The comment itself is written in Althar's own
 * window, over a picture of the page, so the page never sees it typed.
 */

interface Pin {
  readonly n: number
  readonly selector: string
}

export interface Overlay {
  /** Points: resolves with the element pressed (or chosen with Enter), or null once stopped. */
  readonly point: () => Promise<Picked | null>
  /** Stops pointing, resolving it with nothing. */
  readonly stop: () => void
  /** A wider element than the one outlined (its parent), or back toward the one under the pointer. */
  readonly widen: () => void
  readonly narrow: () => void
  /** Takes the element outlined, as a press would. */
  readonly take: () => void
  /** Draws these pins, in place of those drawn; returns how many of their elements are on the page. */
  readonly pins: (pins: ReadonlyArray<Pin>) => number
  /** Brings an element into view and describes it as it is now, or null where it isn't on the page. */
  readonly find: (selector: string) => Picked | null
}

const VIOLET = '#7a3ff0'
const FONT = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const STYLE = `
  :host { all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
    pointer-events: none !important; display: block !important; contain: strict !important; }
  .catch { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: transparent; }
  .outline { position: fixed; box-sizing: border-box; border: 2px solid ${VIOLET}; border-radius: 3px;
    background: rgba(122, 63, 240, 0.08); pointer-events: none; }
  .name { position: fixed; padding: 2px 6px; border-radius: 4px; background: ${VIOLET}; color: #fff;
    font: 500 11px/16px ${MONO}; white-space: nowrap; pointer-events: none; }
  .name span { opacity: 0.72; margin-left: 6px; }
  .pin { position: fixed; box-sizing: border-box; width: 22px; height: 22px; border-radius: 11px; border: 2px solid #fff;
    background: ${VIOLET}; color: #fff; font: 600 11px/18px ${FONT}; text-align: center; pointer-events: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); font-variant-numeric: tabular-nums; }
  [hidden] { display: none !important; }
`

const install = (): Overlay => {
  const host = document.createElement('althar-overlay')
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const catcher = document.createElement('div')
  catcher.className = 'catch'
  catcher.hidden = true
  const outline = document.createElement('div')
  outline.className = 'outline'
  outline.hidden = true
  const name = document.createElement('div')
  name.className = 'name'
  name.hidden = true
  const pinLayer = document.createElement('div')
  root.append(style, pinLayer, outline, name, catcher)

  /* Kept in the page: a page that rewrites its document can take the host out with it. */
  const mounted = () => {
    if (!host.isConnected) document.documentElement.append(host)
  }

  let pointing: { readonly settle: (picked: Picked | null) => void } | null = null
  /* The element under the pointer, and the one outlined: the same, or one of its ancestors after widening. */
  let under: Element | null = null
  let outlined: Element | null = null
  let pins: ReadonlyArray<{ readonly n: number; readonly selector: string; readonly node: HTMLElement }> = []
  let frame = 0

  const at = (x: number, y: number) => document.elementsFromPoint(x, y).find((element) => element !== host) ?? null

  const draw = () => {
    frame = 0
    mounted()
    if (pointing !== null && outlined !== null && outlined.isConnected) {
      const box = outlined.getBoundingClientRect()
      Object.assign(outline.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
      outline.hidden = false
      const described = describe(outlined, window)
      name.textContent = described.label
      const size = document.createElement('span')
      size.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`
      name.append(size)
      name.hidden = false
      const above = box.top - 22 >= 4
      Object.assign(name.style, {
        left: `${Math.max(4, Math.min(box.left, window.innerWidth - name.offsetWidth - 4))}px`,
        top: `${above ? box.top - 22 : Math.min(box.bottom + 4, window.innerHeight - 22)}px`,
      })
    } else {
      outline.hidden = true
      name.hidden = true
    }
    for (const pin of pins) {
      const element = document.querySelector(pin.selector)
      if (element === null) {
        pin.node.hidden = true
        continue
      }
      const box = element.getBoundingClientRect()
      pin.node.hidden = box.bottom < 0 || box.top > window.innerHeight
      pin.node.style.left = `${Math.max(2, Math.min(box.right - 11, window.innerWidth - 24))}px`
      pin.node.style.top = `${Math.max(2, Math.min(box.top - 11, window.innerHeight - 24))}px`
    }
    if (pointing !== null || pins.length > 0) frame = requestAnimationFrame(draw)
  }
  const redraw = () => {
    if (frame === 0) frame = requestAnimationFrame(draw)
  }

  catcher.addEventListener('pointermove', (event) => {
    under = at(event.clientX, event.clientY)
    outlined = under
    redraw()
  })
  // A press on the layer takes what is outlined; nothing under it is pressed.
  catcher.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button !== 0) return
    outlined ??= at(event.clientX, event.clientY)
    take()
  })
  for (const kind of ['click', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'pointerup'])
    catcher.addEventListener(kind, (event) => {
      event.preventDefault()
      event.stopPropagation()
    })

  const finish = (picked: Picked | null) => {
    const settle = pointing?.settle
    pointing = null
    under = null
    outlined = null
    catcher.hidden = true
    redraw()
    settle?.(picked)
  }
  const take = () => {
    if (pointing === null) return
    finish(outlined === null || !outlined.isConnected ? null : describe(outlined, window))
  }

  return {
    point: () => {
      mounted()
      pointing?.settle(null)
      catcher.hidden = false
      redraw()
      return new Promise<Picked | null>((settle) => {
        pointing = { settle }
      })
    },
    stop: () => finish(null),
    widen: () => {
      const parent = outlined?.parentElement
      if (parent != null && parent !== document.documentElement) outlined = parent
      redraw()
    },
    narrow: () => {
      if (outlined === null || under === null || outlined === under) return
      let child: Element | null = under
      while (child !== null && child.parentElement !== outlined) child = child.parentElement
      outlined = child ?? under
      redraw()
    },
    take,
    pins: (list) => {
      mounted()
      for (const pin of pins) pin.node.remove()
      pins = list.map((pin) => {
        const node = document.createElement('div')
        node.className = 'pin'
        node.textContent = String(pin.n)
        node.hidden = true
        pinLayer.append(node)
        return { ...pin, node }
      })
      redraw()
      return list.filter((pin) => document.querySelector(pin.selector) !== null).length
    },
    find: (selector) => {
      let element: Element | null = null
      try {
        element = document.querySelector(selector)
      } catch {
        element = null
      }
      if (element === null) return null
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      redraw()
      return describe(element, window)
    },
  }
}

declare global {
  // The overlay's handle, in its isolated world's own global: the page's world never sees it.
  var __altharOverlay: Overlay | undefined
}

globalThis.__altharOverlay ??= install()
