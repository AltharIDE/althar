import { type ReactNode, type RefObject, useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { drawLight, type Ground, lightOf } from '../../shared/footer/engrave'
import { ALTAR_X } from '../../shared/footer/engraving'
import { still } from '../../shared/footer/parts'
import { LightUnder } from '../../shared/lightUnder'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import b from './B.module.css'
import { useEngraving } from './b/useEngraving'

/*
 * Prototype, B: engraved. The first screen's space, drawn as the footer
 * draws: a line engraving in its cobalt on its paper. Under the band the
 * sky is engraved night, ruled and cross-ruled, its stars left as paper,
 * and the planet's edge cut as a great arc under the first picture, the air
 * along it a thin line of paper. Down the page the ink thins as the sky
 * lightens: the planet's clouds come nearer, banks of cloud come up round
 * what keeps you in flow, the sky opens under them, and by the download it
 * is paper, with the altar's light rising into it from the footer, where
 * the ground is. The engraving is drawn once, in tiles laid into the page
 * (b/), so it scrolls as print does; the words are kept clear of it.
 *
 * The app's pictures are plates tipped into the book: each on its own
 * paper, inside a cobalt rule.
 */

type Id = keyof typeof SCENE

/** A claim and its lead, the engraving kept clear of them. */
function Head({ id, className }: { id: Id; className?: string }) {
  return (
    <div className={cx(b.head, className)} data-clear="">
      <h2 id={`${id}-h`} className={cx(t.title, b.title)}>
        {SCENE[id].title}
      </h2>
      <p className={cx(t.lead, b.lead)}>{SCENE[id].lead}</p>
    </div>
  )
}

/** A picture of the app as a plate: on its own paper, inside a cobalt rule and a finer one within it. */
function Plate({ className, limb, children }: { className?: string; limb?: boolean; children: ReactNode }) {
  return (
    <div className={cx(b.plate, className)} data-limb={limb ? '' : undefined}>
      <div className={b.mat}>{children}</div>
    </div>
  )
}

/** What keeps you in flow, as a book's page of figures: each a plate, its title and its line under it. */
function Figures() {
  return (
    <ol className={b.figures}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(b.figure, b[tile.id])} data-tone={tile.drawn ? (tile.tone ?? 'light') : undefined}>
          <Plate>{tile.piece(tile.tone ?? 'light')}</Plate>
          <div className={b.caption} data-clear="">
            <h3 className={b.figTitle}>{tile.title}</h3>
            <p className={b.figLead}>{tile.lead}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * The altar's light, rising into the open sky over the download from where
 * the footer's altar stands below: drawn as the footer draws it, whole low
 * down and breaking up as it climbs, in line with the footer's own. It
 * breathes as the footer's does, while seen; still with reduced motion.
 */
function useLight(endRef: RefObject<HTMLElement | null>, canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const end = endRef.current
    const canvas = canvasRef.current
    if (!end || !canvas) return
    let frame = 0
    let seen = false
    let ground: Ground | null = null
    let light: ReturnType<typeof lightOf> | null = null
    let left = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    /** Where the footer's altar stands, against the download's section: its middle, its table's top, its size. */
    const place = () => {
      const box = end.getBoundingClientRect()
      const img = document.querySelector<HTMLImageElement>('#top > footer img')
      let ax = box.width * 0.62
      let k = box.width / 1440
      if (img && img.complete && img.naturalWidth) {
        const r = img.getBoundingClientRect()
        const narrow = img.currentSrc.includes('narrow')
        const iw = narrow ? r.width / (1 - 766 / 1916) : r.width
        const x0 = narrow ? r.left - (766 / 1916) * iw : r.left
        ax = x0 + ALTAR_X * iw - box.left
        k = (iw * (100 / 1916)) / 70
      }
      const words = [...end.querySelectorAll('[data-clear]')].map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left - box.left, right: r.right - box.left, bottom: r.bottom - box.top }
      })
      const reach = Math.ceil(60 * k + 12)
      left = Math.max(0, Math.floor(ax - reach))
      const width = Math.min(box.width, Math.ceil(ax + reach)) - left
      canvas.style.left = `${left}px`
      canvas.style.width = `${width}px`
      canvas.style.height = `${box.height}px`
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(box.height * dpr)
      ground = {
        w: box.width,
        h: box.height,
        k,
        top: 0,
        tall: box.height,
        // No water here: its streak is the footer's.
        water: box.height + 4000,
        ax,
        ground: box.height + 24,
        altarTop: box.height + 24,
        clear: [...words, { left: 0, right: box.width, bottom: box.height * 0.08 }],
      }
      light = lightOf(ground)
    }
    const start = performance.now()
    const draw = (now: number) => {
      frame = 0
      const ctx = canvas.getContext('2d')
      if (!ctx || !ground || !light) return
      ctx.setTransform(dpr, 0, 0, dpr, -left * dpr, 0)
      drawLight(ctx, ground, light, still() ? 0 : now - start + 4000)
      if (seen && !still()) frame = requestAnimationFrame(draw)
    }
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? false
      if (seen) {
        place()
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(draw)
      }
    })
    io.observe(end)
    const ro = new ResizeObserver(() => {
      if (!seen) return
      place()
      if (!frame) frame = requestAnimationFrame(draw)
    })
    ro.observe(end)
    return () => {
      io.disconnect()
      ro.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [endRef, canvasRef])
}

export function EngravedBody() {
  const main = useRef<HTMLElement>(null)
  const plates = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  useEngraving(main, plates)
  useLight(end, glow)
  return (
    <main ref={main} id="main" tabIndex={-1} className={b.body}>
      {/* The engraving's night: the nav turns to smoked glass over it. */}
      <div className={b.night} aria-hidden="true">
        <LightUnder tone="ink" className={b.under} />
      </div>
      <div ref={plates} className={b.plates} aria-hidden="true" />

      <section id="independent" className={cx(b.scene, b.first)} aria-labelledby="independent-h">
        <div className={b.wrap}>
          <Head id="independent" className={b.cartouche} />
        </div>
        <Plate className={b.board} limb>
          <AtWork />
        </Plate>
      </section>

      <section id="coordinator" className={b.scene} aria-labelledby="coordinator-h">
        <div className={cx(b.wrap, b.split)}>
          <Head id="coordinator" />
          <Plate className={b.talk}>
            <AskOnce />
          </Plate>
        </div>
      </section>

      <section id="review" className={b.scene} aria-labelledby="review-h">
        <div className={b.wrap}>
          <Head id="review" className={b.wide} />
        </div>
        <Plate className={b.review}>
          <Review />
        </Plate>
      </section>

      <section id="flow" className={b.scene} aria-labelledby="flow-h">
        <div className={b.wrap}>
          <Head id="flow" />
          <Figures />
        </div>
      </section>

      <section id="edge" className={b.scene} aria-labelledby="edge-h">
        <div className={b.wrap}>
          <Head id="edge" />
        </div>
        <div className={b.tour}>
          <EdgeTour tone="paper" />
        </div>
      </section>

      <section ref={end} id="end" className={b.end} aria-label="Download Althar">
        <canvas ref={glow} className={b.glow} aria-hidden="true" />
        <div className={b.wrap}>
          <div className={b.endWords} data-clear="">
            <p className={b.endLine}>
              {END[0]} <br />
              <b>{END[1]}</b>
            </p>
            <div className={b.endGet}>
              <Get tone="paper" />
              <OtherMac tone="paper" />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
