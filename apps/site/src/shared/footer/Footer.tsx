import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'

import { type Clear, drawLight, type Ground, lightBox, lightOf } from './engrave'
import { ALTAR_X, ASPECT, engravingUrl, groundAt, LAND_Y } from './engraving'
import s from './Footer.module.css'
import { Links, Signature, still, useOnScreen, YEAR } from './parts'

/*
 * The page's last word, as a print: the words in cobalt ink over a
 * landscape engraved in the same ink, rising from the page's foot. Far
 * hills over a lake, wooded cliffs at the left, a headland with an altar on
 * it, and on the altar Althar's light, rising from its table in fine lines
 * that break up as they climb, drift and breathe, its streak shimmering in
 * the water. Nothing in it reaches into the words. It is never taller than
 * the screen.
 *
 * The landscape is an engraving made once (engraving/), in the page's two
 * inks, without the light: it rests on the footer's foot as wide as the
 * screen, and on a narrow screen it is shown larger and cut around the
 * altar, so the altar stays in view. It loads as the footer comes near (or
 * once the page has opened and is idle), and fades in when it is ready.
 * Only the light moves, drawn over the engraving's altar on a canvas as
 * narrow as it is, and only while it is seen.
 */

const STATEMENT = ['The most beautiful', 'IDE ever built', 'at your fingertips'] as const

/** How far ahead of the footer, in screens, the engraving starts loading. */
const AHEAD = '0px 0px 150% 0px'
/** Otherwise it loads this long after the page opens, once the page is idle, so it is ready when it is reached. */
const ANYWAY = 4500

/** The narrow crop starts this far in, at the far hills: the headland, the altar and the hills at the right. */
const CROP = 766 / 1916
/** How much of the water may go under the footer's foot, to keep the trees under the words on a short screen. */
const DROP = 0.12

const url = engravingUrl
const srcSet = (narrow: boolean, ext: string) =>
  narrow
    ? `${url(`engraving-narrow-640.${ext}`)} 640w, ${url(`engraving-narrow-1150.${ext}`)} 1150w`
    : `${url(`engraving-1280.${ext}`)} 1280w, ${url(`engraving-1916.${ext}`)} 1916w`

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))

/** Where the engraving is, in the footer's px: its whole box, wherever it is cut, whether only the narrow crop is in view, and the ground the light stands on. */
interface Place {
  left: number
  top: number
  iw: number
  ih: number
  narrow: boolean
  g: Ground
}

/** Where the engraving goes in a footer `w` by `h` whose words are `clear`. */
function placeOf(w: number, h: number, clear: Clear[]): Place {
  const sky = Math.max(0, ...clear.map((c) => c.bottom)) + 28
  // Larger than the screen on a narrow one, so the scene isn't a sliver: about twice its width on a phone, its width from 1100 up.
  let iw = w * (1 + 1.1 * clamp((1100 - w) / 620))
  // Where the words stand over each other (narrower than 900), it grows into the room under them, up to nearly three screens wide.
  if (w < 900) iw = clamp(((h - sky) / (1 - LAND_Y)) * ASPECT, iw, w * 2.8)
  let ih = iw / ASPECT
  // The landscape keeps under the words: smaller, where the screen is short and wide.
  const most = (h - sky) / (1 - LAND_Y - DROP)
  if (ih > most) {
    ih = most
    iw = ih * ASPECT
  }
  const drop = clamp(sky - (h - ih + LAND_Y * ih), 0, DROP * ih)
  const top = h - ih + drop
  // Wider than the screen, the altar sits a little right of the middle, or in the middle where the words stand over each other; narrower, it keeps its place in the picture.
  const at = w < 900 ? 0.5 : 0.62
  const left = iw >= w ? clamp(w * at - ALTAR_X * iw, w - iw, 0) : (w - iw) * ALTAR_X
  const g = groundAt(left, top, iw, ih, w, h, clear)
  return { left, top, iw, ih, narrow: left + CROP * iw <= 0, g }
}

