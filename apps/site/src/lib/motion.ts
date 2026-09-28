/*
 * Time, not scroll: each site scene is a timeline, drawn by writing to the
 * DOM from a frame loop. It plays once when the page opens, pauses while it
 * is off screen, and offers to play again at the end. With reduced motion it
 * draws the last frame and stops.
 */

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
export const ease = (t: number) => t * t * (3 - 2 * t)
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** How far t is through [a, b], from 0 to 1, eased. */
export const span = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a)))
export const range = (n: number) => Array.from({ length: n }, (_, i) => i)

const stillNow = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export interface Playback {
  /** Seconds the timeline runs for. */
  total: number
  draw: (t: number) => void
  /** Shown once it has played through; plays it again. */
  replay?: HTMLButtonElement | null
  /** Keep drawing past the end, for a scene that idles. */
  idle?: boolean
  /** Pauses while this is off screen. */
  watch?: Element | null
}

/** Plays a timeline. Returns the cleanup for an effect. `?t=4.5` in the address holds it at that second, for looking at one frame. */
export function playback({ total, draw, replay, idle = false, watch }: Playback): () => void {
  const at = Number(new URLSearchParams(window.location.search).get('t') ?? NaN)
  if (stillNow() || Number.isFinite(at)) {
    draw(Number.isFinite(at) ? at : total)
    if (replay) replay.hidden = true
    return () => {}
  }
  const now = () => performance.now() / 1000
  let frame = 0
  let start = now()
  let held: number | null = null
  let seen = true

  const tick = () => {
    const t = now() - start
    draw(idle ? t : Math.min(t, total))
    if (replay) replay.hidden = t < total
    frame = idle || t < total ? requestAnimationFrame(tick) : 0
  }
  const resume = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)
  }
  const play = () => {
    start = now()
    held = null
    if (seen) resume()
  }
  const io = watch
    ? new IntersectionObserver(([e]) => {
        seen = e?.isIntersecting ?? true
        if (!seen) {
          held = now() - start
          cancelAnimationFrame(frame)
          frame = 0
        } else if (held !== null) {
          start = now() - held
          held = null
          if (idle || now() - start < total) resume()
        }
      })
    : null
  if (watch) io?.observe(watch)
  replay?.addEventListener('click', play)
  resume()
  return () => {
    cancelAnimationFrame(frame)
    io?.disconnect()
    replay?.removeEventListener('click', play)
  }
}
