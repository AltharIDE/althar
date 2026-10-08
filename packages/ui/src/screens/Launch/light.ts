/*
 * The light the launch rises in: a row of tall columns standing off the
 * window's bottom, highest in the middle, Althar's cobalt there and paler
 * out to warm at the edges, as Dia's light is a rainbow. Each is a little
 * uneven, the same every time, so the light has a profile of its own.
 */

export interface Column {
  readonly i: number
  /** How far from the middle, 0 there to 1 at the edges. */
  readonly d: number
  /** Where its middle stands, and how wide it is, in % of the light's width. */
  readonly left: number
  readonly width: number
  /** How tall it stands once up, as a share of the light's height. */
  readonly height: number
  /** Bottom to top: its colour, paler as it goes up, and gone at its top. */
  readonly background: string
}

export const COLUMN_COUNT = 23

/** Bottom to top, by how far a column is from the middle. The middle is --live. */
export const toneOf = (d: number): readonly [string, string, string] =>
  d < 0.16
    ? ['#2b3bff', '#5162ff', '#a9b3ff']
    : d < 0.36
      ? ['#3a5dff', '#6e9bff', '#cddfff']
      : d < 0.6
        ? ['#5aa2ff', '#a2cfff', '#e6f1ff']
        : d < 0.8
          ? ['#9fc6ff', '#d4e6ff', '#f3f7ff']
          : ['#ffb995', '#ffd8c0', '#fff3ea']

/** The same small unevenness every time, 0 to 1. */
export const jitter = (i: number) => {
  const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453
  return x - Math.floor(x)
}

export const COLUMNS: ReadonlyArray<Column> = Array.from({ length: COLUMN_COUNT }, (_, i) => {
  const u = i / (COLUMN_COUNT - 1)
  const d = Math.abs(u - 0.5) * 2
  const [low, middle, high] = toneOf(d)
  return {
    i,
    d,
    left: u * 100,
    width: 8.5 - 2 * d,
    height: (0.2 + 0.46 * Math.exp(-d * d * 3.2)) * (0.8 + 0.2 * jitter(i)),
    background: `linear-gradient(to top, ${low} 0%, ${middle} 34%, ${high} 66%, rgba(255, 255, 255, 0) 100%)`,
  }
})
