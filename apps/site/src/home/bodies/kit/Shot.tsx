import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import { useRestAway } from './seen'
import s from './Shot.module.css'

/*
 * A picture of the app, drawn by the app's own components: laid out at the
 * size it is designed for (`w` px wide, `h` tall or as tall as it comes out)
 * and scaled to the width it is given, as a screenshot would be, so it stays
 * crisp at any size. On a phone it can lay itself out narrower (`phoneW`),
 * or show a part of itself (`phone`: the region to keep, in the design's
 * px), scaled up until that part reads. It is a picture: nothing in it can
 * be pressed or focused, and it reads as its label. Out of sight, what
 * loops in it rests.
 *
 * Or, on a tablet, it can fill a box of the screen's own shape (`fill`: the
 * nearest `[data-fit-box]` round it, as the carousel's views are), showing
 * the part of itself it is given, `w` px of it across from `x`, as large as
 * that reads, and as much of the rest round it as the box has room for: from
 * `y` down, or up from its foot. In such a box on a phone it is the whole
 * window as the desktop lays it out, scaled down to the box's width.
 */

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** A part to show, filling the box it is in: across from `x`, `w` px of it at least, and from `y` down, or (`from: 'foot'`) up to `y + h`. */
export interface Fit {
  x: number
  y: number
  w: number
  h?: number
  from?: 'top' | 'foot'
}

export interface ShotProps {
  w: number
  /** Its height; without it, as tall as what it shows. */
  h?: number
  /** On a narrow screen, laid out this wide instead. */
  phoneW?: number
  /** In the carousel's box on a phone, the whole window laid out this size instead: smaller than the desktop's, so what is in it reads larger. */
  whole?: { w: number; h: number }
  /** On a tablet, filling its box (`fill`), laid out this wide instead. */
  tabletW?: number
  /** On a narrow screen, the part to show, in the design's px. */
  phone?: Region
  /** Elsewhere, the part to show; by default all of it. */
  crop?: Region
  /** Filling the box it is in, on a phone and on a tablet: the part to show on each. */
  fill?: { phone?: Fit; tablet?: Fit }
  /** Where it sits when it is narrower than its place. */
  align?: 'center' | 'start'
  /** Never shown larger than this. */
  maxScale?: number
  /** What it shows, for assistive technology. */
  label: string
  className?: string
  /** The frame's own look (radius, shadow, tilt), on the scaled box. */
  frame?: string
  children: ReactNode
}

/** The carousel's window on a phone (`whole`): smaller than the desktop's 1440 by 780 and taller for its width, so it reads larger there. */
export const PHONE_WINDOW = { w: 1120, h: 840 } as const

const NARROW = 700
const TABLET = 900
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/*
 * The app's components keep what is current in view (a tab scrolls itself
 * into its strip; an opened panel takes focus), which in a picture would
 * scroll the page. Inside a picture, those do nothing.
 */
if (typeof window !== 'undefined') {
  const inPicture = (el: Element) => el.closest('[data-picture]') !== null
  const scrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    if (!inPicture(this)) scrollIntoView.call(this, arg)
  }
  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (!inPicture(this)) focus.call(this, options)
  }
}

/*
 * On a touch screen the browser gives every box that can scroll a layer of its own, as large as what it scrolls, drawn
 * again sharper as the page is pinch-zoomed: the lanes, lists and streams of one window came to more than a phone has,
 * and it reloaded the page. A picture is never scrolled by hand, so there its scrolling boxes only clip; what the app
 * scrolls itself (a conversation to its foot) still scrolls. Each box is looked at once, as it comes.
 */
function clipScrollers(stage: HTMLElement) {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return () => {}
  const seen = new WeakSet<Element>()
  const sweep = () => {
    timer = 0
    for (const el of stage.querySelectorAll<HTMLElement>('*')) {
      if (seen.has(el)) continue
      seen.add(el)
      const cs = getComputedStyle(el)
      if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) el.style.overflow = 'hidden'
    }
  }
  let timer = 0
  const later = () => {
    if (!timer) timer = window.setTimeout(sweep, 200)
  }
  sweep()
  const mo = new MutationObserver(later)
  mo.observe(stage, { childList: true, subtree: true })
  return () => {
    mo.disconnect()
    window.clearTimeout(timer)
  }
}

