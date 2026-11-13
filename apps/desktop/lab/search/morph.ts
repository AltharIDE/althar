import { type RefObject, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'

// The kit's own springs and timings (not exported from @althar/ui yet).
import { MOTION, reducedMotion, SCALE } from '../../../../packages/ui/src/lib/motion'
import { motion } from './state'

/*
 * A's morphs, on the kit's motion: what is chosen keeps its identity as it
 * goes somewhere else. A row's name lifts into the field as a chip, and
 * drops back into its row; the Tab hint slides over to become the field's
 * chip; the box's height glides; Enter carries the row's name into the
 * page it opens (the browser's view transitions). Each can turn back
 * mid-way, moves only transform and opacity (but the box's height, as the
 * kit's SizeMotion does), and with reduced motion only fades. The lab's
 * Motion switch slows them all five times, or stills them as DESIGN.md has
 * the command menu today.
 */

export const moving = () => motion.get() !== 'still'
const travels = () => moving() && !reducedMotion()

export { MOTION }

/* Slow: every animation on the page at a fifth of its pace, CSS transitions and view transitions too. */
let slowing = 0
const slowDown = () => {
  for (const one of document.getAnimations()) if (one.playbackRate === 1) one.playbackRate = 0.2
  slowing = requestAnimationFrame(slowDown)
}
const pace = () => {
  cancelAnimationFrame(slowing)
  if (motion.get() === 'slow') slowing = requestAnimationFrame(slowDown)
}
motion.subscribe(pace)
pace()

/* ——— Copies in flight, over the box ——— */

let shelf: HTMLElement | null = null
const layer = () => {
  if (shelf?.isConnected === true) return shelf
  shelf = document.createElement('div')
  shelf.className = 'ch-root'
  shelf.setAttribute('aria-hidden', 'true')
  shelf.inert = true
  Object.assign(shelf.style, { position: 'fixed', inset: '0', zIndex: 'calc(var(--z-dialog) + 2)', pointerEvents: 'none' })
  document.body.append(shelf)
  return shelf
}

/** Where some words stand, and how big they are. */
export interface Words {
  readonly rect: DOMRect
  readonly font: number
}
export const measure = (el: Element | null | undefined): Words | null => {
  if (el === null || el === undefined || el.getClientRects().length === 0) return null
  return { rect: el.getBoundingClientRect(), font: Number.parseFloat(getComputedStyle(el).fontSize) }
}

/** A chip as it stands: a copy to fly, where it is, where its words are within it. */
export interface Chip {
  readonly copy: HTMLElement
  readonly rect: DOMRect
  readonly text: DOMRect
  readonly font: number
  readonly pill: { readonly background: string; readonly radius: string }
}
export const chipOf = (el: HTMLElement | null | undefined): Chip | null => {
  if (el === null || el === undefined || el.getClientRects().length === 0) return null
  const text = el.querySelector<HTMLElement>('[data-chip-text]') ?? el
  const style = getComputedStyle(el)
  return {
    copy: el.cloneNode(true) as HTMLElement,
    rect: el.getBoundingClientRect(),
    text: text.getBoundingClientRect(),
    font: Number.parseFloat(getComputedStyle(text).fontSize),
    pill: { background: style.backgroundColor, radius: style.borderRadius },
  }
}

/** The chip, moved and scaled so its words sit where `words` stand, at their size. */
const over = (chip: Chip, words: Words) => {
  const scale = words.font / chip.font
  const x = words.rect.left - chip.rect.left - (chip.text.left - chip.rect.left) * scale
  const y = words.rect.top + (words.rect.height - chip.text.height * scale) / 2 - chip.rect.top - (chip.text.top - chip.rect.top) * scale
  return `translate(${x}px, ${y}px) scale(${scale})`
}

/** Draws the chip's copy where the chip stands, its pill a layer of its own that can fade. */
const ghost = (chip: Chip) => {
  const shell = document.createElement('div')
  Object.assign(shell.style, {
    position: 'absolute',
    left: `${chip.rect.left}px`,
    top: `${chip.rect.top}px`,
    width: `${chip.rect.width}px`,
    height: `${chip.rect.height}px`,
    transformOrigin: '0 0',
  })
  const pill = document.createElement('div')
  Object.assign(pill.style, { position: 'absolute', inset: '0', background: chip.pill.background, borderRadius: chip.pill.radius })
  const copy = chip.copy
  for (const named of [copy, ...copy.querySelectorAll('[id]')]) named.removeAttribute('id')
  Object.assign(copy.style, { position: 'absolute', inset: '0', margin: '0', background: 'transparent', boxShadow: 'none' })
  shell.append(pill, copy)
  layer().append(shell)
  return { shell, pill }
}

const hide = (el: HTMLElement) => {
  el.style.opacity = '0'
  return () => el.style.removeProperty('opacity')
}

/**
 * Something chosen becomes the field's chip: the chip, just drawn, is seen
 * leaving where the words were (a row's name, the Tab hint), growing its
 * pill on the way.
 */
export const lift = (from: Words | null, to: HTMLElement | null) => {
  if (to === null) return
  const chip = chipOf(to)
  if (chip === null) return
  if (from === null || !travels()) return arrive(to)
  const { shell, pill } = ghost(chip)
  const show = hide(to)
  const flight = shell.animate([{ transform: over(chip, from) }, { transform: 'none' }], MOTION.move)
  pill.animate([{ opacity: 0 }, { opacity: 1 }], { ...MOTION.move, duration: MOTION.move.duration * 0.6 })
  const done = () => {
    show()
    shell.remove()
  }
  flight.addEventListener('finish', done)
  flight.addEventListener('cancel', done)
}

/** The chip goes back where it came from (taken before it went): its pill fades as it lands in the words now drawn there. */
export const drop = (chip: Chip | null, to: Element | null) => {
  if (chip === null) return
  const words = to instanceof HTMLElement ? measure(to) : null
  if (words === null || !travels()) return leave(chip)
  const { shell, pill } = ghost(chip)
  const show = hide(to as HTMLElement)
  const flight = shell.animate([{ transform: 'none' }, { transform: over(chip, words) }], MOTION.move)
  pill.animate([{ opacity: 1 }, { opacity: 0 }], { ...MOTION.move, duration: MOTION.move.duration * 0.5 })
  const done = () => {
    show()
    shell.remove()
  }
  flight.addEventListener('finish', done)
  flight.addEventListener('cancel', done)
}

const GROWS_FROM = 0.86

/**
 * A chip that came from nothing (a character typed): it grows from the
 * field's start, and the words beside it (`next`) keep to its edge as it
 * grows, rather than sliding under it.
 */
export const arrive = (el: HTMLElement | null, next?: HTMLElement | null) => {
  if (el === null || !moving()) return
  const grows = !reducedMotion()
  el.animate(
    [
      { opacity: 0, transform: grows ? `scale(${GROWS_FROM})` : 'none', transformOrigin: 'left center' },
      { opacity: 1, transform: 'none', transformOrigin: 'left center' },
    ],
    MOTION.enter,
  )
  if (grows && next !== null && next !== undefined)
    next.animate([{ transform: `translateX(${-(1 - GROWS_FROM) * el.offsetWidth}px)` }, { transform: 'none' }], MOTION.enter)
}

/** A chip with nowhere to go back to: it shrinks away where it stood. */
export const leave = (chip: Chip | null) => {
  if (chip === null || !moving()) return
  const { shell } = ghost(chip)
  const grows = !reducedMotion()
  const out = shell.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: grows ? `scale(${GROWS_FROM})` : 'none' },
    ],
    { ...MOTION.exit, fill: 'forwards' },
  )
  shell.style.transformOrigin = 'left center'
  out.addEventListener('finish', () => shell.remove())
  out.addEventListener('cancel', () => shell.remove())
}

