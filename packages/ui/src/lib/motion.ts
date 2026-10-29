import { springEasing } from './spring'

/** Whether the person asked their system for less motion. False where there is no window to ask. */
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** A motion as the Web Animations API takes it: how long, and on what curve. */
export interface Timing {
  readonly duration: number
  readonly easing: string
}

/** Quick off the mark, a long soft landing: what enters or answers (`--ease-out`). */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

/**
 * The motion tokens of tokens.css, for what moves from script: the same
 * names, the same values (tests/tokens keeps them so). The springs are
 * made here and written there as their `linear()` curves.
 */
export const MOTION = {
  /** Arrives or answers: an overlay, a new row (`--enter`). */
  enter: { duration: 200, easing: EASE_OUT },
  /** Goes, quicker than it came (`--exit`). */
  exit: { duration: 140, easing: EASE_OUT },
  /** On screen, going elsewhere: a reorder, a card changing lanes (`--move`, `--ease-move`); a spring that passes its place by half a percent. */
  move: spring(0.314, 0.85),
  /** A selection moving between choices (`--slide`, `--ease-slide`): a quicker spring. */
  slide: spring(0.262, 0.82),
} as const satisfies Record<string, Timing>

/** Where an overlay or a new row grows from, and what a press shrinks a button to (`--scale-pop`, `--scale-press`). */
export const SCALE = { pop: 0.96, press: 0.97 } as const

function spring(response: number, damping: number): Timing {
  const { easing, duration } = springEasing(response, damping, 24)
  return { duration, easing }
}
