import { TODAY, type Offered, type Shown } from './url'

/*
 * The keys, as the bar's Keys list says them: 1–9 pick a direction (0 is
 * Today), ← and → step through them, [ and ] step through the states, S puts
 * the directions side by side and back, and H hides the bar. Side by side, a
 * direction's number takes it out of the comparison or puts it back.
 */

/** Steps through a list, round from either end. */
const around = <T>(list: readonly T[], at: T, by: number) => list[(list.indexOf(at) + by + list.length) % list.length] ?? at

/** One direction in or out of those side by side, keeping the bar's order; never the last one out. */
const toggled = (shown: Shown, offered: Offered, key: string): Shown | null => {
  const side = shown.side ?? []
  if (side.includes(key)) return side.length === 1 ? null : { ...shown, side: side.filter((one) => one !== key) }
  return { ...shown, side: offered.directions.filter((one) => one === key || side.includes(one)) }
}

/** The direction a number key names: 0 is Today, where there is one, and 1–9 the prototype's own, in order. */
const numbered = (offered: Offered, digit: number) =>
  digit === 0 ? offered.directions.find((key) => key === TODAY) : offered.directions.filter((key) => key !== TODAY)[digit - 1]

/** What a key shows next, or null where it changes nothing. */
export const step = (shown: Shown, key: string, offered: Offered): Shown | null => {
  const next = ((): Shown | null => {
    if (/^[0-9]$/.test(key)) {
      const direction = numbered(offered, Number(key))
      if (direction === undefined) return null
      return shown.side === null ? { ...shown, direction } : toggled(shown, offered, direction)
    }
    switch (key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        return shown.side === null
          ? { ...shown, direction: around(offered.directions, shown.direction, key === 'ArrowLeft' ? -1 : 1) }
          : null
      case '[':
      case ']':
        return offered.states.length < 2 ? null : { ...shown, state: around(offered.states, shown.state, key === '[' ? -1 : 1) }
      case 's':
      case 'S':
        return offered.directions.length < 2 ? null : { ...shown, side: shown.side === null ? [...offered.directions] : null }
      case 'h':
      case 'H':
        return { ...shown, bar: !shown.bar }
      default:
        return null
    }
  })()
  return next === null || same(next, shown) ? null : next
}

const same = (a: Shown, b: Shown) =>
  a.direction === b.direction &&
  a.state === b.state &&
  a.bar === b.bar &&
  (a.side ?? []).join() === (b.side ?? []).join() &&
  (a.side === null) === (b.side === null)

/** What a key press is, for whether the page takes it. */
export interface Press {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly defaultPrevented: boolean
  readonly isComposing?: boolean
  readonly target: EventTarget | null
}

/**
 * A press the page leaves alone: with ⌘, Ctrl or Alt (the prototype's own
 * shortcuts and the browser's), one something already handled (a group of
 * options moving with the arrows), or typing in a field.
 */
export const leftAlone = (press: Press) => {
  if (press.metaKey || press.ctrlKey || press.altKey || press.defaultPrevented || press.isComposing === true) return true
  const target = press.target
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}
