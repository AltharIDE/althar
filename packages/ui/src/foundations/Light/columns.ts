/*
 * Althar's light: the window opens in it (screens/Launch), and the home
 * rests over it (Light). A row of tall columns standing off the window's
 * bottom, highest in the middle, Althar's cobalt there and paler
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
  readonly tones: readonly [string, string, string]
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
  return {
    i,
    d,
    left: u * 100,
    width: 8.5 - 2 * d,
    height: (0.2 + 0.46 * Math.exp(-d * d * 3.2)) * (0.8 + 0.2 * jitter(i)),
    tones: toneOf(d),
  }
})

/** A column's picture: how many px wide and high, how wide the column itself is in it, and how soft. */
export const PICTURE = { width: 64, height: 256, column: 30, blur: 5 } as const

/**
 * Draws a column once, soft already, small: the window stretches it to the
 * column's place. Blurring it once here, not on every frame, keeps the light
 * cheap to show while it moves. Its picture is wider than the column by the
 * blur's reach either side. `live` is the window's --live, for the middle.
 */
export const drawColumn = (context: CanvasRenderingContext2D, column: Column, live?: string) => {
  const { width, height, column: inner, blur } = PICTURE
  const left = (width - inner) / 2
  const cap = height * 0.22
  const [first, middle, high] = column.tones
  // The middle's foot is --live, as the mark's dots are, when the window says what that is.
  const low = live !== undefined && first === toneOf(0)[0] ? live : first
  const fill = context.createLinearGradient(0, height, 0, 0)
  fill.addColorStop(0, low)
  fill.addColorStop(0.34, middle)
  fill.addColorStop(0.66, high)
  fill.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.clearRect(0, 0, width, height)
  context.filter = `blur(${blur}px)`
  context.fillStyle = fill
  context.beginPath()
  // Past the bottom, so the blur doesn't lift it off the floor; round at the top.
  context.moveTo(left, height + blur * 3)
  context.lineTo(left, cap)
  context.ellipse(left + inner / 2, cap, inner / 2, cap, 0, Math.PI, 0)
  context.lineTo(left + inner, height + blur * 3)
  context.closePath()
  context.fill()
}

/** A tile of fine grain, drawn once, faint dark and light specks, for over the light. */
export const drawGrain = (context: CanvasRenderingContext2D, size: number, random: () => number = Math.random) => {
  const image = context.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = random() < 0.5 ? 0 : 255
    image.data.set([v, v, v, Math.round(random() * 22)], i * 4)
  }
  context.putImageData(image, 0, 0)
}
