/*
 * The orbit's clock. At first the station goes at its real speed, and from
 * 420 km up the ground only drifts by; then the view runs faster and faster,
 * a time-lapse, the night's lights drawn out into streaks; and the sun, on
 * the same clock, comes up to the limb and over it at the climax. The day
 * that follows runs calmer.
 *
 * Everything is read from the clock, never added up frame by frame, so `?t=`
 * shows the same frame every time and a slow frame never makes the ground
 * jump.
 */

/** The Earth and the station, in km and km a second. */
export const EARTH = {
  radius: 6371,
  /** The station's height. */
  height: 420,
  /** How fast the ground below goes by at real speed. */
  ground: 7.19,
} as const

/** How far below level the limb is from the station: where the sun has to climb to, to rise. */
export const DIP = Math.acos(EARTH.radius / (EARTH.radius + EARTH.height))

/** When things happen, in seconds from the page opening. */
export const AT = {
  /** The cabin comes up out of the dark, at night, the lights below. */
  open: 0,
  opened: 1.2,
  /** The headline's words, while the view still runs at real speed. */
  words: 0.45,
  /** The ways in and the lead, close behind. */
  rest: 1.3,
  /** The view gathers into a time-lapse over this span. */
  lapse: 1.4,
  lapsed: 4.6,
  /** The sun clears the limb: "fast.". */
  sunrise: 4.9,
  /** Then the day, running calmer. */
  calm: 5.3,
  calmed: 7.8,
} as const

/** How many times faster than real the view runs, flat out, and once it is day. */
export const LAPSE = { most: 120, day: 13 } as const

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
/** The integral of smooth(a, b, ·) from 0 to t, worked out rather than summed. */
const smoothed = (a: number, b: number, t: number) => {
  if (t <= a) return 0
  if (t >= b) return (b - a) / 2 + (t - b)
  const u = (t - a) / (b - a)
  return (b - a) * (u * u * u - (u * u * u * u) / 2)
}

/** How many times faster than real the view runs at second `t`. */
export const lapseAt = (t: number) =>
  1 + (LAPSE.most - 1) * smooth(AT.lapse, AT.lapsed, t) - (LAPSE.most - LAPSE.day) * smooth(AT.calm, AT.calmed, t)

/** How many real seconds the view has shown by second `t`. */
export const shownAt = (t: number) =>
  Math.max(0, t) + (LAPSE.most - 1) * smoothed(AT.lapse, AT.lapsed, t) - (LAPSE.most - LAPSE.day) * smoothed(AT.calm, AT.calmed, t)

/** How far the ground has gone by at second `t`, in km. */
export const groundAt = (t: number) => EARTH.ground * shownAt(t)

const SHOWN_AT_SUNRISE = shownAt(AT.sunrise)

/**
 * The sun's height above the station's level at second `t`, in radians:
 * below the limb by night, climbing as the view runs on, cresting the limb
 * (−DIP) at the sunrise, then quickly higher, so the light sweeps the
 * ground below in a moment rather than the minutes it takes.
 */
export const sunAt = (t: number) =>
  -DIP + (0.15 / SHOWN_AT_SUNRISE) * (shownAt(t) - SHOWN_AT_SUNRISE) + 0.2 * smooth(AT.sunrise, AT.sunrise + 2.4, t)

/** How far up the sun is, 0 by night to 1 just after it has cleared the limb: what the exposure and the cabin's light follow. */
export const dawnAt = (t: number) => smooth(-DIP - 0.02, -DIP + 0.05, sunAt(t))
