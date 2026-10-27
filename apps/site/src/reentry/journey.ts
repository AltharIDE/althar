/*
 * The re-entry's clock. The capsule comes in out of the dark, a faint glow
 * at the windows; the glow catches and builds into fire streaming past the
 * glass, faster and faster, the capsule shaking harder, the cabin lit by
 * it; at its height the windows go white; and then it breaks, torn away in
 * tatters, and there is the sky and the cloud far below: "fast." Then the
 * capsule settles, and the clouds drift.
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
} as const

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a))
  return u * u * (3 - 2 * u)
}

/** How far the fire has torn away, 0 before the break to 1 once it is gone. */
export const brokenAt = (t: number) => smooth(AT.break, AT.broken, t)

/** How hot it is outside, 0 to 1: a glow at first, building faster and faster, held at its height, then gone with the break. */
export const heatAt = (t: number) => {
  const u = clamp((t - AT.ignite) / (AT.peak - AT.ignite))
  return (0.06 + 0.94 * u ** 1.7) * (t < AT.ignite ? smooth(0, AT.ignite, t) : 1) * (1 - brokenAt(t))
}

/** How fast the fire streams past, in the plasma's own widths a second: slow at first, very fast at the height. */
const FLOW = { slow: 0.12, fast: 3.6 } as const

/** How fast it streams at second `t`, in the plasma's widths a second; it keeps going after the break, as what is left is swept away. */
export const speedAt = (t: number) => FLOW.slow + (FLOW.fast - FLOW.slow) * clamp((t - AT.ignite) / (AT.peak - AT.ignite)) ** 1.5

/** How far the fire has streamed by second `t`, in the plasma's widths: its speed summed once in small steps, then read off. */
export const flowAt = (() => {
  const step = 1 / 240
  const until = 12
  const table = new Float64Array(Math.ceil(until / step) + 2)
  for (let i = 1; i < table.length; i++) table[i] = table[i - 1]! + speedAt((i - 0.5) * step) * step
  return (t: number) => {
    const x = Math.min(until, Math.max(0, t)) / step
    const i = Math.floor(x)
    const f = x - i
    return table[i]! * (1 - f) + table[Math.min(i + 1, table.length - 1)]! * f
  }
})()

/** How hard the capsule shakes, 0 to 1: with the heat, hardest at the height, settling once it breaks. */
export const shakeAt = (t: number) => heatAt(t) ** 1.3 + 0.6 * smooth(AT.peak - 0.4, AT.peak, t) * (1 - brokenAt(t))
