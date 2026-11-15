import { EASE_OUT, reducedMotion } from '../../lib/motion'
import { springEasing } from '../../lib/spring'

/*
 * What a merge feels like, as the visual answer a phone gives with a tap
 * under the finger: pressed, Merge gives and springs back, a ring spreads
 * from it and a check draws in where its words were; going into its queue,
 * that check gathers into a dot that goes up into where the merge now
 * stands; landing, that place fills, a small burst of marks leaves it, and
 * the card gives a pixel and a half, a thump. Many landing at once stay
 * calm: the first after a quiet spell plays in full, the rest settle one
 * after another. With less motion asked for, nothing travels or grows: what
 * comes and goes fades. Each is the browser's own animation, of transform
 * and opacity (a check's stroke drawing in aside), gone once it has played.
 */

const timing = (response: number, damping: number) => {
  const { easing, duration } = springEasing(response, damping, 32)
  return { easing, duration }
}
/** A press let go: back from under the pointer, a hair past where it was, still. */
const GIVE = timing(0.26, 0.42)
/** What arrives settles: a stop filling, words landing. */
const POP = timing(0.34, 0.55)
/** Going up into its place: the kit's --move, a touch slower. */
const FLY = timing(0.36, 0.84)
/** How far a ring spreads past what it rings. */
const SPREAD = { press: 9, card: 7 }
/** Landings closer than this after another are quiet: one celebrates, the rest settle. */
const CALM = 3000
/** Landings this close together came in one read: they settle one after another, down the page. */
const BATCH = 120
const STAGGER = 90
/** A press is answered where it was made, or by the card it went with: not one that comes long after, pressed elsewhere. */
export const ANSWERS_WITHIN = 1000

export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** How the pressed Merge looked, to gather it into a dot after it has gone. */
export interface Look {
  readonly background: string
  readonly color: string
  readonly radius: string
}

/** The signal Merge's own, where it went before its look was read. */
export const SIGNAL: Look = { background: 'var(--signal-fill)', color: 'var(--on-signal)', radius: '6px' }

/** Whether it can move: a browser's element, not a test's. */
const moves = (el: Element) => typeof el.animate === 'function'

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

const gone = (animation: Animation, el: Element) => {
  void animation.finished.then(
    () => el.remove(),
    () => el.remove(),
  )
}

/** Where an element is, in its layer's own room. */
export const boxIn = (el: Element, layer: Element): Box => {
  const a = el.getBoundingClientRect()
  const b = layer.getBoundingClientRect()
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }
}

