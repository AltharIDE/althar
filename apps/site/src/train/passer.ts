import { whenPace } from './journey'
import type { Ctx } from './paint'
import type { Box } from './world'

/*
 * Another train, going the other way on the next track, at the height of
 * the speed: its nose crosses the window in a blink, its body fills the
 * glass for a moment, a smear of silver with a dark band of windows and a
 * graphite line, and its tail clears the glass from right to left. What's
 * behind it is uncovered edge for edge with the tail (the depth look stands
 * its word there, bigword.ts).
 */

export const PASSER = {
  /** When its nose reaches the window's far edge: as the train passes 60% of the way to flat out. */
  at: whenPace(0.6),
  /** Seconds its nose takes to cross the window, and its body to go by a point. */
  cross: 0.16,
  body: 0.56,
} as const

export interface Pass {
  /** Where its nose and its tail are on the screen. */
  nose: number
  tail: number
  /** How much of the window it fills, 0 to 1. */
  cover: number
}

/** Where the other train is at second `t`, or null when it hasn't come or has gone. */
export function passAt(win: Box, t: number): Pass | null {
  if (t < PASSER.at) return null
  const speed = win.w / PASSER.cross
  const nose = win.x + win.w + 40 - speed * (t - PASSER.at)
  const tail = nose + speed * PASSER.body
  if (tail < win.x - 60) return null
  const left = Math.max(nose, win.x)
  const right = Math.min(tail, win.x + win.w)
  return { nose, tail, cover: Math.max(0, right - left) / win.w }
}

/** Whether it has gone by, at second `t`. */
export const passedBy = (win: Box, t: number) => t >= PASSER.at && passAt(win, t) === null

/** Its body, top to bottom: roof, the dark band of its windows, the body with its stripe, the skirt. */
const BODY: Array<[number, string]> = [
  [0, '#8d949e'],
  [0.04, '#dfe3e8'],
  [0.12, '#c6ccd4'],
  [0.15, '#28303b'],
  [0.26, '#3a4555'],
  [0.4, '#1b222d'],
  [0.44, '#cdd3da'],
  [0.62, '#f2f4f6'],
  [0.69, '#e7eaee'],
  [0.7, '#3a4250'],
  [0.725, '#2c333f'],
  [0.735, '#dde1e6'],
  [0.88, '#a3aab3'],
  [0.92, '#535a64'],
  [1, '#2a2e34'],
]

/** Streaks along it, the same each time: the smear of its seams, doors and windows. */
const STREAKS = Array.from({ length: 34 }, (_, i) => {
  const v = Math.sin(i * 91.7 + 3.1) * 43758.5453
  const r = v - Math.floor(v)
  return { at: 0.02 + ((i * 0.618) % 1) * 0.96, alpha: 0.04 + r * 0.12, dark: r < 0.5 }
})

/** How long its ends are smeared by its speed, in windows: as a short exposure would have them, its tail sharper than its nose. */
const SMEAR = { nose: 0.08, tail: 0.045 }

/**
 * Draws the other train for second `t`, if it is going by, and says whether
 * it did. It is drawn on a clear canvas, before anything behind it: its ends'
 * smear is laid over the whole canvas as a fade, so what is behind it is
 * drawn after, under it (`destination-over`), and shows through the smear.
 */
export function drawPasser(ctx: Ctx, win: Box, t: number) {
  const p = passAt(win, t)
  if (!p) return false
  // Its roof a little above the eye, its windows level with it: under the words, not behind them.
  const top = win.y + win.h * 0.3
  const bottom = win.y + win.h + 24
  const tall = bottom - top
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  for (const [at, colour] of BODY) g.addColorStop(at, colour)
  ctx.fillStyle = g
  ctx.fillRect(p.nose, top, p.tail - p.nose, tall)
  // The streaks, flickering a little as its doors and windows go by.
  const from = Math.max(p.nose, win.x - 20)
  const to = Math.min(p.tail, win.x + win.w + 20)
  if (to > from)
    for (const [i, s] of STREAKS.entries()) {
      const flicker = 0.85 + 0.15 * Math.sin(t * 23 + i * 2.3)
      ctx.fillStyle = s.dark
        ? `rgba(10, 14, 22, ${(s.alpha * flicker).toFixed(3)})`
        : `rgba(255, 255, 255, ${(s.alpha * flicker).toFixed(3)})`
      ctx.fillRect(from, top + s.at * tall, to - from, Math.max(1, tall * 0.004))
    }
  // The sun on its roof, low from the left.
  const sheen = ctx.createLinearGradient(0, top, 0, top + tall * 0.2)
  sheen.addColorStop(0, 'rgba(255, 236, 205, 0.35)')
  sheen.addColorStop(1, 'rgba(255, 236, 205, 0)')
  ctx.fillStyle = sheen
  if (to > from) ctx.fillRect(from, top, to - from, tall * 0.2)
  // Its ends smeared: faded in from its nose, easing, and out to its tail, over a short stretch each.
  const long = p.tail - p.nose
  const nose = Math.min(0.45, (win.w * SMEAR.nose) / long)
  const tail = Math.min(0.45, (win.w * SMEAR.tail) / long)
  const fade = ctx.createLinearGradient(p.nose, 0, p.tail, 0)
  for (let i = 0; i <= 6; i++) {
    const u = i / 6
    const eased = u * u * (3 - 2 * u)
    fade.addColorStop(nose * u, `rgba(0, 0, 0, ${(eased * eased).toFixed(3)})`)
    fade.addColorStop(1 - tail * u, `rgba(0, 0, 0, ${eased.toFixed(3)})`)
  }
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = fade
  // Over all of the canvas, however it is moved and scaled.
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5)
  ctx.globalCompositeOperation = 'source-over'
  return true
}
