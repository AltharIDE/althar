import { COLUMNS } from './light'

/*
 * When each part of the launch moves, as pure functions of time, so the
 * component only draws what they say.
 *
 * A light rises off the window's bottom, from the middle out, on a slow
 * spring, and sways a little while it stands (light.ts). The mark comes up
 * out of it: low, soft and in the light's own pale cobalt at first, then
 * clear of it, sharp and in ink, its foot and lower edge still catching the
 * light. The point is set in the bore last. Once what it opens onto is ready,
 * the light sinks back from the edges in, the mark goes into a blur, and
 * what it opens onto rises in over both on a spring.
 */

/** Milliseconds: from the start, or (`open`) from when the opening began. */
export const AT = {
  /** The light: when its middle starts up, how much later its edges do, and its spring. */
  light: { start: 40, spread: 300, response: 1.05, damping: 0.86 },
  /** The mark, coming up out of the light on a spring that just settles. */
  mark: { start: 120, response: 1.15, damping: 0.92 },
  /** The bore fills with light, which draws in to the point as the point comes out of it, sharp and without a bounce. */
  gather: { start: 900, length: 440 },
  point: { start: 1000, length: 340 },
  /** The earliest it opens: the mark is up, and the point all but set. */
  set: 1240,
  open: {
    /** The light sinks, the edges at once and the middle `spread` later, each over `sink`; then it is gone over `fade`. */
    spread: 140,
    sink: 640,
    fade: { start: 360, length: 520 },
    /** The mark goes into a blur. */
    mark: { start: 60, length: 460 },
    /** What it opens onto rises in, on its spring. */
    behind: { start: 200, response: 0.62, damping: 0.8 },
  },
  /** How long opening takes, until what it opened onto has settled. */
  through: 1200,
  /** Opening at once, as after a reload or with motion reduced: how long the mark stays, and how long it fades. */
  quick: { hold: 160, fade: 220 },
} as const

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
/** How far along [start, start + length] time `t` is, from 0 to 1. */
export const progress = (t: number, start: number, length: number) => clamp((t - start) / length)
export const lerp = (from: number, to: number, x: number) => from + (to - from) * x

export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
export const easeInCubic = (x: number) => x * x * x
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2

/**
 * A spring from 0 to 1, `ms` after it was let go, as Apple describes one:
 * `response` is how long a swing takes in seconds; `damping` 1 settles
 * without passing the end, lower swings past it and back.
 */
export const spring = (ms: number, response: number, damping: number) => {
  if (ms <= 0) return 0
  const t = ms / 1000
  const w = (2 * Math.PI) / response
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const wd = w * Math.sqrt(1 - damping * damping)
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t))
}

/** The light at `t`, `open` being when the opening began, or null. */
export interface Light {
  /** Each column: how tall it stands, as a share of the light's height, and how far it has drifted aside, in px. */
  readonly columns: ReadonlyArray<{ readonly height: number; readonly drift: number }>
  /** How strongly the light shows, and its grain. */
  readonly strength: number
  readonly grain: number
  /** How much light the middle column brings up to the mark, 0 to about 1. */
  readonly reach: number
}

export const lightAt = (t: number, open: number | null): Light => {
  const since = open === null ? -1 : t - open
  const { light } = AT
  const sunk = (d: number) => easeInOutCubic(progress(since, (1 - d) * AT.open.spread, AT.open.sink))
  const up = (d: number) => spring(t - (light.start + d * light.spread), light.response, light.damping)
  return {
    columns: COLUMNS.map((column) => ({
      height: column.height * up(column.d) * (1 + 0.04 * Math.sin(t / 640 + column.i * 1.7)) * (1 - sunk(column.d)),
      drift: 9 * Math.sin(t / 930 + column.i * 2.3),
    })),
    strength: 1 - easeInCubic(progress(since, AT.open.fade.start, AT.open.fade.length)),
    grain: 0.5 * spring(t - 200, 1, 1) * (1 - easeInOutCubic(progress(since, 80, 700))),
    reach: up(0) * (1 - sunk(0)),
  }
}

/** The mark at `t`, `open` being when the opening began, or null; `reach` is how much light comes up to it. */
export interface Mark {
  /** How strongly it shows, how soft it is (px), and its size against its own. */
  readonly shown: number
  readonly blur: number
  readonly scale: number
  /** How far below its place it still is, as a share of the window's height; and how far above it it has gone, in px. */
  readonly drop: number
  readonly up: number
  /** How far it has come clear of the light: 0 in its pale cobalt, 1 in ink. */
  readonly clear: number
  /** How strongly its foot, and its lower edge, catch the light. */
  readonly lit: number
  readonly rim: number
  /** How far the point has come out of the light, 0 to 1: it grows and sharpens with it. */
  readonly point: number
  /** How strongly the bore glows, and how wide the glow is against the bore. */
  readonly bloom: number
  readonly focus: number
}

export const markAt = (t: number, open: number | null, reach: number): Mark => {
  const since = open === null ? -1 : t - open
  const risen = spring(t - AT.mark.start, AT.mark.response, AT.mark.damping)
  const come = clamp(risen * 2.4)
  const gone = easeInCubic(progress(since, AT.open.mark.start, AT.open.mark.length))
  const clear = easeInOutCubic(clamp((risen - 0.3) / 0.65))
  const glowing = progress(t, AT.gather.start, AT.gather.length)
  return {
    shown: come * (1 - gone),
    blur: (1 - clamp(risen)) * 12 + gone * 14,
    scale: lerp(1.07, 1, come) * lerp(1, 0.94, gone),
    drop: (1 - risen) * 0.09,
    up: gone * 10,
    clear,
    lit: reach * 0.9,
    rim: reach * clear,
    point: easeOutCubic(progress(t, AT.point.start, AT.point.length)),
    bloom: easeOutCubic(clamp(glowing * 2)) * lerp(1, 0.35, easeInOutSine(progress(t, AT.gather.start + AT.gather.length, 700))),
    focus: lerp(1, 0.62, easeInOutCubic(glowing)),
  }
}

/** The mark set, as it shows when the launch opens at once. */
export const SET: Mark = { shown: 1, blur: 0, scale: 1, drop: 0, up: 0, clear: 1, lit: 0, rim: 0, point: 1, bloom: 0, focus: 0.62 }

/** What it opens onto, `since` ms after the opening began: how far below its place (px), how soft (px), its size, how strongly it shows. */
export interface Behind {
  readonly rise: number
  readonly blur: number
  readonly scale: number
  readonly strength: number
}

export const behindAt = (since: number): Behind => {
  const { start, response, damping } = AT.open.behind
  const settled = spring(since - start, response, damping)
  return {
    rise: (1 - settled) * 28,
    blur: Math.max(0, 1 - settled) * 8,
    scale: lerp(0.985, 1, settled),
    strength: clamp((since - start) / (response * 520)),
  }
}