/** Whether the footer is near, or the page has been open a while: from then on, the engraving is wanted. Stays true. */
function useWanted(ref: RefObject<Element | null>) {
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || wanted) return
    let done = false
    const want = () => void (done || setWanted(true))
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && want(), { rootMargin: AHEAD })
    io.observe(el)
    // Safari has no idle callback: there, a moment later.
    const idle =
      typeof requestIdleCallback === 'function'
        ? (f: () => void) => requestIdleCallback(f, { timeout: 3000 })
        : (f: () => void) => setTimeout(f, 0)
    const timer = setTimeout(() => idle(want), ANYWAY)
    return () => {
      done = true
      io.disconnect()
      clearTimeout(timer)
    }
  }, [ref, wanted])
  return wanted
}

export function Footer() {
  const box = useRef<HTMLElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [loaded, setLoaded] = useState(false)
  const on = useOnScreen(box)
  const wanted = useWanted(box)

  // Placed again for each size: the landscape keeps below the words.
  useEffect(() => {
    const footer = box.current
    if (!footer) return
    const measure = (): Clear[] => {
      const at = footer.getBoundingClientRect()
      return [...(words.current?.querySelectorAll('a, h2, p, li') ?? [])].flatMap((el) => {
        // The words' own ink, line by line, not the boxes they sit in.
        const range = document.createRange()
        range.selectNodeContents(el)
        return [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => ({ left: r.left - at.left, right: r.right - at.left, bottom: r.bottom - at.top }))
      })
    }
    const ro = new ResizeObserver(() => setPlace(placeOf(footer.clientWidth, footer.clientHeight, measure())))
    ro.observe(footer)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = glow.current
    const g = place?.g
    if (!el || !g || !on) return
    // The light's canvas is only as wide as the light.
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const { left, width } = lightBox(g)
    el.style.left = `${left}px`
    el.style.width = `${width}px`
    el.width = Math.round(width * dpr)
    el.height = Math.round(g.h * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, -left * dpr, 0)
    const light = lightOf(g)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      drawLight(ctx, g, light, still() ? 0 : now - start + 4000)
      if (!still()) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [on, place])

  let picture: CSSProperties = {}
  let sizes = '100vw'
  if (place) {
    const { left, top, iw, ih, narrow, g } = place
    const width = (narrow ? 1 - CROP : 1) * iw
    sizes = `${Math.ceil(width)}px`
    picture = { left: left + (narrow ? CROP * iw : 0), top, width, height: ih }
    // Narrower than the screen, on a short and wide one: its sides fade into the paper.
    if (iw < g.w) {
      const f = `${Math.round(Math.min(160, iw * 0.12))}px`
      const mask = `linear-gradient(to right, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent)`
      picture = { ...picture, maskImage: mask, WebkitMaskImage: mask }
    }
  }

  return (
    <footer ref={box} className={s.footer}>
      {wanted && place && (
        <picture>
          <source type="image/avif" srcSet={srcSet(place.narrow, 'avif')} sizes={sizes} />
          <img
            className={s.land}
            data-loaded={loaded ? '' : undefined}
            srcSet={srcSet(place.narrow, 'webp')}
            sizes={sizes}
            src={url('engraving-1280.webp')}
            alt=""
            aria-hidden="true"
            decoding="async"
            onLoad={() => setLoaded(true)}
            style={picture}
          />
        </picture>
      )}
      <canvas ref={glow} className={s.glow} data-loaded={loaded ? '' : undefined} aria-hidden="true" />
      <div ref={words} className={s.words}>
        <div className={s.left}>
          <Signature />
          <h2 className={s.statement}>
            {STATEMENT[0]}
            <br />
            <b>{STATEMENT[1]}</b>
            <br />
            {STATEMENT[2]}
          </h2>
          <p className={s.line}>Althar © {YEAR} · Free and open source.</p>
        </div>
        <Links className={s.links} />
      </div>
    </footer>
  )
}
