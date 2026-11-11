import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

import { cx } from '../../../lib/cx'
import { Get, OtherMac } from '../../../shared/Close'
import { useGrain } from '../../../shared/grain'
import { LightUnder } from '../../../shared/lightUnder'
import { AskOnce } from './AskOnce'
import { AtWork } from './AtWork'
import { Connections } from './Connections'
import { type Tile, TILES } from './Bento'
import { Review } from './Review'
import { EdgeTour } from '../kit/EdgeTour'
import t from '../kit/type.module.css'
import dark from '../../../../../../packages/ui/src/styles/dark.css?raw'
import c from './DesktopBody.module.css'
import { stars, WALL } from './wall'

/*
 * Desktop: the product, shown, after the first screen and the Runs on band,
 * in the same night as the orrery: its dark, its few stars, its hairlines.
 * Past the band you are inside the cabin; its wall's milled isogrid shows
 * only where a screen's light falls on its ribs. The app's pictures are the
 * wall's screens, drawn in the app's own dark theme, each behind a hairline;
 * each claim is stamped beside its screen, as the changelog stamps its
 * releases, on a rail that runs down the wall, its light on where you are
 * reading. The sections open and close on a window: first the night side of
 * the planet, its edge lit cobalt; last the same edge flatter and lower, the
 * dawn coming up along it, over the download. What keeps you in flow is one
 * console, its modules seamed into it by hairlines. Nothing moves but what
 * the pictures do.
 */

/** What each scene says: its claim and its lead, by the scene's id. */
export const SCENE = {
  independent: {
    title: (
      <>
        Every agent’s work.
        <br />
        <b>One board.</b>
      </>
    ),
    lead: 'Up next, running, needs you, settled: every task across Claude Code, Codex, Gemini and Qwen, in one place. When one agent runs out, another takes over.',
  },
  coordinator: {
    title: (
      <>
        Every project
        <br />
        <b>has a manager.</b>
      </>
    ),
    lead: 'It’s called the coordinator. It knows your whole project, and puts a team of agents on every ask.',
  },
  review: {
    title: (
      <>
        No more <b>meat proxying.</b>
      </>
    ),
    lead: 'Every change is reviewed by a model from another lab, and fixed until it’s clean.',
  },
  flow: {
    title: (
      <>
        Fall in love
        <br />
        <b>with building again.</b>
      </>
    ),
    lead: 'Tired of juggling terminals, re-explaining your project and babysitting agents? So were we.',
  },
  connections: {
    title: (
      <>
        Works with
        <br />
        <b>what you already use.</b>
      </>
    ),
    lead: 'Code on GitHub, GitLab or Bitbucket. Issues in Linear, Jira or Trello. Anything else through an MCP server. Connect each once, and every agent can use it.',
  },
  edge: {
    title: (
      <>
        Wherever you are, <b>still in reach.</b>
      </>
    ),
    lead: 'Althar sits round your Mac’s notch, in whatever you’re doing: point at it to answer a permission or open a pull request, and carry on.',
  },
} as const

/** The last line, by the download: its quiet half, then its heavy one. */
export const END = ['The craft of a paid app.', 'The freedom of open source.'] as const

/** The app's own dark theme (the kit's dark.css), for the pictures on the wall alone: the page round them keeps its own. */
const DARK_PICTURES = dark.replace(":root[data-theme='dark']", "[data-pictures='dark']")
let dressed = false
const dressPictures = () => {
  if (dressed) return
  dressed = true
  const style = document.createElement('style')
  style.dataset.cabin = ''
  style.textContent = DARK_PICTURES
  document.head.appendChild(style)
}

type Id = keyof typeof SCENE

/** A station's claim and its lead. */
export interface Scene {
  title: ReactNode
  lead: string
}

/** A station's stamp: its number, its name on the wall, and the height it stands at on the way down. */
export interface StampSpec {
  no: string
  name: string
  km: number
}

/*
 * While a direction is being chosen (src/proto, in development only):
 * another body for the flow, and stations of their own after any one. The page itself passes none. Delete with src/proto.
 */
export interface Trial {
  flow?: { scene?: Scene; body: ReactNode }
  after?: Partial<Record<Id, ReactNode>>
}

