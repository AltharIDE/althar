import { type RefObject, useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { useGrain } from '../../shared/grain'
import { LightUnder } from '../../shared/lightUnder'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { TILES } from '../bodies/desktop/Bento'
import { END, SCENE } from '../bodies/desktop/DesktopBody'
import { Review } from '../bodies/desktop/Review'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import t from '../bodies/kit/type.module.css'
import a from './A.module.css'
import { EDGE_DIP, makeOrbit, type Orbit } from './a/orbit'

/*
 * Prototype, A: the night side. Past the band you are back in orbit, on the
 * night side, coasting toward dawn: one view held behind the sections, drawn
 * on the graphics card (a/orbit.ts), black space and its stars over the
 * planet's dark curve, its towns in gold under faint cloud, the air along its
 * edge a thin cobalt line. As you read down, the orbit carries you toward the
 * sun: the edge brightens at the right, the towns there go out, and by the
 * download the sun breaks over the edge where, far below in the footer, the
 * altar's light stands. Then the dawn's light washes the foot of the sections
 * into the paper the footer is printed on.
 *
 * The claims are set as a film sets its titles over a shot, large and white,
 * each section composed on its own; the pictures of the app are things seen
 * on the way: the app's own windows as panes lit by the planet's edge, every
 * drawing in its dark, melting into the night. With reduced motion nothing drifts and the sun doesn't travel:
 * the dawn only comes up in its place as you read.
 */

const DEG = Math.PI / 180
/** Where the sun breaks: just over the edge, a disc's breadth. */
const BREAK = -EDGE_DIP + 0.005
/** How deep in the night the sections begin. */
const DEEP = -50 * DEG
/** The window's px to draw at most, and the finest a px is drawn. */
const MOST_PIXELS = 1.5e6
const FINEST = 1.5
/** The drift starts a while into the orbit, over a stretch of towns. */
const T0 = 140

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const smooth = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}

/** The view, held to the window behind the sections, read from how far down them the reader is. */
function Sky({ main }: { main: RefObject<HTMLElement | null> }) {
  const view = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, 11)

  useEffect(() => {
    const box = view.current
    const body = main.current
    if (!box || !body) return
    // A canvas of its own each time: a context once given back can't be had again.
    const cv = document.createElement('canvas')
    cv.className = a.canvas ?? ''
    box.prepend(cv)
    // Without the graphics card, or once it has taken the canvas back, the edge as the other pages draw it.
    const flat = () => {
      box.dataset.flat = ''
    }
    let orbit: Orbit | null = makeOrbit(cv, () => {
      orbit = null
      flat()
    })
    if (!orbit) {
      cv.remove()
      flat()
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const born = performance.now()

    // The camera, for the canvas's size: the edge at two thirds of the window's height, the sun's place over the altar's (62% across; the middle on a narrow screen).
    let cam = { focal: 1, pitch: 0, bearing: 0 }
    const fit = () => {
      const w = box.clientWidth
      const h = box.clientHeight
      if (w < 10 || h < 10) return
      const dpr = Math.min(window.devicePixelRatio || 1, FINEST, Math.sqrt(MOST_PIXELS / (w * h)))
      const W = Math.round(w * dpr)
      const H = Math.round(h * dpr)
      orbit?.size(W, H)
      const portrait = H > W * 1.1
      const focal = H / 2 / Math.tan(((portrait ? 64 : 40) * DEG) / 2)
      const below = Math.atan((((portrait ? 0.7 : 0.66) - 0.5) * H) / focal)
      const pitch = -(EDGE_DIP - below)
      // The bearing that puts the sun, at its break, that far across.
      const x = (((w >= 900 ? 0.62 : 0.5) - 0.5) * W) / focal
      const e = BREAK
      let bearing = 0
      for (let i = 0; i < 4; i++) {
        const z = Math.cos(e) * Math.cos(bearing) * Math.cos(pitch) + Math.sin(e) * Math.sin(pitch)
        bearing = Math.asin(clamp((x * z) / Math.cos(e), -1, 1))
      }
      cam = { focal, pitch, bearing }
      pending = true
      wake()
    }

    // How far down the sections the reader is: 0 as they reach the window's top, 1 once the closing line stands a little over the window's middle.
    let from = 0
    let to = 1
    const measure = () => {
      const dawn = body.querySelector('[data-dawn]')
      if (!dawn) return
      const y = window.scrollY
      from = body.getBoundingClientRect().top + y
      const d = dawn.getBoundingClientRect()
      to = Math.max(from + 1, d.top + y + d.height / 2 - window.innerHeight * 0.38)
      pending = true
      wake()
    }

    const draw = (now: number) => {
      if (!orbit) return
      const p = clamp((window.scrollY - from) / (to - from))
      const dawn = smooth(0.62, 1, p)
      // Once the closing line has gone up, the day's light rises from the view's foot, to the footer's own paper by the time the view lets go of the window.
      const end = body.querySelector('[data-night]')?.getBoundingClientRect()
      const flood = end ? smooth(1.3, 1, end.bottom / window.innerHeight) : 0
      orbit.draw({
        t: T0 + (reduced ? 0 : (now - born) / 1000),
        sunElevation: reduced ? BREAK : DEEP + (BREAK - DEEP) * Math.pow(p, 1.35),
        sunBearing: cam.bearing,
        sunPower: reduced ? dawn * dawn : 1,
        dawn,
        flood,
        pitch: cam.pitch,
        focal: cam.focal,
      })
    }

    // Drawn at most thirty times a second: while the ground drifts, and as the reader scrolls; never while the sections are off screen or the tab is hidden.
    let seen = false
    let pending = true
    let frame = 0
    let last = -1e9
    const tick = (now: number) => {
      frame = 0
      if (!seen || document.hidden || !orbit) return
      if (now - last >= 31 && (pending || !reduced)) {
        draw(now)
        last = now
        pending = false
      }
      if (!reduced || pending) frame = requestAnimationFrame(tick)
    }
    function wake() {
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const scrolled = () => {
      pending = true
      wake()
    }
    // The footer's paper, as the wash after the night shows it, which the view's foot comes to.
    const wash = body.querySelector('[data-paper]')
    const paper = (wash ? getComputedStyle(wash).backgroundColor : '').match(/[\d.]+/g)?.map(Number)
    if (paper && paper.length >= 3) orbit.paper(paper[0]! / 255, paper[1]! / 255, paper[2]! / 255)
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? false
      if (seen) wake()
    })
    io.observe(body)
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    const grows = new ResizeObserver(measure)
    grows.observe(body)
    window.addEventListener('scroll', scrolled, { passive: true })
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', wake)
    fit()
    measure()
    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      grows.disconnect()
      window.removeEventListener('scroll', scrolled)
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', wake)
      orbit?.dispose()
      orbit = null
      cv.remove()
      delete box.dataset.flat
    }
  }, [main])

  return (
    <div ref={view} className={a.view} aria-hidden="true">
      {/* Without the graphics card: the planet's edge as the other pages draw it. */}
      <div className={a.limb} />
      <div ref={grain} className={a.grain} />
    </div>
  )
}