const middle = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** A mark in the layer, over a box, with its own class: a ring, the pressed Merge, a dot, a spark. */
function mark(layer: HTMLElement, className: string, b: Box, tag = 'span'): HTMLElement {
  const el = document.createElement(tag)
  el.className = className
  Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` })
  layer.append(el)
  return el
}

const fadeIn = (el: Element, delay = 0) => {
  if (moves(el)) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay, easing: EASE_OUT, fill: 'backwards' })
}

/** Its strokes drawn in, start to end; with less motion, faded in. */
function drawIn(svg: Element | null, reduce: boolean, delay: number, duration: number) {
  if (svg === null) return
  for (const path of svg.querySelectorAll('path, polyline')) {
    if (!moves(path)) continue
    if (reduce) {
      fadeIn(path, delay)
      continue
    }
    path.setAttribute('pathLength', '1')
    path.animate(
      [
        { strokeDasharray: '1 1', strokeDashoffset: 1 },
        { strokeDasharray: '1 1', strokeDashoffset: 0 },
      ],
      { duration, delay, easing: EASE_OUT, fill: 'backwards' },
    )
  }
}

/** A ring the size of what it rings and `grow` past it: from its edge outward, fading as it goes. */
function spread(ring: HTMLElement, w: number, h: number, grow: number): Animation | null {
  if (!moves(ring)) return null
  return ring.animate(
    [
      { transform: `scale(${w / (w + 2 * grow)}, ${h / (h + 2 * grow)})`, opacity: 0.85 },
      { transform: 'none', opacity: 0 },
    ],
    { duration: 520, easing: EASE_OUT },
  )
}

/**
 * The press, answered where Merge was: it gives and springs back, a ring
 * spreads from it, and its check draws in. With less motion, the check fades
 * in and nothing else moves.
 */
export function answerPress(pressed: HTMLElement, ring: HTMLElement | null, check: Element | null) {
  const reduce = reducedMotion()
  drawIn(check, reduce, 40, 240)
  if (reduce || !moves(pressed)) return
  pressed.animate([{ transform: 'scale(0.94)' }, { transform: 'none' }], GIVE)
  if (ring !== null) spread(ring, pressed.offsetWidth, pressed.offsetHeight, SPREAD.press)
}

/**
 * Merge's presses not answered yet by a card that moved as it was pressed: a
 * board card goes from Needs you to At work at once, and the card it is there
 * answers the press it went with.
 */
const presses: number[] = []

/** Merge pressed, to be answered by the card it moves with, where it moves at once. */
export function notePress(now = performance.now()) {
  presses.push(now)
}

/** Whether Merge was pressed just now with nothing answering it yet: the card that takes it answers it. */
export function takePress(now = performance.now()): boolean {
  while (presses.length > 0 && now - (presses[0] ?? now) > ANSWERS_WITHIN) presses.shift()
  return presses.shift() !== undefined
}

/**
 * Once it shows where it is: a card going to another lane waits there unseen
 * while a copy of it travels (ListMotion), so what it plays waits for it to
 * arrive. Gone meanwhile, or still unseen a while later, nothing plays.
 */
function whenShown(el: HTMLElement, then: () => void, within = 1200) {
  const until = performance.now() + within
  const look = () => {
    if (!el.isConnected) return
    if (getComputedStyle(el).visibility !== 'hidden') then()
    else if (performance.now() < until) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}

/** A ring around the whole card, where its whole strip is Merge: a board card's, as it arrives where it went. */
export function ringCard(card: HTMLElement, layer: HTMLElement, ringClass: string) {
  if (reducedMotion() || !moves(card)) return
  whenShown(card, () => spreadAround(card, layer, ringClass))
}

function spreadAround(card: HTMLElement, layer: HTMLElement, ringClass: string) {
  const grow = SPREAD.card
  const b = boxIn(card, layer)
  const ring = mark(layer, ringClass, { x: b.x - grow, y: b.y - grow, w: b.w + 2 * grow, h: b.h + 2 * grow })
  const radius = Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 10
  ring.style.borderRadius = `${radius + grow}px`
  const spreading = spread(ring, b.w, b.h, grow)
  if (spreading === null) ring.remove()
  else gone(spreading, ring)
}

const SVG = 'http://www.w3.org/2000/svg'
/** A check, as the kit's icon draws it. */
function check(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'M5 13L9 17L19 7')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2.2')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

/** Where the merge goes into its place: a stop's knot, at its middle; words, at their start, held back until it comes. */
export interface Aim {
  readonly x: number
  readonly y: number
  /** How big the dot ends. */
  readonly size: number
}

export interface Marks {
  readonly ghost: string
  readonly dot: string
}

/**
 * The pressed Merge, where it was, gathers into a dot that goes up into
 * where the merge now stands, and is gone. With less motion, it only fades
 * where it was. Resolves as the dot arrives.
 */
export async function flyIn(layer: HTMLElement, from: Box, look: Look, to: Aim, classes: Marks): Promise<void> {
  const ghost = mark(layer, classes.ghost, from)
  Object.assign(ghost.style, { background: look.background, color: look.color, borderRadius: look.radius })
  ghost.append(check(15))
  if (reducedMotion() || !moves(ghost)) {
    if (moves(ghost)) gone(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_OUT, fill: 'forwards' }), ghost)
    else ghost.remove()
    return
  }
  const d = Math.max(8, Math.min(22, from.h - 4))
  // Under its place, where the button reaches there; else its middle.
  const at = Math.min(Math.max(to.x - from.x, d / 2 + 2), from.w - d / 2 - 2)
  ghost.style.transformOrigin = `${at}px 50%`
  const gather = ghost.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `scale(${d / from.w}, ${d / from.h})`, opacity: 0 },
    ],
    { duration: 200, easing: EASE_OUT, fill: 'forwards' },
  )
  gone(gather, ghost)
  const dot = mark(layer, classes.dot, { x: from.x + at - d / 2, y: from.y + from.h / 2 - d / 2, w: d, h: d })
  dot.style.background = look.background
  dot.animate(
    [
      { transform: 'scale(0.6)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 200, easing: EASE_OUT, fill: 'backwards' },
  )
  await gather.finished.catch(() => undefined)
  const dx = to.x - (from.x + at)
  const dy = to.y - (from.y + from.h / 2)
  dot.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.size / d})` }], { ...FLY, fill: 'forwards' })
  // It is there most of the way in, well before the spring has settled.
  await wait(FLY.duration * 0.42)
  gone(dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_OUT, fill: 'forwards' }), dot)
}

/** Words that say where it stands, kept out of sight while the dot goes to them. */
export function holdBack(words: HTMLElement): Animation | null {
  if (!moves(words)) return null
  return words.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 3000, fill: 'forwards' })
}