/** Each station: its number, its name on the wall, and the height it stands at on the way down. */
const STATIONS: Record<Id, StampSpec> = {
  independent: { no: '01', name: 'Board', km: 38 },
  coordinator: { no: '02', name: 'Coordinator', km: 31 },
  review: { no: '03', name: 'Review', km: 24 },
  flow: { no: '04', name: 'Flow', km: 17 },
  connections: { no: '05', name: 'Connections', km: 10 },
  edge: { no: '06', name: 'Notch', km: 3 },
}

/** A station's stamp, on the rail: its node, its number and name, a rule, and the height it stands at. */
function Stamp({ id, stamp }: { id: string; stamp?: StampSpec }) {
  const station = stamp ?? STATIONS[id as Id]
  return (
    <p className={c.stamp} aria-hidden="true">
      <span className={c.node} />
      <b>{station.no}</b>
      <span>{station.name}</span>
      <span className={c.rule} />
      <span className={c.alt}>
        Alt <b>{station.km.toFixed(1)}</b> km
      </span>
    </p>
  )
}

/** A station on the wall: its stamp, then its head and its screen, laid out as `layout` says. */
export function Station({
  id,
  layout,
  stamp,
  scene,
  children,
}: {
  id: string
  layout: 'split' | 'wide' | 'bank' | 'notch'
  stamp?: StampSpec
  scene?: Scene
  children: ReactNode
}) {
  const words = scene ?? SCENE[id as Id]
  return (
    <section id={id} className={cx(c.station, c[layout])} aria-labelledby={`${id}-h`} data-station="">
      <Stamp id={id} stamp={stamp} />
      <div className={c.head}>
        <h2 id={`${id}-h`} className={cx(t.title, c.title)}>
          {words.title}
        </h2>
        <p className={cx(t.lead, c.lead)}>{words.lead}</p>
      </div>
      {children}
    </section>
  )
}

/** A screen set in the wall: its bezel, its glass, and the light it throws on the ribs round it. */
function Screen({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx(c.screen, className)} data-light="">
      <div className={c.glass}>{children}</div>
    </div>
  )
}

/** A window in the wall: its bezel, the sky in it (stars, the air, the planet's lit edge, the glass's grain), then what stands in it. */
function Window({ className, seed, children }: { className?: string; seed: number; children: ReactNode }) {
  const sky = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, seed)
  useLayoutEffect(() => {
    if (sky.current) sky.current.style.setProperty('--stars', stars(seed))
  }, [seed])
  return (
    <div className={cx(c.window, className)}>
      <div ref={sky} className={c.sky} aria-hidden="true">
        <div className={c.stars} />
        <div className={c.haze} />
        <div className={c.limb} />
        <div className={c.sun} />
        <div ref={grain} className={c.grain} />
      </div>
      {children}
    </div>
  )
}

/** What keeps you in flow: one console, its modules seamed into it, each with its number and its light. */
export function Console({ tiles = TILES, className }: { tiles?: Tile[]; className?: string }) {
  return (
    <ol className={cx(c.console, className)} data-light="">
      {tiles.map((tile, i) => (
        <li
          key={tile.id}
          className={cx(c.module, c[`span${tile.span}`])}
          data-drawn={tile.drawn ? '' : undefined}
          data-small={tile.small ? '' : undefined}
        >
          <span className={c.plate} aria-hidden="true">
            <b>{String(i + 1).padStart(2, '0')}</b>
            <i className={c.led} />
          </span>
          <div className={c.moduleHead}>
            <h3 className={c.moduleTitle}>{tile.title}</h3>
            <p className={c.moduleLead}>{tile.lead}</p>
          </div>
          <div className={c.piece}>{tile.piece(tile.drawn ? 'dark' : 'light')}</div>
        </li>
      ))}
    </ol>
  )
}

