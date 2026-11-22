import type { NativeAction, NativeFrame } from '../../computer/protocol'

interface Rectangle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Point {
  readonly x: number
  readonly y: number
}

/** Whole-display access must leave Althar’s own controls to a person. */
export const displayInputSafe = (
  action: NativeAction,
  frame: NativeFrame | undefined,
  display: Rectangle,
  protectedWindows: ReadonlyArray<Rectangle>,
): boolean => {
  if (frame === undefined || frame.width <= 0 || frame.height <= 0) return false
  const at = 'at' in action && action.at !== undefined && 'x' in action.at ? action.at : undefined
  const start = action.op === 'drag' ? action.from : at
  if (start === undefined) return true
  const point = (one: Point) => ({
    x: display.x + (one.x * display.width) / frame.width,
    y: display.y + (one.y * display.height) / frame.height,
  })
  const first = point(start)
  const last = action.op === 'drag' ? point(action.to) : first
  return !protectedWindows.some(
    (window) =>
      Math.min(first.x, last.x) < window.x + window.width &&
      Math.max(first.x, last.x) >= window.x &&
      Math.min(first.y, last.y) < window.y + window.height &&
      Math.max(first.y, last.y) >= window.y,
  )
}
