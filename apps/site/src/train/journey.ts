/*
 * The journey's clock: when the train pulls away slowly, when it gathers
 * speed, and how far it has gone by any second. Distance is read from the
 * clock, never added up frame by frame, so `?t=` shows the same frame
 * every time and a slow frame never makes the world jump.
 *
 * Speeds are in metres a second, distances in metres: the landscape
 * (world.ts) knows how many px a metre is at each distance from the window.
 */

/** The train's speed, in metres a second. */
export const SPEED = {
  /** Pulling away, about 22 km/h: the grass by the line crosses the window in a few seconds. */
  slow: 6,
  /** Flat out, about 330 km/h: everything near is streaks. */
  fast: 92,
} as const

/** When things happen, in seconds from the page opening. */
export const AT = {
  /** The carriage comes up out of the dark, the view at first too bright, as eyes find it. */
  open: 0,
  opened: 1.0,
  /** The headline's words, one after another, while the train still rolls slowly. */
  words: 0.45,
  /** The ways in and the lead, close behind the headline: nobody waits for the train to read them. */
  rest: 1.3,
  /** The train gathers speed over this span, a lurch at its start. */
  pull: 2.1,
  flat: 5.6,
} as const

/** Of the way from slow to fast, by how far through the pull it is: gentle at first, building, then settling. */
export const surge = (x: number) => {
  const u = Math.min(1, Math.max(0, x))
  // A smoothstep leaned late: most of the gain comes in the second half, as a train's does on the ear.
  const s = u * u * u * (u * (u * 6 - 15) + 10)
  return 0.15 * u * u + 0.85 * s
}

/** The speed at second `t`, in metres a second: from slow to fast across the pull, by a ratio, so each second feels as much faster as the last. */
export const speedAt = (t: number) => {
  const x = (t - AT.pull) / (AT.flat - AT.pull)
  return SPEED.slow * (SPEED.fast / SPEED.slow) ** surge(x)
}

/** How much of the way to flat out it is, 0 to 1, by the ratio: what blur, shake and the headline's last word follow. */
export const pace = (t: number) => Math.log(speedAt(t) / SPEED.slow) / Math.log(SPEED.fast / SPEED.slow)

/** The second the train is this share of the way to flat out (by `pace`). */
export const whenPace = (share: number) => {
  let lo: number = AT.pull
  let hi: number = AT.flat
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (pace(mid) < share) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Steps a second when adding up the pull: fine enough that the sum is exact to the eye. */
const STEPS = 240
/** The distance gone by each step of the pull, from its start. */
const TABLE = (() => {
  const span = AT.flat - AT.pull
  const h = span / STEPS
  const table = new Float64Array(STEPS + 1)
  for (let i = 1; i <= STEPS; i++) {
    const a = AT.pull + (i - 1) * h
    // Simpson's rule on each step.
    table[i] = table[i - 1]! + (h / 6) * (speedAt(a) + 4 * speedAt(a + h / 2) + speedAt(a + h))
  }
  return table
})()

/** How far the train has gone by second `t`, in metres. */
export const distanceAt = (t: number) => {
  if (t <= AT.pull) return SPEED.slow * t
  const before = SPEED.slow * AT.pull
  const span = AT.flat - AT.pull
  if (t >= AT.flat) return before + TABLE[STEPS]! + SPEED.fast * (t - AT.flat)
  const at = ((t - AT.pull) / span) * STEPS
  const i = Math.floor(at)
  const f = at - i
  const a = TABLE[i]!
  const b = TABLE[Math.min(STEPS, i + 1)]!
  return before + a + (b - a) * f
}

/** The jolt as the brakes come off and the train pulls: a lean back, then forward, settling. In shares of its largest. */
export const lurchAt = (t: number) => {
  const x = t - AT.pull
  if (x < 0 || x > 1.6) return 0
  return Math.sin(x * 7.5) * Math.exp(-x * 3.2)
}
