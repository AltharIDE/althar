import { type RefObject, useEffect } from 'react'

import { type Engraver, makeEngraver, type Scene } from './engraver'

/*
 * Prototype (B): lays the engraving into the sections as tiles, each drawn
 * once as it comes near and let go when it is far, so scrolling costs
 * nothing: the tiles are the page's, and move with it. The scene is
 * measured from the page (where the first picture ends, where the clouds
 * and the open sky are, the boxes of the words) and drawn again whenever
 * the page's layout changes.
 */

/** The most device pixels a tile may hold. */
const MOST_PIXELS = 4e6

const rectIn = (el: Element, origin: DOMRect) => {
  const r = el.getBoundingClientRect()
  return [r.left - origin.left, r.top - origin.top, r.width, r.height] as const
}

function measure(main: HTMLElement): Scene | null {
  const origin = main.getBoundingClientRect()
  const w = main.clientWidth
  const h = main.offsetHeight
  const phone = w < 700
  const top = (selector: string) => {
    const el = main.querySelector(selector)
    return el ? el.getBoundingClientRect().top - origin.top : null
  }
  const limbAt = main.querySelector('[data-limb]')
  if (!limbAt) return null
  const limb = limbAt.getBoundingClientRect().bottom - origin.top + (phone ? 54 : 84)
  const flow = top('#flow')
  const edge = top('#edge')
  const end = top('#end')
  const flowFoot = main.querySelector('#flow')?.getBoundingClientRect().bottom
  if (flow === null || edge === null || end === null || flowFoot === undefined) return null
  const clear = [...main.querySelectorAll('[data-clear], #edge [class*="menuWords"]')].map((el) => rectIn(el, origin))
  return {
    w,
    h,
    limb,
    radius: Math.max(w * 1.02, 900),
    clouds: flow + (phone ? 40 : 70),
    bank: (main.querySelector('#flow [data-clear]')?.getBoundingClientRect().bottom ?? flow + 600) - origin.top + (phone ? 30 : 70),
    under: flowFoot - origin.top - (phone ? 200 : 360),
    open: edge,
    end,
    period: phone ? 4 : 4.4,
    clear,
  }
}

export function useEngraving(mainRef: RefObject<HTMLElement | null>, platesRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const main = mainRef.current
    const plates = platesRef.current
    if (!main || !plates) return
    const style = getComputedStyle(main)
    let engraver: Engraver | null = makeEngraver(
      style.getPropertyValue('--plate-paper').trim() || '#f4f2ec',
      style.getPropertyValue('--ink').trim() || '#1f35c8',
      () => {
        engraver = null
        for (const tile of tiles.values()) tile.remove()
        tiles.clear()
      },
    )
    if (!engraver) return
    let scene: Scene | null = null
    let tileH = 1024
    let dpr = 1
    const tiles = new Map<number, HTMLCanvasElement>()
    const fresh = new Set<number>()
    let frame = 0

    /** Draws what is near the window, nearest first, a couple of tiles a frame; lets go of what is far. */
    const work = () => {
      frame = 0
      if (!engraver || !scene) return
      const view = main.getBoundingClientRect()
      const vh = window.innerHeight
      const from = -view.top - vh
      const to = -view.top + 2 * vh
      const first = Math.max(0, Math.floor(from / tileH))
      const last = Math.min(Math.ceil(scene.h / tileH) - 1, Math.floor(to / tileH))
      for (const [i, tile] of tiles) {
        if (i < first - 1 || i > last + 1) {
          tile.width = tile.height = 0
          tile.remove()
          tiles.delete(i)
          fresh.delete(i)
        }
      }
      const middle = (-view.top + vh / 2) / tileH
      const wanted = []
      for (let i = first; i <= last; i++) if (!fresh.has(i)) wanted.push(i)
      wanted.sort((a, b) => Math.abs(a + 0.5 - middle) - Math.abs(b + 0.5 - middle))
      let drawn = 0
      for (const i of wanted) {
        if (drawn >= 2) break
        let tile = tiles.get(i)
        if (!tile) {
          tile = document.createElement('canvas')
          tiles.set(i, tile)
          plates.append(tile)
        }
        const height = Math.min(tileH, scene.h - i * tileH)
        tile.style.top = `${i * tileH}px`
        tile.style.height = `${height}px`
        if (!engraver.draw(tile, scene, i * tileH, height, dpr)) return
        fresh.add(i)
        drawn++
      }
      if (wanted.length > drawn) frame = requestAnimationFrame(work)
    }
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(work)
    }

    /** The page laid out anew: measure again, and draw every tile again. */
    let settle = 0
    const relayout = () => {
      clearTimeout(settle)
      settle = window.setTimeout(() => {
        const next = measure(main)
        if (!next) return
        const key = (s: Scene) => JSON.stringify(s)
        dpr = Math.min(2, window.devicePixelRatio || 1)
        tileH = Math.max(400, Math.min(1024, Math.floor(MOST_PIXELS / (next.w * dpr * dpr))))
        main.style.setProperty('--night', `${Math.round(next.limb)}px`)
        if (scene && key(scene) === key(next)) return
        scene = next
        fresh.clear()
        soon()
      }, 60)
    }
    const ro = new ResizeObserver(relayout)
    ro.observe(main)
    for (const el of main.querySelectorAll('[data-clear], [data-limb]')) ro.observe(el)
    void document.fonts?.ready.then(relayout)
    relayout()
    window.addEventListener('scroll', soon, { passive: true })
    window.addEventListener('resize', relayout)
    return () => {
      clearTimeout(settle)
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('scroll', soon)
      window.removeEventListener('resize', relayout)
      for (const tile of tiles.values()) {
        tile.width = tile.height = 0
        tile.remove()
      }
      engraver?.dispose()
    }
  }, [mainRef, platesRef])
}
