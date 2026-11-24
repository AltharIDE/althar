import { keyChord, type NativeAction, type NativeFrame } from '../../computer/protocol'

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

/** Chords the system takes whichever app is in front, so they never reach Althar’s window: Spotlight and the app switcher. */
const SYSTEM_CHORDS = new Set(['cmd+space', 'cmd+tab', 'cmd+shift+tab'])

/**
 * Whole-display access must leave Althar’s own controls, and the system’s, to a person: what keeps an input to the display off
 * them, said so a task can do it another way. A point goes anywhere but on Althar’s windows and the menu bar, which holds
 * Althar’s menu and the system’s (shutting down, locking, Control Center); keys and typing go to the app in front, so they
 * wait while Althar is, but for the system’s own chords.
 */
export const displayInputProblem = (
  action: NativeAction,
  frame: NativeFrame | undefined,
  display: Rectangle,
  protectedWindows: ReadonlyArray<Rectangle>,
  altharInFront: boolean,
  /** The menu bar across the top of the display, where the system has one (macOS), in the display’s points. */
  menuBar?: Rectangle,
): string | undefined => {
  const at = 'at' in action && action.at !== undefined && 'x' in action.at ? action.at : undefined
  const start = action.op === 'drag' ? action.from : at
  if (altharInFront && (action.op === 'key' || action.op === 'type')) {
    const chord = action.op === 'key' ? keyChord(action.keys) : null
    if (chord === null || !SYSTEM_CHORDS.has([...chord.modifiers.toSorted(), chord.key].join('+')))
      return 'Althar’s window is in front, so keys and typing to "desktop" would reach it. Bring the app forward first: click it in the Dock, or open it with Spotlight (key ["cmd","space"]); or send the keys to the app’s window with foreground: true.'
  }
  if (action.op === 'key') return undefined
  if (frame === undefined || frame.width <= 0 || frame.height <= 0)
    return 'Observe "desktop" first: input to the display is placed on its latest screenshot.'
  if (start === undefined) return undefined
  const point = (one: Point) => ({
    x: display.x + (one.x * display.width) / frame.width,
    y: display.y + (one.y * display.height) / frame.height,
  })
  const first = point(start)
  const last = action.op === 'drag' ? point(action.to) : first
  const over = (window: Rectangle) =>
    Math.min(first.x, last.x) < window.x + window.width &&
    Math.max(first.x, last.x) >= window.x &&
    Math.min(first.y, last.y) < window.y + window.height &&
    Math.max(first.y, last.y) >= window.y
  if (menuBar !== undefined && menuBar.height > 0 && over(menuBar))
    return 'That point is on the menu bar, which stays the person’s: Althar’s menu and the system’s are there. Use the app’s window as target, or its keyboard shortcuts.'
  return protectedWindows.some(over)
    ? 'That point is on Althar’s own window, which stays the person’s. Pick a point outside it, or use the app’s window as target.'
    : undefined
}
