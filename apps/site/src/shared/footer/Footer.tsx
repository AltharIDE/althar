import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/400-italic.css'
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'

import { ASPECT, type Clear, engravingUrl, LAND_Y, LIGHTHOUSE_X } from './engraving'
import s from './Footer.module.css'
import { Links, Signature, YEAR } from './parts'

/*
 * The page's last word, as a print: the words in cobalt ink over the
 * LinkedIn banner's scene, rising from the page's foot. Far hills over a
 * lake, wooded cliffs at the left, a headland with a lighthouse on it, its
 * beam lit; on the water, canoes flying the labs' flags, someone at work in
 * a boat in the lighthouse's light, and Althar's boats with their crews.
 * Nothing in it reaches into the words. It is never taller than the screen.
 *
 * The scene is a picture made once (engraving/, scripts/engraving.ts): it
 * rests on the footer's foot as wide as the screen, and on a narrow screen
 * it is shown larger and cut around the lighthouse, so the lighthouse stays
 * in view. It loads as the footer comes near (or once the page has opened
 * and is idle), and fades in when it is ready.
 */

/** What the footer says: what Althar is, and who it is for, the second its beat. */
const STATEMENT = ['The agentic development environment (ADE)', 'for your entire software team.'] as const

/** How far ahead of the footer, in screens, the engraving starts loading. */
const AHEAD = '0px 0px 150% 0px'
/** Otherwise it loads this long after the page opens, once the page is idle, so it is ready when it is reached. */
const ANYWAY = 4500

/** The narrow crop starts this far in, at the far hills: the headland, the lighthouse, the boats and the hills at the right. */
const CROP = 766 / 1916
/** How much of the water may go under the footer's foot, to keep the trees under the words on a short screen. */
const DROP = 0.12

const url = engravingUrl
const srcSet = (narrow: boolean, ext: string) =>
  narrow
    ? `${url(`engraving-narrow-640.${ext}`)} 640w, ${url(`engraving-narrow-1150.${ext}`)} 1150w`
    : `${url(`engraving-1280.${ext}`)} 1280w, ${url(`engraving-1916.${ext}`)} 1916w`

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))

/** Where the engraving is, in the footer's px: its whole box, wherever it is cut, whether only the narrow crop is in view, and how wide the footer is. */
interface Place {
  left: number
  top: number
  iw: number
  ih: number
  narrow: boolean
  w: number
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
  // Wider than the screen, the lighthouse sits a little right of the middle, or in the middle where the words stand over each other; narrower, it keeps its place in the picture.
  const at = w < 900 ? 0.5 : 0.62
  const left = iw >= w ? clamp(w * at - LIGHTHOUSE_X * iw, w - iw, 0) : (w - iw) * LIGHTHOUSE_X
  return { left, top, iw, ih, narrow: left + CROP * iw <= 0, w }
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
  const words = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [loaded, setLoaded] = useState(false)
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

  let picture: CSSProperties = {}
  let sizes = '100vw'
  if (place) {
    const { left, top, iw, ih, narrow, w } = place
    const width = (narrow ? 1 - CROP : 1) * iw
    sizes = `${Math.ceil(width)}px`
    picture = { left: left + (narrow ? CROP * iw : 0), top, width, height: ih }
    // Narrower than the screen, on a short and wide one: its sides fade into the paper.
    if (iw < w) {
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
      <div ref={words} className={s.words}>
        <div className={s.left}>
          <Signature />
          <h2 className={s.statement}>
            {STATEMENT[0]} <b>{STATEMENT[1]}</b>
          </h2>
          <p className={s.line}>Althar © {YEAR} · Free and open source.</p>
        </div>
        <Links className={s.links} />
      </div>
    </footer>
  )
}
