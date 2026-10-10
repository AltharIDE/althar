import { type Column, jitter, PICTURE } from '@althar/ui/opening'

/*
 * The site's light: Althar's columns, graded as the app's light is
 * (foundations/Light): cobalt in the middle, brighter blues either side of
 * it, then sky, a blush and warm at the edges. The first screen raises it
 * and the other pages' heads stand in it (Glow).
 */

export type Tones = readonly [string, string, string]

/**
 * The light's colours, bottom to top, by how far a column is from the middle,
 * graded as the app's light is (foundations/Light): cobalt in the middle,
 * brighter blues either side of it, then sky, pale, and warm at the edges.
 * Across the heart, where the words stand, every blue stays deep enough
 * most of the way up that white reads on it. `heart` is how wide that is,
 * 0 to 1.
 */
export const tonesOf = (d: number, heart: number): Tones => {
  const u = d / heart
  if (u < 0.34) return ['#2b3bff', '#3042ff', '#6372ff']
  if (u < 0.68) return ['#2f4cff', '#3d60ff', '#8ea6ff']
  if (u < 1) return ['#3860ff', '#4c78ff', '#adc4ff']
  if (d < heart + 0.12) return ['#4f8cff', '#86b6ff', '#d6e8ff']
  // From the sky to the warm, through a blush, as the app's light turns at its edges.
  if (d < heart + 0.22) return ['#b4b8ff', '#e6d8f2', '#fbefec']
  if (d < heart + 0.34) return ['#ffb08c', '#ffd1b6', '#fff1e8']
  return ['#ff9a73', '#ffc4a3', '#ffece2']
}

/** How tall a column stands, as a share of the page: flat across the heart, then falling away, an arch. */
export const heightOf = (column: Column, heart: number) =>
  (0.3 + 0.36 * Math.exp(-(Math.max(0, column.d - heart * 0.74) ** 2) * 7)) * (0.94 + 0.06 * jitter(column.i))

/** Where a column's colours change, up its height: strong to 55%, its high tone at 90%, gone at its top. */
export const STOPS = [0.55, 0.9, 1] as const

/** A column drawn once, soft already, as the launch draws its own (foundations/Light), in this light's colours. */
export const drawColumn = (context: CanvasRenderingContext2D, tones: Tones) => {
  const { width, height, column: inner, blur } = PICTURE
  const left = (width - inner) / 2
  const cap = height * 0.22
  const fill = context.createLinearGradient(0, height, 0, 0)
  fill.addColorStop(0, tones[0])
  fill.addColorStop(STOPS[0], tones[1])
  fill.addColorStop(STOPS[1], tones[2])
  fill.addColorStop(STOPS[2], 'rgba(255, 255, 255, 0)')
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
