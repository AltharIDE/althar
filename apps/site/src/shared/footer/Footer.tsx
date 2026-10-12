import { LOGO_SECTION } from '@althar/ui'
import { type RefObject, useEffect, useRef, useState } from 'react'

import { type Clear, drawLandscape, drawLight, type Ground, groundOf, lightBox, lightOf } from './engrave'
import s from './Footer.module.css'
import type { Answer, Ask } from './landscape.worker'
import { Links, Signature, still, useOnScreen, YEAR } from './parts'

/*
 * The page's last word, as a print: the words in cobalt ink over a
 * landscape engraved in the same ink, rising from the page's foot. Far
 * hills over a lake, a wooded slope at the left, a hill at the right, a
 * headland with an altar on it, and on the altar Althar's light, rising
 * from its table in fine lines that break up as they climb, drift and
 * breathe, its streak shimmering in the water. Nothing in it reaches into
 * the words. It is never taller than the screen.
 *
 * The landscape is drawn once for the size, off the main thread, as the
 * footer comes near (or once the page has opened and is idle), and fades
 * in when it is ready: drawn on the page, its thousands of marks would stall
 * whatever moves meanwhile. Only the light moves, on a canvas as narrow as
 * it is, and only while it is seen.
 */

const STATEMENT = ['The most beautiful', 'IDE ever built', 'at your fingertips'] as const

/** How far ahead of the footer, in screens, the landscape starts being drawn. */
const AHEAD = '0px 0px 150% 0px'
/** Otherwise it is drawn this long after the page opens, once the page is idle, so it is ready when it is reached. */
const ANYWAY = 4500

/** Whether the footer is near, or the page has been open a while: from then on, the landscape is wanted. Stays true. */
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

/** Whether the landscape can be drawn off the main thread here. */
const offThread = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferToImageBitmap' in OffscreenCanvas.prototype

export function Footer() {
  const box = useRef<HTMLElement>(null)
  const land = useRef<HTMLCanvasElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const ground = useRef<Ground | null>(null)
  /** Counts the landscape's redraws, so the light is drawn again for each size, held still or not. */
  const [drawn, setDrawn] = useState(0)
  const on = useOnScreen(box)
  const wanted = useWanted(box)

  useEffect(() => {
    const el = land.current
    const footer = box.current
    if (!wanted || !el || !footer) return
    let worker: Worker | null = null
    let asked = 0
    const asks = new Map<number, Ground>()

    // The landscape keeps below the words, and nothing in it reaches into them.
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

    /** Puts a finished landscape on the page, with the ground the light stands on. */
    const show = (g: Ground, paint: (ctx: CanvasRenderingContext2D, dpr: number) => void) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      el.width = Math.round(g.w * dpr)
      el.height = Math.round(g.h * dpr)
      const ctx = el.getContext('2d')
      if (!ctx) return
      paint(ctx, dpr)
      ground.current = g
      el.dataset.drawn = ''
      setDrawn((n) => n + 1)
    }

    /** Draws it here, on the main thread, where it can't be drawn off it. */
    const drawHere = (w: number, h: number, clear: Clear[], paper: string) =>
      show(groundOf(w, h, clear), (ctx, dpr) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawLandscape(ctx, w, h, clear, paper, LOGO_SECTION)
      })

    const draw = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      const clear = measure()
      const paper = getComputedStyle(footer).backgroundColor
      if (!offThread()) return drawHere(w, h, clear, paper)
      if (!worker) {
        worker = new Worker(new URL('./landscape.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = ({ data }: MessageEvent<Answer>) => {
          const g = asks.get(data.id)
          // Only the latest size is shown; an older one that comes back late is dropped.
          if (!g || data.id !== asked) return
          asks.clear()
          if ('picture' in data)
            show(g, (ctx) => {
              ctx.drawImage(data.picture, 0, 0)
              data.picture.close()
            })
          else drawHere(g.w, g.h, [...g.clear], paper)
        }
      }
      const ask: Ask = { id: ++asked, w, h, dpr: Math.min(2, window.devicePixelRatio || 1), clear, paper, mark: LOGO_SECTION }
      asks.set(ask.id, groundOf(w, h, clear))
      worker.postMessage(ask)
    }

    // Again for each new size, once the size has stopped changing for a moment.
    let size = ''
    let wait = 0
    const ro = new ResizeObserver(() => {
      const now = `${el.clientWidth}x${el.clientHeight}`
      if (now === size) return
      const first = size === ''
      size = now
      window.clearTimeout(wait)
      wait = window.setTimeout(draw, first ? 0 : 160)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(wait)
      worker?.terminate()
    }
  }, [wanted])

  useEffect(() => {
    const el = glow.current
    const g = ground.current
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
  }, [on, drawn])

  return (
    <footer ref={box} className={s.footer}>
      <canvas ref={land} className={s.land} aria-hidden="true" />
      <canvas ref={glow} className={s.glow} aria-hidden="true" />
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
