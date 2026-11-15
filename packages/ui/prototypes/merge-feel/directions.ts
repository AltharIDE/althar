import type { Direction, Fx } from './feel'
import {
  boxOf,
  burst,
  checkMark,
  checkOn,
  cover,
  drawIn,
  fill,
  finish,
  ghost,
  give,
  into,
  mark,
  mid,
  out,
  pop,
  ring,
  solidBehind,
  thud,
  tick,
  underCover,
} from './fx'

/*
 * The directions, from the quietest to the boldest. Each says what happens
 * at the three moments: the press, the host taking it into its queue, and
 * it landing. All of them land quietly in a crowd: the first after a quiet
 * spell in full, the others settling one after another (feel.ts, land).
 */

const KNOT = 13

/** Where it lands, in every direction: what stands for the merge settles, and its check draws in. */
function settle(fx: Fx, from = 0.5) {
  const t = fx.target()
  if (t === null) return
  if (fx.item.place === 'outputs') {
    // Merged, with a check drawn in after it: the card's words, which say so.
    const b = boxOf(t, fx.item.layer)
    const c = mark(fx.item.layer, 'mf-mergedCheck', { x: b.x + b.w + 4, y: b.y + b.h / 2 - 6.5, w: 13, h: 13 })
    const svg = checkMark(13, 2.2)
    c.append(svg)
    pop(t, fx.reduce, 0.86)
    drawIn(svg, fx.reduce, 60, 280)
    return
  }
  pop(t, fx.reduce, from)
  drawIn(t.querySelector('svg'), fx.reduce, 80, 280)
}

/** The point where the merge goes into its place, and how big it ends. */
function aim(fx: Fx): { to: { x: number; y: number }; size: number } | null {
  const t = fx.target()
  if (t === null) return null
  const b = boxOf(t, fx.item.layer)
  if (fx.item.place === 'outputs') return { to: { x: b.x + 4, y: b.y + b.h / 2 }, size: 8 }
  return { to: mid(b), size: fx.item.place === 'thread' ? KNOT : Math.max(6, Math.min(b.w, b.h)) }
}

