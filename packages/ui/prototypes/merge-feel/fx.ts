import { springEasing } from '../../src/lib/spring'

/*
 * What the directions are made of: small motions on the kit's own elements,
 * with the browser's animations, and marks drawn in a layer over a card
 * (rings, a check, a dot, sparks), each gone when it has played. With less
 * motion asked for, nothing travels or grows: what comes and goes fades.
 */

export const OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const spring = (response: number, damping: number) => springEasing(response, damping, 32)
/** A press let go: back from under the pointer, a hair past where it was, settled. */
const TAP = spring(0.26, 0.42)
/** What arrives and settles: a stop filling, words landing. */
const POP = spring(0.34, 0.55)
/** Going somewhere on screen: the kit's --move, a touch slower. */
const MOVE = spring(0.36, 0.84)

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

/** Where an element is, in the layer's own coordinates. */
export const boxOf = (el: Element, layer: HTMLElement): Box => {
  const a = el.getBoundingClientRect()
  const b = layer.getBoundingClientRect()
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }
}
export const mid = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

const gone = (a: Animation, el: Element) => {
  void a.finished.then(
    () => el.remove(),
    () => el.remove(),
  )
}

/** A mark in the layer, over a box. */
export function mark(layer: HTMLElement, className: string, b: Box): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` })
  layer.append(el)
  return el
}

const fade = (el: Element, from: number, to: number, duration = 200, delay = 0) =>
  el.animate([{ opacity: from }, { opacity: to }], { duration, delay, easing: OUT, fill: 'both' })

/** The press let go: the button gives a little under it and springs back. */
export function give(el: HTMLElement | null, reduce: boolean, depth = 0.94) {
  if (el === null || reduce) return
  el.animate([{ transform: `scale(${depth})` }, { transform: 'scale(1)' }], TAP)
}

/** A mark that answers, once: up a little and back. */
export function tick(el: HTMLElement | null, reduce: boolean, to = 1.35, delay = 0) {
  if (el === null || reduce) return
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${to})`, offset: 0.3 }, { transform: 'scale(1)' }], {
    duration: 380,
    delay,
    easing: OUT,
  })
}

/** What arrives settles into place: from smaller, a hair past, still. Fades in only, with less motion. */
export function pop(el: HTMLElement | null, reduce: boolean, from = 0.5, delay = 0) {
  if (el === null) return
  if (reduce) {
    fade(el, 0, 1, 220, delay)
    return
  }
  el.animate(
    [
      { transform: `scale(${from})`, opacity: 0.4 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { ...POP, delay, fill: 'backwards' },
  )
}

const SVG = 'http://www.w3.org/2000/svg'
/** A check, as Iconoir draws it. */
export function checkMark(size: number, width = 2): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'M5 13L9 17L19 7')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', String(width))
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

/** Its strokes drawn in, start to end; with less motion, faded in. */
export function drawIn(svg: Element | null, reduce: boolean, delay = 0, duration = 260) {
  if (svg === null) return
  for (const path of svg.querySelectorAll('path, polyline, circle')) {
    path.setAttribute('pathLength', '1')
    if (reduce) fade(path, 0, 1, 200, delay)
    else
      path.animate(
        [
          { strokeDasharray: '1 1', strokeDashoffset: 1 },
          { strokeDasharray: '1 1', strokeDashoffset: 0 },
        ],
        {
          duration,
          delay,
          easing: OUT,
          fill: 'backwards',
        },
      )
  }
}

/** A ring that spreads from a box and fades: a tap you can see. */
export function ring(
  layer: HTMLElement,
  b: Box,
  color: string,
  o: { radius: string; grow: number; delay?: number; width?: number; duration?: number },
  reduce: boolean,
) {
  if (reduce) return
  const r = mark(layer, 'mf-ring', b)
  r.style.borderRadius = o.radius
  r.style.outline = `${o.width ?? 1.5}px solid ${color}`
  gone(
    r.animate(
      [
        { outlineOffset: '0px', opacity: 0.85 },
        { outlineOffset: `${o.grow}px`, opacity: 0 },
      ],
      {
        duration: o.duration ?? 520,
        delay: o.delay ?? 0,
        easing: OUT,
        fill: 'backwards',
      },
    ),
    r,
  )
}

/** A few marks thrown out from a point and gone: strokes and dots, in violet, green and ink. */
export function burst(layer: HTMLElement, at: Point, reduce: boolean, n = 10, reach = 22) {
  if (reduce) return
  const colors = ['var(--signal)', 'var(--ok)', 'var(--t-1)', 'var(--signal)', 'var(--ok)']
  for (let i = 0; i < n; i++) {
    const angle = (360 / n) * i - 90 + (Math.random() * 16 - 8)
    const dist = reach * (0.75 + Math.random() * 0.45)
    const dot = i % 3 === 2
    const el = document.createElement('i')
    el.className = 'mf-spark'
    Object.assign(el.style, {
      left: `${at.x}px`,
      top: `${at.y}px`,
      width: dot ? '3px' : '7px',
      height: dot ? '3px' : '1.75px',
      marginTop: dot ? '-1.5px' : '-0.875px',
      background: colors[i % colors.length],
    })
    layer.append(el)
    gone(
      el.animate(
        [
          { transform: `rotate(${angle}deg) translateX(6px) scaleX(0.3)`, opacity: 1 },
          { transform: `rotate(${angle}deg) translateX(${dist * 0.8}px) scaleX(1)`, opacity: 1, offset: 0.45 },
          { transform: `rotate(${angle}deg) translateX(${dist}px) scaleX(0.5)`, opacity: 0 },
        ],
        { duration: 560 + Math.random() * 140, easing: OUT },
      ),
      el,
    )
  }
}

/** The card gives under the landing, a pixel and a half, and is still: the thump of a haptic. */
export function thud(el: HTMLElement | null, reduce: boolean) {
  if (el === null || reduce) return
  el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(1.5px)', offset: 0.16 }, { transform: 'translateY(0)' }], {
    duration: 420,
    easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)',
  })
}

