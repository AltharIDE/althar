import { type ReactNode, useRef, useState } from 'react'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import { useDownload } from '../../lib/download'
import { LightUnder } from '../../shared/lightUnder'
import { AskOnce } from '../bodies/desktop/AskOnce'
import { AtWork } from '../bodies/desktop/AtWork'
import { ALSO, TILES } from '../bodies/desktop/Bento'
import { GROUPS } from '../bodies/desktop/Connections'
import { Review } from '../bodies/desktop/Review'
import { SCREENS } from '../bodies/desktop/screens/list'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import { Altitude } from './Altitude'
import aurora from './aurora.webp'
import menubar from './menubar.webp'
import { END, SCENE } from './scenes'
import { useScrolled } from './scroll'
import s from './Story.module.css'
import { useWaterfall } from './waterfall'

/*
 * The home page after its first screen: the product, one scene after
 * another, on the page's paper, the way down told by the scroll. The board
 * pins and plays its task through as you scroll, and pours cobalt where the
 * pointer goes (waterfall.ts); the coordinator's thread rises beside its
 * words; the review pins on a dark ground and plays as you scroll; the
 * features and the app's screens run sideways; the integrations light up
 * name by name; and the download sits on cobalt under its own light. The
 * words never move: only the pictures do. An altitude in the corner counts
 * the way down (Altitude).
 */

type Id = keyof typeof SCENE

/** How far down each scene stands, for the altitude in the corner. */
const KM: Record<Id, number> = { independent: 38, coordinator: 31, review: 24, flow: 17, connections: 10, edge: 3, gallery: 0.5 }

/** The board's round, and the review's loop, as far as the scroll plays them: short of the turn back to the start. */
const BOARD_MS = 15400
const REVIEW_S = 10.8

function Head({ id, className, white }: { id: Id; className?: string; white?: boolean }) {
  return (
    <div className={cx(s.head, className)} aria-hidden={white || undefined}>
      <h2 id={white ? undefined : `${id}-h`} className={s.title}>
        {SCENE[id].title}
      </h2>
      <p className={s.lead}>{SCENE[id].lead}</p>
    </div>
  )
}

function Board() {
  const box = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const white = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<number | null>(null)
  const still = useScrolled(box, { pin: 2.4 }, (p) => setAt(p * BOARD_MS), 0.62)
  useWaterfall(box, canvas, dot, white, still)
  return (
    <section ref={box} id="independent" className={cx(s.scene, s.board)} aria-labelledby="independent-h" data-km={KM.independent}>
      <canvas ref={canvas} className={s.fall} aria-hidden="true" />
      <div ref={dot} className={s.dot} aria-hidden="true" />
      <div className={s.stick} data-stick="">
        <div className={s.wrap}>
          <div className={s.heads}>
            <Head id="independent" />
            <div ref={white} className={s.white}>
              <Head id="independent" white />
            </div>
          </div>
          <div className={s.boardShot}>
            <AtWork at={still ? null : at} />
          </div>
        </div>
      </div>
    </section>
  )
}

/** What you ask Tally's coordinator, set beside its thread. */
const ASK = { who: 'Tally’s coordinator', text: 'Backfill idempotency keys on the refunds made before PR 1184.' }

function Coordinator() {
  const box = useRef<HTMLElement>(null)
  useScrolled(box, { enter: true })
  return (
    <section ref={box} id="coordinator" className={s.scene} aria-labelledby="coordinator-h" data-km={KM.coordinator}>
      <div className={cx(s.wrap, s.coord)}>
        <div className={s.coordWords}>
          <h2 id="coordinator-h" className={s.title}>
            {SCENE.coordinator.title}
          </h2>
          <p className={s.lead}>{SCENE.coordinator.lead}</p>
          <p className={s.ask}>
            <span className={s.label}>{ASK.who}</span>
            {ASK.text}
          </p>
        </div>
        <div className={cx(s.frame, s.coordShot)}>
          <AskOnce />
        </div>
      </div>
    </section>
  )
}

function ReviewScene() {
  const box = useRef<HTMLElement>(null)
  const [at, setAt] = useState<number | null>(null)
  const still = useScrolled(box, { pin: 2.6 }, (p) => setAt(Math.min(REVIEW_S, p * 11.2)), 1)
  return (
    <section ref={box} id="review" className={cx(s.scene, s.review)} aria-labelledby="review-h" data-km={KM.review}>
      <LightUnder tone="ink" className={s.under} />
      <div className={s.stick} data-stick="">
        <div className={s.wrap}>
          <Head id="review" />
          <div className={s.revWrap}>
            <Review at={still ? null : at} />
          </div>
        </div>
      </div>
    </section>
  )
}

/** The six features drawn large, the six drawn small, as the bento has them. */
const LARGE = TILES.filter((t) => !t.compact || t.id === 'canvas')
const SMALL = TILES.filter((t) => t.compact && t.id !== 'canvas')

function Card({ no, title, lead, children }: { no: number; title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <span className={s.no}>{String(no).padStart(2, '0')}</span>
        <h3 className={s.cardTitle}>{title}</h3>
        <p className={s.small}>{lead}</p>
      </div>
      {children && <div className={s.pic}>{children}</div>}
    </article>
  )
}