/** The words beside its pull request, held back until the dot has come to them. */
function holdBack(t: HTMLElement | null) {
  return t?.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 5000, fill: 'forwards' })
}
function arrive(fx: Fx, t: HTMLElement | null, held: Animation | undefined) {
  held?.cancel()
  if (t === null) return
  if (fx.item.place === 'thread') tick(t, fx.reduce, 1.3)
  else if (fx.reduce) t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 })
  else
    t.animate(
      [
        { opacity: 0, transform: 'translateX(-5px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 260, easing: 'ease-out' },
    )
}

/** The button gathers into a dot that goes up into where the merge stands. */
function goIn(fx: Fx) {
  const c = fx.bag.cover as HTMLElement | undefined
  const a = aim(fx)
  const t = fx.target()
  if (c === undefined || a === null) return
  const held = fx.item.place === 'thread' ? undefined : holdBack(t)
  void into(c, a.to, a.size, fx.reduce).then(() => arrive(fx, t, held))
}

/** A ring around what was pressed: the button, or on a board card the card, whose whole strip is the button. */
function tap(fx: Fx, button: HTMLElement | null) {
  if (button === null) return
  if (fx.item.place === 'board') {
    const card = fx.item.hold.firstElementChild as HTMLElement | null
    if (card !== null)
      ring(fx.item.layer, boxOf(card, fx.item.layer), 'var(--signal)', { radius: getComputedStyle(card).borderRadius, grow: 7 }, fx.reduce)
    return
  }
  ring(fx.item.layer, boxOf(button, fx.item.layer), 'var(--signal)', { radius: getComputedStyle(button).borderRadius, grow: 9 }, fx.reduce)
}

/** Fades the button out where it was, in place of it vanishing. */
const fadeOut = {
  beforeQueue: (fx: Fx) => {
    const b = fx.button()
    if (b !== null) fx.bag.ghost = ghost(fx.item.layer, b)
  },
  queued: (fx: Fx) => {
    const g = fx.bag.ghost as HTMLElement | undefined
    if (g !== undefined) out(g, 0, 160)
  },
}

export const NOW: Direction = {
  key: 'now',
  letter: '0',
  name: 'Now',
  idea: 'As built: the button’s own press and a spinner; the button goes and the card closes up under the pointer.',
  press: 'The button’s own press, then a spinner.',
  queue: 'The button goes; the card closes up.',
  land: 'Merge is done.',
  hold: false,
}

export const SETTLE: Direction = {
  key: 'settle',
  letter: 'A',
  name: 'Settle',
  idea: 'The least that still answers: a press with give, the button fading where it was, a check drawing in when it lands.',
  press: 'The button gives under the press and springs back.',
  queue: 'It fades where it was; Merge’s stop answers with a tick.',
  land: 'The stop fills, its check drawing in.',
  hold: true,
  onPress: (fx) => give(fx.button(), fx.reduce),
  beforeQueue: fadeOut.beforeQueue,
  onQueue: (fx) => {
    fadeOut.queued(fx)
    tick(fx.target(), fx.reduce, 1.3, 60)
  },
  onLand: (fx) => settle(fx),
}

export const CHECK: Direction = {
  key: 'check',
  letter: 'B',
  name: 'Check',
  idea: 'The button says it heard you, then goes where the merge now stands: into Merge’s stop, or beside the pull request.',
  press: 'A check draws in on the button.',
  queue: 'The button gathers into a dot that rises into Merge’s stop.',
  land: 'The stop fills from that dot, its check drawing in.',
  hold: true,
  onPress: (fx) => {
    const b = fx.button()
    if (b === null) return
    give(b, fx.reduce)
    const c = cover(fx.item.layer, b)
    checkOn(c, fx.reduce)
    underCover(b)
    fx.bag.cover = c
  },
  onQueue: goIn,
  onLand: (fx, loud) => settle(fx, loud ? 0.3 : 0.5),
}

/** Where the route's line runs into Merge, from the stop before it. */
function lineIntoMerge(fx: Fx) {
  const stops = fx.stops()
  const i = stops.findIndex((li) => li.querySelector('[class*="__what__"]')?.textContent === 'Merge')
  const before = stops[i - 1]
  if (before === undefined) return null
  const b = boxOf(before, fx.item.layer)
  return { x: b.x + 18, y: b.y + 5.5, w: b.w - 23, h: 2 }
}
/** A hairline along a card's top, where it has no route of its own. */
function edge(fx: Fx) {
  const card = fx.item.hold.firstElementChild as HTMLElement | null
  if (card === null) return null
  const b = boxOf(card, fx.item.layer)
  const r = Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 10
  return { x: b.x + r, y: b.y, w: b.w - 2 * r, h: 2 }
}

export const TRACK: Direction = {
  key: 'track',
  letter: 'C',
  name: 'Track',
  idea: 'The route does the talking: the line into Merge fills as you press, and when it lands every stop answers in turn.',
  press: 'The line into Merge fills violet; on Outputs and the board, a line along the card’s top.',
  queue: 'Merge’s stop breathes violet; the line waits at most of the way.',
  land: 'The line runs to its end and each stop ticks in turn, left to right.',
  hold: true,
  onPress: (fx) => {
    give(fx.button(), fx.reduce)
    if (fx.item.place === 'thread') {
      const box = lineIntoMerge(fx)
      const knot = fx.target()
      if (box === null || knot === null) return
      fx.bag.line = fill(fx.item.layer, box, 'var(--signal)', fx.reduce, { duration: 300 })
      const k = mark(fx.item.layer, 'mf-knot', boxOf(knot, fx.item.layer))
      k.style.background = solidBehind(knot)
      k.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 220, fill: 'backwards', easing: 'ease-out' })
      fx.bag.knot = k
      return
    }
    const box = edge(fx)
    if (box !== null) fx.bag.line = fill(fx.item.layer, box, 'var(--signal)', fx.reduce, { to: 0.7, duration: 900 })
  },
  onQueue: (fx) => {
    ;(fx.bag.knot as HTMLElement | undefined)?.classList.add('mf-waiting')
    ;(fx.bag.line as HTMLElement | undefined)?.classList.toggle('mf-waiting', fx.item.place !== 'thread')
  },
  onLand: (fx, loud) => {
    const line = fx.bag.line as HTMLElement | undefined
    const knot = fx.bag.knot as HTMLElement | undefined
    if (knot !== undefined) out(knot, 0, 200)
    if (fx.item.place === 'thread') {
      if (line !== undefined) out(line, 120, 360)
      if (loud) {
        const stops = fx.stops()
        stops.forEach((li, i) => tick(li.querySelector('[class*="__knot__"]'), fx.reduce, 1.3, i * 75))
        window.setTimeout(() => settle(fx), stops.length * 75 - 40)
      } else settle(fx)
      return
    }
    if (line !== undefined) {
      line.classList.remove('mf-waiting')
      finish(line, 0.7, fx.reduce)
      out(line, 300, 360)
    }
    settle(fx)
  },
}

