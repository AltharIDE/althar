import { useSyncExternalStore } from 'react'

/*
 * Whether the reader has pinch-zoomed in. Zoomed, the browser draws the page
 * again at its new size, a tile at a time; a picture that changes on every
 * frame keeps undoing those tiles, and the screen flashes blank where they
 * haven't caught up. So while zoomed in, the page's pictures hold still
 * (their loops ask `isZoomed()` or `useZoomed()`; their CSS animations,
 * transitions and layer hints stop under `html[data-zoomed]`,
 * Home.module.css; a move under way is finished), and they go on as it
 * zooms back out.
 */

/** Past this scale it counts as zoomed in: a little over 1, so a trackpad's rest isn't mistaken for it. */
const OVER = 1.02

let zoomed = false
let started = false
const heard = new Set<() => void>()

function start() {
  if (started || typeof window === 'undefined' || !window.visualViewport) return
  started = true
  const view = window.visualViewport
  const check = () => {
    const now = view.scale > OVER
    if (now === zoomed) return
    zoomed = now
    document.documentElement.toggleAttribute('data-zoomed', now)
    // What is moving as it zooms in goes straight to where it was going: a move under way is a layer, drawn at the zoom's sharpness.
    if (now)
      for (const move of document.getAnimations()) {
        try {
          move.finish()
        } catch {
          // One with no end can't be finished: it is a CSS loop, which the page's rule stops.
        }
      }
    for (const hear of heard) hear()
  }
  view.addEventListener('resize', check)
  check()
}

/** Whether it is zoomed in now, for a loop to ask each frame. */
export function isZoomed() {
  start()
  return zoomed
}

/** Whether it is zoomed in, drawing again as that changes. */
export function useZoomed() {
  return useSyncExternalStore(
    (hear) => {
      start()
      heard.add(hear)
      return () => heard.delete(hear)
    },
    () => zoomed,
    () => false,
  )
}