export function Shot({
  w,
  h,
  phoneW,
  tabletW,
  whole: wholeSize,
  phone,
  crop,
  fill,
  align = 'center',
  maxScale = 2,
  label,
  className,
  frame,
  children,
}: ShotProps) {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ scale: number; width: number; tall?: number; region: Region } | null>(null)
  useRestAway(box)

  useLayoutEffect(() => (stage.current ? clipScrollers(stage.current) : undefined), [])

  // Regions are written inline: follow what they say, not which object they are.
  const phoneKey = phone ? `${phone.x},${phone.y},${phone.w},${phone.h}` : ''
  const cropKey = crop ? `${crop.x},${crop.y},${crop.w},${crop.h}` : ''
  const fillKey = fill ? JSON.stringify(fill) : ''
  useLayoutEffect(() => {
    const el = box.current
    const inner = stage.current
    if (!el || !inner) return
    const room = el.closest<HTMLElement>('[data-fit-box]')
    const measure = () => {
      const narrow = window.innerWidth < NARROW
      // In the carousel's box on a phone: the whole window as the desktop lays it out, scaled down, so it reads as the desktop's shape and not squeezed into a column.
      const whole = narrow && room !== null
      const mid = !narrow && window.innerWidth < TABLET && fill?.tablet !== undefined && room !== null
      const width = whole ? (wholeSize?.w ?? w) : narrow && phoneW ? phoneW : mid && tabletW ? tabletW : w
      const tall = whole && wholeSize ? wholeSize.h : h
      inner.style.width = `${width}px`
      if (tall) inner.style.height = `${tall}px`
      const height = tall ?? inner.scrollHeight
      // Filling its box: as large as its part reads across, and larger if the box is taller than all of it; its part as near the middle across as the box leaves room for.
      const part = whole ? undefined : window.innerWidth < NARROW ? fill?.phone : window.innerWidth < TABLET ? fill?.tablet : undefined
      if (part && room && room.clientWidth && room.clientHeight) {
        const bw = room.clientWidth
        const bh = room.clientHeight
        const scale = Math.max(bw / part.w, bh / height)
        const rw = bw / scale
        const rh = bh / scale
        const x = clamp(part.x + (part.w - rw) / 2, 0, width - rw)
        const y = clamp(part.from === 'foot' ? part.y + (part.h ?? rh) - rh : part.y, 0, height - rh)
        const region = { x, y, w: rw, h: rh }
        setFit((was) =>
          was && was.scale === scale && was.width === width && was.region.x === x && was.region.y === y && was.region.h === rh
            ? was
            : { scale, width, region },
        )
        return
      }
      const region = narrow && phone && !whole ? phone : (crop ?? { x: 0, y: 0, w: width, h: height })
      const scale = Math.min(maxScale, el.clientWidth / region.w)
      setFit((was) =>
        was &&
        was.scale === scale &&
        was.width === width &&
        was.tall === tall &&
        was.region.h === region.h &&
        was.region.x === region.x &&
        was.region.y === region.y
          ? was
          : { scale, width, ...(tall ? { tall } : {}), region },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(inner)
    if (room) ro.observe(room)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, phoneW, tabletW, wholeSize?.w, wholeSize?.h, phoneKey, cropKey, fillKey, maxScale])

  const region = fit?.region ?? { x: 0, y: 0, w, h: h ?? 1 }
  const scale = fit?.scale ?? 0
  // The app's own words in the picture are its demo world: data-nosnippet keeps them out of search results' snippets.
  return (
    <div ref={box} className={cx(s.shot, align === 'start' && s.start, className)} role="img" aria-label={label} data-nosnippet>
      <div
        className={cx(s.frame, frame)}
        style={{ width: region.w * scale || undefined, height: region.h * scale || undefined, visibility: fit ? 'visible' : 'hidden' }}
      >
        <div
          ref={stage}
          className={cx(s.stage, 'ch-root')}
          data-picture
          inert
          aria-hidden="true"
          style={{
            width: fit?.width ?? w,
            height: fit?.tall ?? h,
            transform: `scale(${scale}) translate(${-region.x}px, ${-region.y}px)`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
