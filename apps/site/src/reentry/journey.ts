import { clamp, out, smooth } from './motion'

/*
 * The re-entry's clock. The capsule comes in out of the dark, a faint glow
 * at the window; the glow catches and builds into fire streaming past the
 * glass, faster and faster, the capsule shaking harder and pressed down, the
 * cabin lit by it; at its height "fast." is forged in it; and then it
 * breaks, torn away, and there is the sky and the cloud far below. Then the
 * capsule settles, the sky drifts to a stop, and nothing moves: from then on
 * nothing is drawn.
 *
 * Everything is read from the clock, never added up frame by frame, so `?t=`
 * shows the same frame every time.
 */

/** When things happen, in seconds from the page opening. */
export const AT = {
  /** The cabin comes up out of the dark. */
  open: 0,
  opened: 1.0,
  /** The headline's words; then the ways in and the lead, close behind. */
  words: 0.45,
  rest: 1.3,
  /** The glow catches, and builds to its height. */
  ignite: 0.5,
  peak: 3.9,
  /** The fire breaks, and is gone: "fast.". */
  break: 4.5,
  broken: 5.1,
  /** Everything at rest: the last frame. */
  settled: 10,
} as const

/** How far the fire has torn away, 0 before the break to 1 once it is gone. */
export const brokenAt = (t: number) => smooth(AT.break, AT.broken, t)

/** How far through its build the fire is, 0 at ignition to 1 at its height. */
const building = (t: number) => clamp((t - AT.ignite) / (AT.peak - AT.ignite))

/** How hot it is outside, 0 to 1: a glow at first, building faster and faster, held at its height, then gone with the break. */
export const heatAt = (t: number) => (0.06 + 0.94 * building(t) ** 1.7) * (t < AT.ignite ? smooth(0, AT.ignite, t) : 1) * (1 - brokenAt(t))

/** How fast the fire streams past, in the plasma's own widths a second: slow at first, very fast at its height. */
const FLOW = { slow: 0.12, fast: 3.6 } as const

/** How fast it streams at second `t`, in the plasma's widths a second; it keeps going after the break, as what is left is swept away. */
export const speedAt = (t: number) => FLOW.slow + (FLOW.fast - FLOW.slow) * building(t) ** 1.5

/** How far the fire has streamed by second `t`, in the plasma's widths: its speed summed once in small steps, then read off. */
export const flowAt = (() => {
  const step = 1 / 240
  const table = new Float64Array(Math.ceil(AT.settled / step) + 2)
  for (let i = 1; i < table.length; i++) table[i] = table[i - 1]! + speedAt((i - 0.5) * step) * step
  return (t: number) => {
    const x = clamp(t, 0, AT.settled) / step
    const i = Math.floor(x)
    const f = x - i
    return table[i]! * (1 - f) + table[Math.min(i + 1, table.length - 1)]! * f
  }
})()

/** How hard the capsule shakes, 0 to 1: with the heat, hardest at its height, still once it breaks. */
export const shakeAt = (t: number) => heatAt(t) ** 1.3 + 0.6 * smooth(AT.peak - 0.4, AT.peak, t) * (1 - brokenAt(t))

/** How far the sky has drifted past the window since the break, in the wide photograph's px: easing to a stop well inside the sky picture's edge. */
export const driftAt = (t: number) => 160 * out((t - AT.break) / (AT.settled - AT.break))

/** How much the camera still sways, 1 to 0: freely until the sky opens, then coming to rest by the end. */
export const swayAt = (t: number) => 1 - smooth(AT.broken, AT.settled, t)