function Flow() {
  const track = useRef<HTMLDivElement>(null)
  useScrolled(track, { track: true })
  return (
    <section id="flow" className={s.scene} aria-labelledby="flow-h" data-km={KM.flow}>
      <div className={s.wrap}>
        <Head id="flow" />
      </div>
      <div ref={track} className={s.track}>
        <div className={s.stick} data-stick="">
          <div className={s.wrap}>
            <div className={s.row} data-row="">
              {LARGE.map((tile, i) => (
                <Card key={tile.id} no={i + 1} title={tile.title} lead={tile.lead}>
                  {tile.piece('light')}
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className={s.wrap}>
        <div className={s.mini}>
          {SMALL.map((tile, i) => (
            <Card key={tile.id} no={LARGE.length + i + 1} title={tile.title} lead={tile.lead} />
          ))}
        </div>
        <div className={s.also}>
          <h3 className={s.label}>And also</h3>
          <ul>
            {ALSO.map((word) => (
              <li key={word}>{word}</li>
            ))}
          </ul>
        </div>
        <p className={s.more}>And so, so much more.</p>
      </div>
    </section>
  )
}

function Connect() {
  const box = useRef<HTMLElement>(null)
  const [lit, setLit] = useState(Infinity)
  const names = GROUPS.reduce((n, g) => n + g.items.length, 0)
  // Each name lights as the list comes up the window.
  useScrolled(box, { enter: true }, (p) => setLit(Math.round(Math.min(1, Math.max(0, (p - 0.15) / 0.75)) * names)), 1)
  // Where each group's names start in the count.
  const starts = GROUPS.map((_, i) => GROUPS.slice(0, i).reduce((n, g) => n + g.items.length, 0))
  return (
    <section ref={box} id="connections" className={cx(s.scene, s.connect)} aria-labelledby="connections-h" data-km={KM.connections}>
      <div className={s.wrap}>
        <Head id="connections" />
        <ol className={s.groups}>
          {GROUPS.map((group, i) => (
            <li key={group.name} className={cx(group.wide && s.wide)}>
              <h3 className={s.label}>
                {String(i + 1).padStart(2, '0')} {group.name}
              </h3>
              <ul>
                {group.items.map((item, k) => (
                  <li key={item.id} data-on={starts[i]! + k < lit || undefined} data-first={k === 0 || undefined}>
                    {item.name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** The menu bar, for a Mac without a notch: what it says, and where it is set. */
const MENU = {
  title: (
    <>
      No notch? <b>The menu bar.</b>
    </>
  ),
  lead: 'On a Mac without one, or on a second screen, Althar sits in the menu bar. Click its mark and the same list drops down: answer, open, carry on.',
  path: ['Settings', 'While you’re in another app', 'In the menu bar'],
  alt: 'Althar’s list dropping down from the menu bar over a terminal',
}

function Notch() {
  return (
    <section id="edge" className={s.scene} aria-labelledby="edge-h" data-km={KM.edge}>
      <div className={s.wrap}>
        <Head id="edge" />
        <div className={s.notch}>
          <div className={s.tour}>
            <EdgeTour tone="paper" />
          </div>
          <div>
            <div className={s.frame}>
              <img src={menubar} alt={MENU.alt} width={1240} height={1202} loading="lazy" />
            </div>
            <h3 className={s.menuTitle}>{MENU.title}</h3>
            <p className={s.small}>{MENU.lead}</p>
            <p className={s.crumbs}>
              {MENU.path.map((step, i) => (
                <span key={step}>
                  {i > 0 && <i aria-hidden="true">›</i>}
                  {step}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

const FILES = import.meta.glob<string>('../bodies/desktop/screens/*-920h.webp', { eager: true, query: '?url', import: 'default' })
const screen = (file: string) => FILES[`../bodies/desktop/screens/${file}-920h.webp`] ?? ''

function Screens() {
  const track = useRef<HTMLDivElement>(null)
  useScrolled(track, { track: true })
  return (
    <section id="gallery" className={s.scene} aria-labelledby="gallery-h" data-km={KM.gallery}>
      <div className={s.wrap}>
        <Head id="gallery" />
      </div>
      <div ref={track} className={s.track}>
        <div className={s.stick} data-stick="">
          <div className={s.wrap}>
            <div className={cx(s.row, s.shots)} data-row="">
              {SCREENS.map((x) => (
                <figure key={x.file} className={s.shot}>
                  <div className={s.frame}>
                    <img src={screen(x.file)} alt={x.alt} loading="lazy" />
                  </div>
                  <figcaption>
                    <b>{x.name}</b>
                    <span>{x.line}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** The light's blocks along the foot of the download's cobalt, each brightening on its own beat. */
const BLOCKS = [1, 2, 3, 4, 5] as const

function End() {
  const box = useRef<HTMLElement>(null)
  const download = useDownload()
  useScrolled(box, { enter: true })
  return (
    <section ref={box} id="end" className={s.end} aria-label="Download Althar">
      <LightUnder tone="light" className={s.under} />
      <div className={s.aurora} aria-hidden="true">
        <img src={aurora} alt="" />
        {BLOCKS.map((b) => (
          <img key={b} src={aurora} alt="" className={s.block} data-block={b} />
        ))}
      </div>
      <div className={s.wrap}>
        <p className={s.endLine}>
          {END[0]}
          <br />
          <b>{END[1]}</b>
        </p>
        <div className={s.endCtas}>
          <a className={s.endGet} href={download.href}>
            {download.pending ? 'Download' : download.label}
          </a>
          <a className={s.endStar} href={LINKS.repo}>
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}

export function Story() {
  return (
    <main id="main" tabIndex={-1} className={s.story}>
      <Board />
      <Coordinator />
      <ReviewScene />
      <Flow />
      <Connect />
      <Notch />
      <Screens />
      <End />
      <Altitude />
    </main>
  )
}
