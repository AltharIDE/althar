import { clamp, type Column, jitter, PICTURE } from '@althar/ui/opening'

/*
 * The site's light: Althar's columns, graded as the app's light is
 * (foundations/Light): cobalt in the middle, brighter blues either side of
 * it, then sky, pale and warm at the edges. The first screen raises it
 * with its words white inside it.
 */

export type Tones = readonly [string, string, string]

/**
 * The light's colours, bottom to top, by how far a column is from the middle,
 * as the app's light has them (foundations/Light: columns.ts), with one
 * difference: its cobalt heart is as wide as `heart` (0 to 1) and stays deep
 * most of the way up, so white words read in it. Out from the heart, the
 * app's own sky and pale, and its warm in the outer fifth.
 */
export const tonesOf = (d: number, heart: number): Tones => {
  const u = d / heart
  if (u < 0.5) return ['#2b3bff', '#3042ff', '#6372ff']
  if (u < 1) return ['#3550ff', '#4a6cff', '#9fb4ff']
  if (d < heart + 0.12) return ['#5aa2ff', '#a2cfff', '#e6f1ff']
  if (d < Math.max(0.8, heart + 0.2)) return ['#9fc6ff', '#d4e6ff', '#f3f7ff']
  // The app's warm, a touch softer.
  return ['#ffc4a6', '#ffdeca', '#fff5ee']
}

/** How tall a column stands, as a share of the page: flat across the heart, then falling away, an arch. */
export const heightOf = (column: Column, heart: number) =>
  (0.3 + 0.36 * Math.exp(-(Math.max(0, column.d - heart * 0.74) ** 2) * 7)) * (0.94 + 0.06 * jitter(column.i))

/** Where a column's colours change, up its height: strong to 55%, its high tone at 90%, gone at its top. */
export const STOPS = [0.55, 0.9, 1] as const

/**
 * How finely a column is drawn, 2 to 3: the app's picture (PICTURE) is sized
 * for a window, and stretched across a page its round top shows its pixels
 * as steps. Here the picture is this many times finer, by how wide the
 * column is on the screen, its blur and shape scaled with it: soft in the
 * same proportion as the app's, a smooth ramp at any stretch, and still
 * small enough to draw once.
 */
export const finenessOf = (canvas: HTMLCanvasElement) =>
  clamp(Math.ceil((canvas.clientWidth * (window.devicePixelRatio || 1)) / PICTURE.width), 2, 3)

/**
 * A box blur along `line` into `out`, of radius `r`. Before its start there
 * is nothing; past its end, if it `stands` on it, it goes on as it ended.
 */
const boxBlur = (line: Float32Array, out: Float32Array, r: number, stands: boolean) => {
  const n = line.length
  const last = stands ? line[n - 1]! : 0
  const at = (i: number) => (i < 0 ? 0 : i >= n ? last : line[i]!)
  let sum = 0
  for (let i = 0; i <= r; i++) sum += at(i)
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * r + 1)
    sum += at(i + r + 1) - at(i - r)
  }
}

/**
 * The columns' shape, soft already: black, its softness in its alpha. One
 * for all of them at a fineness, as they differ only in colour. The app
 * blurs its shape with the canvas's own filter, which Safari doesn't draw,
 * so its columns there stood hard-edged with stepped tops; the blur is done
 * here instead, the same everywhere: three box blurs each way, as near as
 * makes no difference to the app's Gaussian of the same radius.
 */
const shapes = new Map<number, HTMLCanvasElement>()
const shapeAt = (fineness: number) => {
  const had = shapes.get(fineness)
  if (had) return had
  const width = PICTURE.width * fineness
  const height = PICTURE.height * fineness
  const inner = PICTURE.column * fineness
  const blur = PICTURE.blur * fineness
  const shape = document.createElement('canvas')
  shape.width = width
  shape.height = height
  const context = shape.getContext('2d')
  if (!context) return shape
  const left = (width - inner) / 2
  const cap = height * 0.22
  context.beginPath()
  // To the floor, so the blur doesn't lift it off it; round at the top.
  context.moveTo(left, height)
  context.lineTo(left, cap)
  context.ellipse(left + inner / 2, cap, inner / 2, cap, 0, Math.PI, 0)
  context.lineTo(left + inner, height)
  context.closePath()
  context.fill()
  const image = context.getImageData(0, 0, width, height)
  const alpha = new Float32Array(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[i * 4 + 3]!
  const line = new Float32Array(Math.max(width, height))
  const blurred = new Float32Array(Math.max(width, height))
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) line[x] = alpha[y * width + x]!
      boxBlur(line.subarray(0, width), blurred, blur, false)
      for (let x = 0; x < width; x++) alpha[y * width + x] = blurred[x]!
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) line[y] = alpha[y * width + x]!
      boxBlur(line.subarray(0, height), blurred, blur, true)
      for (let y = 0; y < height; y++) alpha[y * width + x] = blurred[y]!
    }
  }
  for (let i = 0; i < alpha.length; i++) image.data[i * 4 + 3] = Math.round(alpha[i]!)
  context.putImageData(image, 0, 0)
  shapes.set(fineness, shape)
  return shape
}

/**
 * A column drawn once, soft already, as the launch draws its own
 * (foundations/Light), in this light's colours, at the fineness its place
 * on the screen asks: the canvas is sized to the picture here. The shared
 * shape, coloured bottom to top.
 */
export const drawColumn = (canvas: HTMLCanvasElement, tones: Tones, fineness = finenessOf(canvas)) => {
  const width = PICTURE.width * fineness
  const height = PICTURE.height * fineness
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  const fill = context.createLinearGradient(0, height, 0, 0)
  fill.addColorStop(0, tones[0])
  fill.addColorStop(STOPS[0], tones[1])
  fill.addColorStop(STOPS[1], tones[2])
  fill.addColorStop(STOPS[2], 'rgba(255, 255, 255, 0)')
  context.clearRect(0, 0, width, height)
  context.drawImage(shapeAt(fineness), 0, 0)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = fill
  context.fillRect(0, 0, width, height)
}