type Id = keyof typeof SCENE

/** A claim and its lead, the claim the section's heading. */
function Head({ id, className, big }: { id: Id; className?: string; big?: boolean }) {
  return (
    <div className={cx(a.head, className)}>
      <h2 id={`${id}-h`} className={cx(t.title, a.title, big && a.big)}>
        {SCENE[id].title}
      </h2>
      <p className={cx(t.lead, a.lead)}>{SCENE[id].lead}</p>
    </div>
  )
}

/** Where each of the seven things that keep you in flow stands in the sequence. */
const PLACE: Record<string, string | undefined> = {
  accounts: a.fAccounts,
  away: a.fAway,
  automations: a.fAutomations,
  conflicts: a.fConflicts,
  home: a.fHome,
  worktrees: a.fWorktrees,
  workspaces: a.fWorkspaces,
}

/** What keeps you in flow, as things passing in the dark: large and small, offset, the words beside or under each; no cards. */
function Passing() {
  return (
    <ul className={a.passing}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(a.thing, PLACE[tile.id])} data-kind={tile.drawn ? 'drawn' : 'piece'}>
          {/* Every drawing in its dark, so it melts into the night; the pieces of the app in their own light. */}
          <div className={a.pic}>{tile.piece(tile.drawn ? 'dark' : 'light')}</div>
          <div className={a.words}>
            <h3 className={a.thingTitle}>{tile.title}</h3>
            <p className={a.thingLead}>{tile.lead}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function NightBody() {
  const main = useRef<HTMLElement>(null)
  return (
    <main ref={main} id="main" tabIndex={-1} className={a.body}>
      {/* Dark under the nav, down to the middle of the dawn's wash. */}
      <LightUnder tone="ink" className={a.under} />
      {/* The night: the view held behind the sections, let go once the last of them has passed. */}
      <div className={a.night} data-night="">
        {/* The view's track, the night's whole height: the view is held to the window within it, and let go exactly as the night ends. */}
        <div className={a.track}>
          <Sky main={main} />
        </div>

        <section id="independent" className={cx(a.scene, a.opening)} aria-labelledby="independent-h">
          <div className={a.grid}>
            <Head id="independent" big className={a.openingHead} />
            <div className={cx(a.picture, a.board)}>
              <AtWork />
            </div>
          </div>
        </section>

        <section id="coordinator" className={a.scene} aria-labelledby="coordinator-h">
          <div className={cx(a.grid, a.split)}>
            <Head id="coordinator" className={a.splitHead} />
            <div className={cx(a.picture, a.talk)}>
              <AskOnce />
            </div>
          </div>
        </section>

        <section id="review" className={a.scene} aria-labelledby="review-h">
          <div className={a.grid}>
            <Head id="review" className={a.rightHead} />
            <div className={cx(a.picture, a.review)}>
              <Review />
            </div>
          </div>
        </section>

        <section id="flow" className={a.scene} aria-labelledby="flow-h">
          <div className={a.grid}>
            <Head id="flow" className={a.flowHead} />
          </div>
          <Passing />
        </section>

        <section id="edge" className={a.scene} aria-labelledby="edge-h">
          <div className={a.grid}>
            <Head id="edge" className={a.wideHead} />
            <div className={cx(a.picture, a.tour)}>
              <EdgeTour />
            </div>
          </div>
        </section>

        <section id="end" className={a.end} aria-label="Download Althar">
          <div className={a.dawn} data-dawn="">
            <p className={a.endLine}>
              {END[0]} <br />
              <b>{END[1]}</b>
            </p>
            <div className={a.endGet}>
              <Get tone="blue" />
              <OtherMac tone="blue" />
            </div>
          </div>
        </section>
        {/* The dawn's light, washing the foot of the night into the footer's paper. */}
      </div>
      {/* The footer's paper, which the day's light at the view's foot has come to. */}
      <div className={a.wash} data-paper="" aria-hidden="true" />
    </main>
  )
}
