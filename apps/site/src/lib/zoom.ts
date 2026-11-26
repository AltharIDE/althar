import { useSyncExternalStore } from 'react'

/*
 * Whether the reader has pinch-zoomed in. Zoomed, the browser draws the page
 * again at its new size, a tile at a time; a picture that changes on every
 * frame keeps undoing those tiles, and the screen flashes blank where they
 * haven't caught up. So while zoomed in, the page's pictures hold still
 * (their loops ask `isZoomed()` or `useZoomed()`; their CSS animations and
 * layer hints stop under `html[data-zoomed]`, Home.module.css), and they go
 * on as it zooms back out.
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