/** What stands beside a chip that came or went glides to its new place (`was`, where it was laid out), rather than jumping by the chip's width. */
export const slideFrom = (el: HTMLElement | null, was: number | null, timing: KeyframeAnimationOptions = MOTION.move) => {
  if (el === null || was === null || !travels()) return
  const now = el.offsetLeft
  if (Math.abs(was - now) < 0.5) return
  el.animate([{ transform: `translateX(${was - now}px)` }, { transform: 'none' }], timing)
}

/* ——— The box ——— */

/** The box grows open from just under its full size, and fades. */
export const open = (box: HTMLElement | null, scrim: HTMLElement | null) => {
  if (box === null || !moving()) return
  const grows = !reducedMotion()
  box.animate(
    [
      { opacity: 0, scale: grows ? `${SCALE.pop}` : '1' },
      { opacity: 1, scale: '1' },
    ],
    MOTION.enter,
  )
  scrim?.animate([{ opacity: 0 }, { opacity: 1 }], MOTION.enter)
}

/** Whether the box is leaving by a view transition, which draws its going itself. */
const handing = { now: false }

/**
 * Closed, the box is gone from the page at once (the app unmounts it): the
 * same elements are put back for a moment to fade out, quicker than they came.
 */
export const close = (box: HTMLElement | null, scrim: HTMLElement | null) => {
  if (box === null || !moving() || handing.now) return
  const parent = box.parentElement
  queueMicrotask(() => {
    // Still there (React's strict mode trying the effect again): nothing went.
    if (box.isConnected || parent === null) return
    for (const one of [scrim, box]) {
      if (one === null) continue
      one.inert = true
      one.style.pointerEvents = 'none'
      parent.append(one)
    }
    const shrinks = !reducedMotion()
    const out = box.animate([{ opacity: 1 }, { opacity: 0, scale: shrinks ? '0.98' : '1' }], { ...MOTION.exit, fill: 'forwards' })
    scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { ...MOTION.exit, fill: 'forwards' })
    const gone = () => {
      box.remove()
      scrim?.remove()
    }
    out.addEventListener('finish', gone)
    out.addEventListener('cancel', gone)
  })
}

