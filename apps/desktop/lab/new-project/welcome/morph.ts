/*
 * A step morphing into the next: each piece marked `data-morph="key"` on the
 * page before goes into the piece with the same key on the page after; what
 * has no match fades out, and what's new fades in. Nothing blurs.
 *
 * - Words move and scale to where their match stands, at its size, the old
 *   clearing before the new comes in, so they never read over each other.
 * - A box (`data-morph-as="box"`) is a container transform: its surface
 *   reshapes into its match's, and what's in it gives way to what's in the
 *   match, inside it.
 *
 * Every moving thing is a still copy on a layer of its own, moved only by
 * transform and opacity, so the compositor draws each frame; the page is
 * read once before the change and once after it, and written once.
 *
 * Words marked `data-morph-at="center"` meet their match by their centres,
 * as a centred title does; otherwise by their text's top left.
 */

export type Piece = {
  key: string
  el: HTMLElement
  box: DOMRect
  /** Where its text stands, which is what's lined up. */
  ink: DOMRect
  font: number
  center: boolean
  surface: boolean
}

/** What's marked to morph within `root`, where each stands, and how big its type is. */
export const piecesIn = (root: Element): Piece[] =>
  [...root.querySelectorAll<HTMLElement>('[data-morph]')].map((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const ink = range.getBoundingClientRect()
    return {
      key: el.dataset.morph ?? '',
      el,
      box: el.getBoundingClientRect(),
      ink: ink.width > 0 ? ink : el.getBoundingClientRect(),
      font: Number.parseFloat(getComputedStyle(el).fontSize) || 16,
      center: el.dataset.morphAt === 'center',
      surface: el.dataset.morphAs === 'box',
    }
  })

/** Ends the entrances of what just came in (its blur-ins), so it stands as it will; what loops keeps going. */
export const settle = (root: HTMLElement) => {
  for (const one of root.getAnimations({ subtree: true })) {
    if (one.effect?.getComputedTiming().iterations !== Infinity) one.finish()
  }
}

const BARE: Partial<CSSStyleDeclaration> = {
  position: 'static',
  display: 'block',
  width: 'auto',
  height: 'auto',
  minHeight: '0',
  maxWidth: 'none',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'none',
  boxShadow: 'none',
  transform: 'none',
  filter: 'none',
  opacity: '1',
  overflow: 'visible',
  containerType: 'normal',
}

type Part = 'whole' | 'surface' | 'inside'

/**
 * A still copy of `el` (all of it, only its surface, or only what's in it),
 * at its box within what's at `at`, on a layer of its own marked `ghost`. It
 * sits in bare copies of what `el` sat in, up to the nearest
 * `data-morph-root`, so the styles it takes from them still hold.
 */
