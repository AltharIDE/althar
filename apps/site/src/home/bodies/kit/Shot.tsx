import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import s from './Shot.module.css'

/*
 * A picture of the app, drawn by the app's own components: laid out at the
 * size it is designed for (`w` px wide, `h` tall or as tall as it comes out)
 * and scaled to the width it is given, as a screenshot would be, so it stays
 * crisp at any size. On a phone it can lay itself out narrower (`phoneW`),
 * or show a part of itself (`phone`: the region to keep, in the design's
 * px), scaled up until that part reads. It is a picture: nothing in it can
 * be pressed or focused, and it reads as its label.
 */

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface ShotProps {
  w: number
  /** Its height; without it, as tall as what it shows. */
  h?: number
  /** On a narrow screen, laid out this wide instead. */
  phoneW?: number
  /** On a narrow screen, the part to show, in the design's px. */
  phone?: Region
  /** Elsewhere, the part to show; by default all of it. */
  crop?: Region
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

const NARROW = 700

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

export function Shot({ w, h, phoneW, phone, crop, align = 'center', maxScale = 2, label, className, frame, children }: ShotProps) {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ scale: number; width: number; region: Region } | null>(null)

  // Regions are written inline: follow what they say, not which object they are.
  const phoneKey = phone ? `${phone.x},${phone.y},${phone.w},${phone.h}` : ''
  const cropKey = crop ? `${crop.x},${crop.y},${crop.w},${crop.h}` : ''
  useLayoutEffect(() => {
    const el = box.current
    const inner = stage.current
    if (!el || !inner) return
    const measure = () => {
      const narrow = window.innerWidth < NARROW
      const width = narrow && phoneW ? phoneW : w
      inner.style.width = `${width}px`
      const height = h ?? inner.scrollHeight
      const region = narrow && phone ? phone : (crop ?? { x: 0, y: 0, w: width, h: height })
      const scale = Math.min(maxScale, el.clientWidth / region.w)
      setFit((was) =>
        was &&
        was.scale === scale &&
        was.width === width &&
        was.region.h === region.h &&
        was.region.x === region.x &&
        was.region.y === region.y
          ? was
          : { scale, width, region },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(inner)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, phoneW, phoneKey, cropKey, maxScale])

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
            height: h,
            transform: `scale(${scale}) translate(${-region.x}px, ${-region.y}px)`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