/** The box's height glides to what it now lists, from where it is drawn, as the kit's SizeMotion does. */
export const useGlide = (outer: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>) => {
  useLayoutEffect(() => {
    const box = outer.current
    const content = inner.current
    if (box === null || content === null || typeof ResizeObserver === 'undefined') return
    let was: number | null = null
    let glide: Animation | null = null
    const observer = new ResizeObserver(() => {
      const to = content.offsetHeight
      const from = glide === null ? was : box.offsetHeight
      was = to
      if (from === null || Math.abs(from - to) < 1 || !travels()) return
      glide?.cancel()
      const run = box.animate([{ height: `${from}px` }, { height: `${to}px` }], MOTION.move)
      glide = run
      const done = () => {
        if (glide === run) glide = null
      }
      run.addEventListener('finish', done)
      run.addEventListener('cancel', done)
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      glide?.cancel()
    }
  }, [outer, inner])
}

/* ——— Into the page ——— */

const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Where the page names what was opened: its title, once it is drawn. */
const named = (wanted: string, within: number) =>
  new Promise<HTMLElement | null>((resolve) => {
    const want = squash(wanted)
    const began = performance.now()
    const look = () => {
      const hits = [...document.querySelectorAll<HTMLElement>('h1, h1 *, h2, [role="heading"]')].filter(
        (el) => el.closest('[role="dialog"]') === null && el.getClientRects().length > 0 && squash(el.textContent) === want,
      )
      // The innermost: the words themselves, not the bar they are in.
      const hit = hits.find((el) => !hits.some((other) => other !== el && el.contains(other)))
      if (hit !== undefined) return resolve(hit)
      if (performance.now() - began > within) return resolve(null)
      // Rendering waits while the page changes under a view transition: a timer, not a frame.
      setTimeout(look, 16)
    }
    look()
  })

/**
 * Opens what was chosen with its name carried into the page: the row's
 * words become the page's title, the box fading as they go. `from` is the
 * row's words, `title` what the page will call it; where the page has no
 * such title, the box only fades and the page crossfades.
 */
export const into = (from: HTMLElement | null, title: string | null, closeBox: () => void, go: () => void) => {
  const box = from?.closest<HTMLElement>('[role="dialog"]') ?? null
  if (from === null || box === null || !travels() || typeof document.startViewTransition !== 'function') {
    closeBox()
    go()
    return
  }
  handing.now = true
  from.style.setProperty('view-transition-name', 'search-hit')
  box.style.setProperty('view-transition-name', 'search-box')
  let landed: HTMLElement | null = null
  const transition = document.startViewTransition(async () => {
    flushSync(closeBox)
    go()
    landed = title === null ? null : await named(title, 360)
    landed?.style.setProperty('view-transition-name', 'search-hit')
  })
  void transition.finished.finally(() => {
    landed?.style.removeProperty('view-transition-name')
    handing.now = false
  })
}

/** The field becomes where the words go next (the coordinator's composer), the words carried. */
export const intoField = (field: HTMLElement | null, closeBox: () => void, go: () => void) => {
  const box = field?.closest<HTMLElement>('[role="dialog"]') ?? null
  if (field === null || box === null || !travels() || typeof document.startViewTransition !== 'function') {
    closeBox()
    go()
    return
  }
  handing.now = true
  field.style.setProperty('view-transition-name', 'search-field')
  box.style.setProperty('view-transition-name', 'search-box')
  let landed: HTMLElement | null = null
  const transition = document.startViewTransition(async () => {
    flushSync(closeBox)
    go()
    const began = performance.now()
    while (landed === null && performance.now() - began < 360) {
      landed = document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"], textarea')
      if (landed === null) await new Promise((resolve) => setTimeout(resolve, 16))
    }
    landed?.style.setProperty('view-transition-name', 'search-field')
  })
  void transition.finished.finally(() => {
    landed?.style.removeProperty('view-transition-name')
    handing.now = false
  })
}