export const RING: Direction = {
  key: 'ring',
  letter: 'D',
  name: 'Ring',
  idea: 'A haptic you can see: a ring spreads from what you pressed, and two green rings, a double tap, when it lands.',
  press: 'A ring spreads from the button and fades: a tap.',
  queue: 'The button fades where it was.',
  land: 'Two green rings from Merge’s stop, a double tap, as it fills.',
  hold: true,
  onPress: (fx) => {
    const b = fx.button()
    give(b, fx.reduce)
    tap(fx, b)
  },
  beforeQueue: fadeOut.beforeQueue,
  onQueue: (fx) => {
    fadeOut.queued(fx)
    tick(fx.target(), fx.reduce, 1.3, 60)
  },
  onLand: (fx, loud) => {
    settle(fx)
    const t = fx.target()
    if (!loud || t === null) return
    const b = boxOf(t, fx.item.layer)
    const words = fx.item.place === 'outputs'
    const box = words ? { x: b.x - 6, y: b.y - 3, w: b.w + 29, h: b.h + 6 } : b
    const radius = words ? '7px' : '50%'
    ring(fx.item.layer, box, 'var(--ok)', { radius, grow: words ? 7 : 11, width: 1.75 }, fx.reduce)
    ring(fx.item.layer, box, 'var(--ok)', { radius, grow: words ? 12 : 18, delay: 150, width: 1.25, duration: 600 }, fx.reduce)
  },
}

export const BURST: Direction = {
  key: 'burst',
  letter: 'E',
  name: 'Burst',
  idea: 'The bold one: the tap and the check on the press, and when it lands a small burst of marks and the card gives a little.',
  press: 'The button gives, a ring spreads, a check draws in on it.',
  queue: 'The button gathers into a dot that rises into Merge’s stop.',
  land: 'A small burst from the stop, and the card gives a pixel, a thump.',
  hold: true,
  onPress: (fx) => {
    const b = fx.button()
    if (b === null) return
    give(b, fx.reduce)
    tap(fx, b)
    const c = cover(fx.item.layer, b)
    checkOn(c, fx.reduce)
    underCover(b)
    fx.bag.cover = c
  },
  onQueue: goIn,
  onLand: (fx, loud) => {
    settle(fx, loud ? 0.3 : 0.5)
    const t = fx.target()
    if (!loud || t === null) return
    const b = boxOf(t, fx.item.layer)
    const at = fx.item.place === 'outputs' ? { x: b.x + b.w + 10.5, y: b.y + b.h / 2 } : mid(b)
    burst(fx.item.layer, at, fx.reduce, 11, fx.item.place === 'thread' ? 22 : 20)
    thud(fx.item.hold.firstElementChild as HTMLElement | null, fx.reduce)
  },
}

export const DIRECTIONS: readonly Direction[] = [NOW, SETTLE, CHECK, TRACK, RING, BURST]
