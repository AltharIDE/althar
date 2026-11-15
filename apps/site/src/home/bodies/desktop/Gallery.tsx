import { Icon } from '@althar/ui'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import g from './Gallery.module.css'
import { type Screen, SCREENS } from './screens/list'
import SIZES from './screens/sizes.json'

/*
 * The app's own screens, in a row that runs off the page's right edge: each
 * framed on its wallpaper, named, with a line. You scroll or swipe it
 * sideways, or press its arrows; nothing moves by itself. Pressed, a screen
 * opens whole over the page, the window alone, to read; the others a key or
 * a press away. The pictures are scripts/screens.ts's copies of the brand
 * pack's screenshots.
 */

const FILES = import.meta.glob<string>('./screens/*.webp', { eager: true, query: '?url', import: 'default' })
const url = (name: string) => FILES[`./screens/${name}.webp`] ?? ''

/** The strip's card heights, as Gallery.module.css sets them: on a phone, and at most. */
const CARD_H = { phone: 210, most: 460 }

interface Shot extends Screen {
  card: { src: string; srcSet: string; sizes: string; w: number; h: number }
  whole: { src: string; srcSet: string; w: number; h: number }
}

const SHOTS: readonly Shot[] = SCREENS.map((screen) => {
  const size = SIZES[screen.file as keyof typeof SIZES]
  const [w, h] = size.card as [number, number]
  const [ww, wh] = size.whole as [number, number]
  const at = (height: number) => Math.round((w * height) / h)
  return {
    ...screen,
    card: {
      src: url(`${screen.file}-920h`),
      srcSet: `${url(`${screen.file}-460h`)} ${at(460)}w, ${url(`${screen.file}-920h`)} ${at(920)}w`,
      sizes: `(max-width: 700px) ${at(CARD_H.phone)}px, ${at(CARD_H.most)}px`,
      w,
      h,
    },
    whole: {
      src: url(`${screen.file}-whole-2x`),
      srcSet: `${url(`${screen.file}-whole-1x`)} ${Math.round(ww / 2)}w, ${url(`${screen.file}-whole-2x`)} ${ww}w`,
      w: ww,
      h: wh,
    },
  }
})

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Gallery() {
  const row = useRef<HTMLUListElement>(null)
  const [ends, setEnds] = useState({ start: true, end: false })
  const [open, setOpen] = useState<{ at: number; from: HTMLElement } | null>(null)
  const measure = useCallback(() => {
    const el = row.current
    if (!el) return
    setEnds({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 })
  }, [])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])
  const shut = useCallback(() => setOpen(null), [])
  const by = (dir: number) => {
    const el = row.current
    el?.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: still() ? 'auto' : 'smooth' })
  }
  return (
    <>
      <div className={g.box} data-light="">
        <ul ref={row} className={g.strip} onScroll={measure} aria-label="Screens">
          {SHOTS.map((shot, k) => (
            <li key={shot.file} className={g.card}>
              <figure>
                <button type="button" className={g.open} aria-haspopup="dialog" onClick={(e) => setOpen({ at: k, from: e.currentTarget })}>
                  <img
                    className={g.picture}
                    src={shot.card.src}
                    srcSet={shot.card.srcSet}
                    sizes={shot.card.sizes}
                    width={shot.card.w}
                    height={shot.card.h}
                    alt={shot.alt}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
                <figcaption className={g.caption}>
                  <b>{shot.name}</b> {shot.line}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={cx(g.round, g.prev)}
          data-off={ends.start || undefined}
          onClick={() => by(-1)}
          aria-label="Earlier screens"
        >
          <Icon name="chevronL" size={16} />
        </button>
        <button
          type="button"
          className={cx(g.round, g.next)}
          data-off={ends.end || undefined}
          onClick={() => by(1)}
          aria-label="Later screens"
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {open && <Whole at={open.at} from={open.from} onClose={shut} />}
    </>
  )
}

/**
 * A screen opened whole, over the page, as a modal dialog: grown from the
 * picture it was opened from, with a fade; the others an arrow key or a press
 * away; Escape, the cross or the dark round it closes it, back to that picture.
 */
function Whole({ at, from, onClose }: { at: number; from: HTMLElement; onClose: () => void }) {
  const [i, setI] = useState(at)
  const [shown, setShown] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const figure = useRef<HTMLElement>(null)
  const closing = useRef(false)
  const shot = SHOTS[i] ?? SHOTS[0]!
  const step = (by: number) => setI((k) => (k + by + SHOTS.length) % SHOTS.length)
  /** Fades it out, then closes it, back on the picture it was opened from; `now` where the browser has closed it already. */
  const close = useCallback(
    (now = false) => {
      if (closing.current) return
      closing.current = true
      setShown(false)
      window.setTimeout(
        () => {
          dialog.current?.close()
          onClose()
          from.focus({ preventScroll: true })
        },
        now || still() ? 0 : 140,
      )
    },
    [from, onClose],
  )
  // It grows from the picture it was opened from: that picture's middle, in the figure's own box. The page under it stays put.
  useLayoutEffect(() => {
    const box = dialog.current
    const fig = figure.current
    if (!box || !fig) return
    box.showModal()
    const a = from.getBoundingClientRect()
    const b = fig.getBoundingClientRect()
    fig.style.transformOrigin = `${a.left + a.width / 2 - b.left}px ${a.top + a.height / 2 - b.top}px`
    const frame = requestAnimationFrame(() => setShown(true))
    const html = document.documentElement
    const was = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      html.style.overflow = was
      if (box.open) box.close()
    }
  }, [from])
  // The dialog's own keys and presses: the arrows step, Escape and the dark round the screen close it.
  useEffect(() => {
    const box = dialog.current
    if (!box) return
    const keys = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else return
      e.preventDefault()
    }
    const press = (e: MouseEvent) => {
      if (e.target === box) close()
    }
    const cancel = (e: Event) => {
      e.preventDefault()
      close()
    }
    // Closed by the browser, not by close(): a second Escape, say. Its event comes a task late: if it is open again by then, it stays.
    const closed = () => {
      if (!box.open) close(true)
    }
    box.addEventListener('keydown', keys)
    box.addEventListener('click', press)
    box.addEventListener('cancel', cancel)
    box.addEventListener('close', closed)
    return () => {
      box.removeEventListener('keydown', keys)
      box.removeEventListener('click', press)
      box.removeEventListener('cancel', cancel)
      box.removeEventListener('close', closed)
    }
  }, [close])
  return (
    <dialog ref={dialog} className={g.whole} data-shown={shown || undefined} aria-label={shot.name}>
      <figure ref={figure} className={g.wholeFigure}>
        <img
          className={g.wholePicture}
          src={shot.whole.src}
          srcSet={shot.whole.srcSet}
          sizes="(max-width: 700px) calc(100vw - 24px), min(100vw - 192px, 1600px)"
          width={shot.whole.w}
          height={shot.whole.h}
          alt={shot.alt}
          draggable={false}
        />
        <figcaption className={g.wholeCaption}>
          <b>{shot.name}</b> {shot.line}
        </figcaption>
      </figure>
      {/* The first to take focus, so the dialog's lands on it as it opens. */}
      <button type="button" className={cx(g.round, g.wholeClose)} onClick={() => close()} aria-label="Close">
        <Icon name="close" size={16} />
      </button>
      <button type="button" className={cx(g.round, g.wholePrev)} onClick={() => step(-1)} aria-label="Previous screen">
        <Icon name="chevronL" size={16} />
      </button>
      <button type="button" className={cx(g.round, g.wholeNext)} onClick={() => step(1)} aria-label="Next screen">
        <Icon name="chevron" size={16} />
      </button>
    </dialog>
  )
}
