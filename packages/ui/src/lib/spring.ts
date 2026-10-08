/*
 * Springs, for motion that settles as a thing let go does: as a value over
 * time, and as an easing the compositor can run.
 */

/** Past this many ms a spring is taken as settled. */
const SETTLED = 10_000

/**
 * A spring from 0 to 1, `ms` after it was let go, as Apple describes one:
 * `response` is how long a swing takes in seconds; `damping` 1 settles
 * without passing the end, lower swings past it and back.
 */
export const spring = (ms: number, response: number, damping: number) => {
  if (ms <= 0) return 0
  if (ms >= SETTLED) return 1
  const t = ms / 1000
  const w = (2 * Math.PI) / response
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const wd = w * Math.sqrt(1 - damping * damping)
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t))
}

/**
 * A spring as a CSS easing, for an animation the compositor runs: the spring
 * sampled until it has settled, and how long that takes in ms.
 */
export const springEasing = (response: number, damping: number, points = 48) => {
  const w = (2 * Math.PI) / response
  // Settled once its swing is a thousandth of the way.
  const duration = Math.round((Math.log(1000) / (Math.min(damping, 1) * w)) * 1000)
  const values = Array.from({ length: points + 1 }, (_, i) => (i === points ? 1 : spring((duration * i) / points, response, damping)))
  return { easing: `linear(${values.map((v) => Number(v.toFixed(4))).join(', ')})`, duration }
}