/** The first background behind an element that hides what is under it. */
export function solidBehind(el: Element): string {
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor
    const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(',')[3]
    if (bg !== '' && bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0.9)) return bg
  }
  return 'var(--paper)'
}

/** A sheet over the button, in its own colours, that the direction then changes: its words become a check. */
export function cover(layer: HTMLElement, button: HTMLElement): HTMLElement {
  const b = boxOf(button, layer)
  const cs = getComputedStyle(button)
  const c = mark(layer, 'mf-cover', b)
  c.style.borderRadius = cs.borderRadius
  c.style.background = solidBehind(button)
  c.style.color = cs.color
  return c
}

/** The button itself out of sight under its cover (still there, focused, busy), for as long as it is there. */
export function underCover(button: HTMLElement) {
  button.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 60_000, fill: 'forwards' })
}

/** The button as it looks now, words and all, held in the layer after the button itself has gone. */
export function ghost(layer: HTMLElement, button: HTMLElement): HTMLElement {
  const c = cover(layer, button)
  const cs = getComputedStyle(button)
  Object.assign(c.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: cs.justifyContent === 'normal' ? 'center' : cs.justifyContent,
    gap: cs.gap,
    padding: cs.padding,
    font: cs.font,
    letterSpacing: cs.letterSpacing,
    boxShadow: cs.boxShadow,
  })
  c.innerHTML = button.innerHTML
  return c
}

/** The check, drawn in on the button where its words were. */
export function checkOn(c: HTMLElement, reduce: boolean, size = 15) {
  const svg = checkMark(size, 2.2)
  const holder = document.createElement('span')
  holder.className = 'mf-coverCheck'
  holder.append(svg)
  c.append(holder)
  if (!reduce) c.animate([{ transform: 'scale(0.94)' }, { transform: 'scale(1)' }], TAP)
  drawIn(svg, reduce, 40, 240)
}

/**
 * The button gathers itself into a dot where it sits under its target, and
 * the dot goes up into it, shrinking to its size. With less motion, the
 * button only fades where it was. Resolves as the dot arrives.
 */
export async function into(c: HTMLElement, to: Point, size: number, reduce: boolean): Promise<void> {
  if (reduce) {
    await fade(c, 1, 0, 160).finished.catch(() => {})
    c.remove()
    return
  }
  const w = c.offsetWidth
  const h = c.offsetHeight
  const left = Number.parseFloat(c.style.left)
  const top = Number.parseFloat(c.style.top)
  const D = Math.min(22, h - 4)
  // Under its target where the button reaches there, else its middle.
  const cx = Math.min(Math.max(to.x - left, D / 2 + 2), w - D / 2 - 2)
  const radius = getComputedStyle(c).borderRadius
  const check = c.querySelector<HTMLElement>('.mf-coverCheck')
  const gather = c.animate(
    [
      { clipPath: `inset(0px 0px 0px 0px round ${radius})` },
      { clipPath: `inset(${(h - D) / 2}px ${w - cx - D / 2}px ${(h - D) / 2}px ${cx - D / 2}px round ${D / 2}px)` },
    ],
    { duration: 200, easing: OUT, fill: 'forwards' },
  )
  check?.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${cx - w / 2}px) scale(0.8)` }], {
    duration: 200,
    easing: OUT,
    fill: 'forwards',
  })
  await gather.finished.catch(() => {})
  c.style.transformOrigin = `${cx}px 50%`
  const dx = to.x - (left + cx)
  const dy = to.y - (top + h / 2)
  const travel = c.animate([{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${size / D})` }], {
    ...MOVE,
    fill: 'forwards',
  })
  // It arrives most of the way in, well before the spring has settled.
  await new Promise((done) => setTimeout(done, MOVE.duration * 0.42))
  gone(c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: OUT, fill: 'forwards' }), c)
  void travel
}

/** A line that fills from its start, over where a route's line runs. */
export function fill(
  layer: HTMLElement,
  b: Box,
  color: string,
  reduce: boolean,
  o: { to?: number; duration?: number; from?: number } = {},
) {
  const line = mark(layer, 'mf-fill', b)
  line.style.background = color
  const to = o.to ?? 1
  if (reduce) fade(line, 0, 1, 200)
  else
    line.animate([{ transform: `scaleX(${o.from ?? 0})` }, { transform: `scaleX(${to})` }], {
      duration: o.duration ?? 320,
      easing: OUT,
      fill: 'forwards',
    })
  return line
}

/** Grows a filled line on to its end. */
export function finish(line: HTMLElement, from: number, reduce: boolean) {
  if (reduce) return
  line.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], { duration: 260, easing: OUT, fill: 'forwards' })
}

/** Fades a mark out, and it is gone. */
export function out(el: Element, delay = 0, duration = 260) {
  gone(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration, delay, easing: OUT, fill: 'forwards' }), el)
}