export const copyOf = (el: HTMLElement, box: DOMRect, at: DOMRect, ghost: string, part: Part = 'whole'): HTMLElement => {
  let copy = el.cloneNode(part !== 'surface') as HTMLElement
  copy.querySelectorAll('[id]').forEach((one) => one.removeAttribute('id'))
  copy.removeAttribute('id')
  Object.assign(copy.style, { width: `${box.width}px`, height: `${box.height}px`, margin: '0', visibility: 'visible' })
  if (part === 'inside') Object.assign(copy.style, { background: 'none', boxShadow: 'none', borderColor: 'transparent' })
  for (let up = el.parentElement; up !== null && !up.hasAttribute('data-morph-root'); up = up.parentElement) {
    const shell = up.cloneNode(false) as HTMLElement
    shell.removeAttribute('id')
    Object.assign(shell.style, BARE)
    shell.append(copy)
    copy = shell
  }
  const layer = document.createElement('div')
  layer.className = ghost
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  Object.assign(layer.style, {
    left: `${box.left - at.left}px`,
    top: `${box.top - at.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transformOrigin: '0 0',
  })
  layer.append(copy)
  return layer
}

const move = (x: number, y: number, sx: number, sy = sx) => `translate(${x}px, ${y}px) scale(${sx}, ${sy})`

/** The point of some words that meets their match. */
const anchor = (one: Piece, center: boolean) =>
  center ? { x: one.ink.left + one.ink.width / 2, y: one.ink.top + one.ink.height / 2 } : { x: one.ink.left, y: one.ink.top }

/** Takes a copy of `from`'s words, at its box, to where `to`'s stand, at their size. */
const wordsOnto = (from: Piece, to: Piece, center: boolean) => {
  const scale = to.font / from.font
  const a = anchor(from, center)
  const b = anchor(to, center)
  return move(b.x - from.box.left - scale * (a.x - from.box.left), b.y - from.box.top - scale * (a.y - from.box.top), scale)
}

/** Takes a copy of `from`'s surface onto `to`'s, stretched to it. */
const surfaceOnto = (from: DOMRect, to: DOMRect) =>
  move(to.left - from.left, to.top - from.top, to.width / from.width, to.height / from.height)

/** Takes a copy of what's in `from` to `to`'s top left, as large as it fits there. */
const insideOnto = (from: DOMRect, to: DOMRect) =>
  move(to.left - from.left, to.top - from.top, Math.min(to.width / from.width, to.height / from.height))

export type Pace = { length: number; easing: string; out: number; inAt: number; inFor: number }

/** The old clearing, then the new coming in: hardly ever both at once. */
const OUT = [{ opacity: 1 }, { opacity: 0, offset: 0.38 }, { opacity: 0 }]
const IN = [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.8 }, { opacity: 1 }]
/** A surface stays whole while it reshapes, the new one taking over halfway. */
const SURFACE_OUT = [{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0, offset: 0.65 }, { opacity: 0 }]
const SURFACE_IN = [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }]

/**
 * Morphs each pair. A copy of the piece before goes to where its match
 * stands as it clears, and a copy of the match comes from where the piece
 * stood as it comes in; the match itself is hidden till they land. Returns
 * what it laid down and hid, and the moves to wait for.
 */
export const morphPairs = (pairs: ReadonlyArray<{ a: Piece; b: Piece }>, holder: HTMLElement, at: DOMRect, ghost: string, pace: Pace) => {
  const laid: HTMLElement[] = []
  const hidden: HTMLElement[] = []
  const moves: Animation[] = []
  const glide = { duration: pace.length, easing: pace.easing, fill: 'both' } as const
  const fade = { duration: pace.length, easing: 'linear', fill: 'both' } as const
  /** Lays a copy down and runs it from one place to another, fading as `opacity` says. */
  const run = (copy: HTMLElement, from: string, to: string, opacity: Keyframe[]) => {
    holder.append(copy)
    laid.push(copy)
    moves.push(copy.animate([{ transform: from }, { transform: to }], glide))
    copy.animate(opacity, fade)
  }
  for (const { a, b } of pairs) {
    b.el.style.visibility = 'hidden'
    hidden.push(b.el)
    if (a.surface || b.surface) {
      run(copyOf(a.el, a.box, at, ghost, 'surface'), 'none', surfaceOnto(a.box, b.box), SURFACE_OUT)
      run(copyOf(b.el, b.box, at, ghost, 'surface'), surfaceOnto(b.box, a.box), 'none', SURFACE_IN)
      run(copyOf(a.el, a.box, at, ghost, 'inside'), 'none', insideOnto(a.box, b.box), OUT)
      run(copyOf(b.el, b.box, at, ghost, 'inside'), insideOnto(b.box, a.box), 'none', IN)
    } else {
      const center = a.center || b.center
      run(copyOf(a.el, a.box, at, ghost), 'none', wordsOnto(a, b, center), OUT)
      run(copyOf(b.el, b.box, at, ghost), wordsOnto(b, a, center), 'none', IN)
    }
  }
  return { laid, hidden, moves }
}