/** Where it stands now answers the dot: a knot gives a tick; words come in from where it came. */
export function arrive(target: HTMLElement, held: Animation | null) {
  held?.cancel()
  if (!moves(target)) return
  if (reducedMotion()) {
    if (target.dataset.mergeTarget === 'words') fadeIn(target)
    return
  }
  if (target.dataset.mergeTarget === 'words')
    target.animate(
      [
        { transform: 'translateX(-5px)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 260, easing: EASE_OUT },
    )
  else
    target.animate([{ transform: 'none' }, { transform: 'scale(1.3)', offset: 0.3 }, { transform: 'none' }], {
      duration: 380,
      easing: EASE_OUT,
    })
}

/** A few marks thrown out from a point and gone: strokes and dots, in violet, green and ink. */
function burst(layer: HTMLElement, at: { x: number; y: number }, spark: string, reach: number, delay: number) {
  const colors = ['var(--signal)', 'var(--ok)', 'var(--t-1)', 'var(--signal)', 'var(--ok)']
  const n = 11
  for (let i = 0; i < n; i++) {
    const angle = (360 / n) * i - 90 + (Math.random() * 16 - 8)
    const far = reach * (0.75 + Math.random() * 0.45)
    const dot = i % 3 === 2
    const el = mark(layer, spark, { x: at.x, y: at.y - (dot ? 1.5 : 0.875), w: dot ? 3 : 7, h: dot ? 3 : 1.75 }, 'i')
    el.style.background = colors[i % colors.length] ?? 'var(--signal)'
    gone(
      el.animate(
        [
          { transform: `rotate(${angle}deg) translateX(6px) scaleX(0.3)`, opacity: 1 },
          { transform: `rotate(${angle}deg) translateX(${far * 0.8}px) scaleX(1)`, opacity: 1, offset: 0.45 },
          { transform: `rotate(${angle}deg) translateX(${far}px) scaleX(0.5)`, opacity: 0 },
        ],
        { duration: 560 + Math.random() * 140, delay, easing: EASE_OUT, fill: 'backwards' },
      ),
      el,
    )
  }
}

/**
 * It landed: where it stands fills, from smaller to a hair past and still,
 * its check drawing in; loud, a small burst leaves it and the card gives a
 * pixel and a half under it. With less motion, it fades in, and that is all.
 */
export function land(card: HTMLElement, layer: HTMLElement, target: HTMLElement, loud: boolean, delay: number, spark: string) {
  if (!moves(target)) return
  const reduce = reducedMotion()
  const words = target.dataset.mergeTarget === 'words'
  const svg = target.querySelector('svg')
  drawIn(svg, reduce, delay + 80, 280)
  if (reduce) {
    fadeIn(target, delay)
    return
  }
  const from = words ? 0.86 : loud ? 0.3 : 0.5
  target.animate(
    [
      { transform: `scale(${from})`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ],
    { ...POP, delay, fill: 'backwards' },
  )
  if (!loud) return
  const at = middle(boxIn(words && svg !== null ? svg : target, layer))
  burst(layer, at, spark, words ? 20 : 22, delay)
  if (moves(card))
    card.animate([{ transform: 'none' }, { transform: 'translateY(1.5px)', offset: 0.16 }, { transform: 'none' }], {
      duration: 420,
      delay,
      easing: EASE_OUT,
      composite: 'add',
    })
}

/**
 * Whether each landing is loud, and how long it waits: the first seen after
 * a quiet spell plays in full, those after it settle quietly; those read at
 * once settle one after another. One landing nobody can see is quiet and
 * leaves the spell as it was.
 */
export function landings(now: () => number = () => performance.now()) {
  let last = Number.NEGATIVE_INFINITY
  let start = Number.NEGATIVE_INFINITY
  let n = 0
  return (seen: boolean): { loud: boolean; delay: number } => {
    const at = now()
    if (at - start > BATCH) {
      start = at
      n = 0
    } else n += 1
    const delay = Math.min(n, 6) * STAGGER
    if (!seen) return { loud: false, delay }
    const loud = at - last > CALM
    last = at
    return { loud, delay }
  }
}

/** The window's own: every card's landings, one spell. */
export const landing = landings()

/** Whether a card is where the person can see it: on screen, in a window showing. */
export const inView = (card: Element) => {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return false
  const r = card.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

/**
 * Keeps the card as tall as it was while the pointer is on it, so what went
 * from it doesn't pull the rest up under the pointer: it lets go as the
 * pointer leaves.
 */
export function holdHeight(card: HTMLElement, height: number) {
  if (height <= card.offsetHeight || !card.matches(':hover')) return
  card.style.minHeight = `${height}px`
  card.addEventListener('pointerleave', () => letGo(card), { once: true })
}

export function letGo(card: HTMLElement) {
  card.style.minHeight = ''
}