/** Where the screens' light falls on the wall: the lit ribs, masked to a pool round each screen; measured again whenever anything changes size. */
function useLights(main: RefObject<HTMLElement | null>, lit: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const body = main.current
    const layer = lit.current
    if (!body || !layer) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const box = body.getBoundingClientRect()
      const pools = [...body.querySelectorAll<HTMLElement>('[data-light]')].map((el) => {
        const r = el.getBoundingClientRect()
        const x = Math.round(r.left - box.left + r.width / 2)
        const y = Math.round(r.top - box.top + r.height / 2)
        const rx = Math.round(r.width / 2 + Math.min(240, r.width * 0.22))
        const ry = Math.round(r.height / 2 + Math.min(160, r.height * 0.2))
        return `radial-gradient(${rx}px ${ry}px at ${x}px ${y}px, #000 40%, rgba(0,0,0,0.45) 72%, transparent)`
      })
      const mask = pools.join(', ')
      if (mask === last) return
      last = mask
      layer.style.maskImage = mask
      layer.style.webkitMaskImage = mask
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(later)
    ro.observe(body)
    window.addEventListener('resize', later)
    void document.fonts?.ready.then(later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [main, lit])
}

/** The rail's light: on at the station you are reading, the one across the window's middle. */
function useRail(main: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const body = main.current
    if (!body) return
    const stations = [...body.querySelectorAll<HTMLElement>('[data-station]')]
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) for (const one of stations) one.toggleAttribute('data-on', one === e.target)
        }
      },
      { rootMargin: '-48% 0px -48% 0px' },
    )
    for (const one of stations) io.observe(one)
    return () => io.disconnect()
  }, [main])
}

export function DesktopBody({ trial }: { trial?: Trial }) {
  const main = useRef<HTMLElement>(null)
  const lit = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  useGrain(grain, 23)
  useLights(main, lit)
  useRail(main)
  // The pictures' dark, before the first paint; and the wall's few stars, drawn once.
  useLayoutEffect(() => {
    dressPictures()
    main.current?.style.setProperty('--wall-stars', stars(29, 960, 5200))
  }, [])
  return (
    <main ref={main} id="main" tabIndex={-1} className={c.body} data-pictures="dark" style={{ '--wall-lit': WALL.lit } as CSSProperties}>
      {/* Dark under the nav, all the way down: it turns to smoked glass over the cabin. */}
      <LightUnder tone="ink" className={c.under} />
      <div className={c.wall} aria-hidden="true">
        <div ref={lit} className={c.wallLit} />
        <div ref={grain} className={c.wallGrain} />
      </div>

      <section id="independent" className={cx(c.station, c.first)} aria-labelledby="independent-h" data-station="">
        <Stamp id="independent" />
        <Window seed={7} className={c.opening}>
          <div className={c.head}>
            <h2 id="independent-h" className={cx(t.title, c.title)}>
              {SCENE.independent.title}
            </h2>
            <p className={cx(t.lead, c.lead)}>{SCENE.independent.lead}</p>
          </div>
          <div className={c.board}>
            <AtWork />
          </div>
        </Window>
      </section>

      {trial?.after?.independent}

      <Station id="coordinator" layout="split">
        <Screen className={c.talk}>
          <AskOnce />
        </Screen>
      </Station>
      {trial?.after?.coordinator}

      <Station id="review" layout="wide">
        <Screen className={c.review}>
          <Review />
        </Screen>
      </Station>
      {trial?.after?.review}

      <Station id="flow" layout="bank" scene={trial?.flow?.scene}>
        {trial?.flow?.body ?? <Console />}
      </Station>
      {trial?.after?.flow}

      <Station id="connections" layout="bank">
        <Connections />
      </Station>
      {trial?.after?.connections}

      <Station id="edge" layout="notch">
        <div className={c.tour}>
          <EdgeTour />
        </div>
      </Station>
      {trial?.after?.edge}

      {/* The last window: the planet's edge lower and flatter, the dawn coming up along it, and the download. */}
      <section id="end" className={c.endStation} aria-label="Download Althar">
        <Window seed={11} className={c.closing}>
          <div className={c.endRow}>
            <p className={c.endLine}>
              {END[0]} <br />
              <b>{END[1]}</b>
            </p>
            <div className={c.endGet}>
              <Get tone="blue" />
              <OtherMac tone="blue" />
            </div>
          </div>
        </Window>
      </section>
    </main>
  )
}
