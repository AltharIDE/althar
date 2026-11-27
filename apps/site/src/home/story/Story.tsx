import { YourWorkers } from '@althar/ui/screens'
import { useRef, useState } from 'react'

import { LINKS } from '../../content/facts'
import { useMedia } from '../../lib/browser'
import { cx } from '../../lib/cx'
import { useDownload } from '../../lib/download'
import { LightUnder } from '../../shared/lightUnder'
import { GROUPS } from '../bodies/desktop/Connections'
import { Review } from '../bodies/desktop/Review'
import { SCREENS } from '../bodies/desktop/screens/list'
import canvasStill from './canvas-signin.webp'
import { CanvasScreen } from '../bodies/desktop/CanvasScreen'
import { EdgeTour } from '../bodies/kit/EdgeTour'
import { Altitude, KM } from './Altitude'
import { Community } from './Community'
import { Flow } from './Flow'
import { Patch, sides, STORY_S } from './Patch'
import { Race } from './Race'
import { END, SCENE, VIEW_HEADS } from './scenes'
import { useScrolled } from './scroll'
import { VIEW_COUNT, Views } from './Views'
import s from './Story.module.css'
import { useWaterfall } from './waterfall'

/*
 * The home page after its first screen: the product, one scene after
 * another, on the page's paper, the way down told by the scroll. First the
 * race (Race.tsx); then three of the app's views at work in a row (Views),
 * under a heading that pours cobalt where the pointer goes (waterfall.ts); your workers, one and then a fleet
 * round your computer, played by the scroll (the kit's YourWorkers); the community's Discord, busy beside its
 * words and the way in (Community.tsx); the review pins on a dark ground and plays as you scroll; the
 * features and the app's screens run sideways; the integrations light up
 * name by name; and the download sits on cobalt under its own light. The
 * words never move: only the pictures do. An altitude in the corner counts
 * the way down (Altitude).
 */

type Id = keyof typeof SCENE

/** The review's loop, as far as the scroll plays it: short of the turn back to the start. */
const REVIEW_S = 10.8
/** How far the review's story has got, in s, by the time it settles into place: today's first copy under way. */
const SETTLING = 1.2
const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** `quiet`: the heading set as the menu bar's is (EdgeTour), smaller and plain, its beat in the same face. */
function Head({ id, className, white, quiet }: { id: Id; className?: string; white?: boolean; quiet?: boolean }) {
  return (
    <div className={cx(s.head, className)} aria-hidden={white || undefined}>
      <h2 id={white ? undefined : `${id}-h`} className={cx(s.title, quiet && s.quiet)}>
        {SCENE[id].title}
      </h2>
      <p className={s.lead}>{SCENE[id].lead}</p>
    </div>
  )
}

/**
 * The board scene's heading, one for each view (scenes.tsx VIEW_HEADS), the
 * one for the view in front shown and the others there unseen, all in the
 * one place, so the scene never moves as they change. `white`: the copy
 * the cobalt shows through (waterfall.ts), never read.
 */
function ViewHeads({ at, white }: { at: number; white?: boolean }) {
  return (
    <div className={s.viewHeads}>
      {VIEW_HEADS.map((head, i) => (
        <div key={i} className={s.head} data-on={i === at || undefined} aria-hidden={white || i !== at || undefined}>
          <h2 id={!white && i === at ? 'independent-h' : undefined} className={s.title}>
            {head.title}
          </h2>
          <p className={s.lead}>{head.lead}</p>
        </div>
      ))}
    </div>
  )
}

function Board() {
  const box = useRef<HTMLElement>(null)
  const pool = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)
  const white = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  // Pinned for a window and a quarter per view: the scroll flips which is in front, then lets go.
  const still = useScrolled(
    box,
    { pin: 1.25 * VIEW_COUNT, bare: true },
    (p) => setAt(Math.min(VIEW_COUNT - 1, Math.floor(p * VIEW_COUNT))),
    0,
  )
  useWaterfall(box, pool, dot, white, still)
  return (
    <section ref={box} id="independent" className={cx(s.scene, s.board)} aria-labelledby="independent-h" data-km={KM.independent}>
      <div ref={dot} className={s.dot} aria-hidden="true" />
      <div className={s.stick} data-stick="">
        <div ref={pool} className={s.fall} aria-hidden="true" />
        <div className={s.wrap}>
          <div className={s.heads}>
            <ViewHeads at={at} />
            <div ref={white} className={s.white}>
              <ViewHeads at={at} white />
            </div>
          </div>
        </div>
        <Views at={at} />
      </div>
    </section>
  )
}

/**
 * Your workers: one, close up, running a task and sending its commits back,
 * then the view pulling back to rings of them round your computer, all at
 * work (the kit's YourWorkers, the app's What's new and the changelog draw
 * the same). Pinned on a desktop, the scroll plays it; on a tablet or a
 * phone it isn't pinned, and plays its own loop while in sight. With motion
 * reduced it stands still on the fleet.
 */
function WorkersScene() {
  const box = useRef<HTMLElement>(null)
  const narrow = useMedia('(max-width: 900px)')
  const [at, setAt] = useState(0)
  const still = useScrolled(box, { pin: narrow ? 0 : 2.6, bare: true }, setAt, 1)
  return (
    <section ref={box} id="workers" className={cx(s.scene, s.workers)} aria-labelledby="workers-h" data-km={KM.workers}>
      <div className={s.stick} data-stick="">
        <div className={s.wrap}>
          <Head id="workers" />
          <YourWorkers className={s.fleet} {...(narrow || still ? {} : { at })} />
        </div>
      </div>
    </section>
  )
}

/**
 * The review, drawn as a patch (Patch.tsx): today first, its preview your
 * side of the drawing, the answers carried by hand, and a line taken out as
 * each lands; then the preview pans to Althar's side, the heading's new line
 * types in, and the review's hunks come in as Althar's side gets to each,
 * all played by the scroll while pinned. On a phone it is pinned and played
 * the same, laid out for it (Patch.module.css): the heading, the lines under
 * it, and the preview under those. On a tablet it isn't pinned: one column,
 * all of it there, the drawing whole and playing as it scrolls by.
 */
function ReviewScene() {
  const box = useRef<HTMLElement>(null)
  const phone = useMedia('(max-width: 699px)')
  // A tablet: not pinned.
  const narrow = useMedia('(max-width: 900px)') && !phone
  const [run, setRun] = useState<number | null>(null)
  const [enter, setEnter] = useState(1)
  // Its parts come in as it scrolls up into place (Patch), and today's first copy is under way as it settles.
  useScrolled(box, { enter: true, bare: true }, setEnter, 1)
  // Pinned, today's side of the drawing plays first and then Althar's (Patch); unpinned, the whole drawing plays as one.
  const still = useScrolled(box, { pin: narrow ? 0 : 4.6, bare: true }, (p) => setRun(p * (narrow ? 11.2 : 24.6)), 1)
  const at = run === null ? null : narrow ? Math.min(REVIEW_S, run) : Math.min(STORY_S, run + SETTLING * clamp((enter - 0.5) / 0.4))
  const seen = at === null || still ? {} : narrow ? { at } : { at: sides(at).today, after: sides(at).althar }
  return (
    <section ref={box} id="review" className={cx(s.scene, s.review)} aria-labelledby="review-h" data-km={KM.review}>
      <LightUnder tone="ink" className={s.under} />
      <div className={s.stick} data-stick="">
        <div className={s.wrap}>
          <Patch at={still || narrow ? Infinity : (at ?? 0)} enter={enter} phone={phone && !still} preview={<Review {...seen} flush />} />
        </div>
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
        <Head id="connections" quiet />
        {/* As the old home page had it: a console seamed by one hairline, the agents across its top, then code, issues and everything else, each name with its mark. */}
        <ol className={s.groups}>
          {GROUPS.map((group, i) => (
            <li key={group.name} className={cx(s.cell, group.wide && s.wide)}>
              <h3 className={s.plate}>
                <b>{String(i + 1).padStart(2, '0')}</b> {group.name}
              </h3>
              <ul className={s.marks}>
                {group.items.map((item, k) => (
                  <li key={item.id} data-on={starts[i]! + k < lit || undefined}>
                    {item.mark}
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

/** Wherever you are: the tour round the notch, then the menu bar for a Mac without one (EdgeTour, which carries both), on the page's paper. */
function Notch() {
  return (
    <section id="edge" className={cx(s.scene, s.edge)} aria-labelledby="edge-h" data-km={KM.edge}>
      <div className={s.wrap}>
        <Head id="edge" />
      </div>
      <EdgeTour tone="paper" />
    </section>
  )
}

const FILES = import.meta.glob<string>('../bodies/desktop/screens/*-920h.webp', { eager: true, query: '?url', import: 'default' })
const screen = (file: string) => FILES[`../bodies/desktop/screens/${file}-920h.webp`] ?? ''

function Screens() {
  const track = useRef<HTMLDivElement>(null)
  useScrolled(track, { track: true })
  return (
    <section id="gallery" className={cx(s.scene, s.gallery)} aria-labelledby="gallery-h" data-km={KM.gallery}>
      {/* The heading holds over the screens while they run sideways, so what they are stays in sight. */}
      <div ref={track} className={s.track}>
        <div className={s.stick} data-stick="">
          <div className={s.wrap}>
            <Head id="gallery" />
          </div>
          <div className={s.wrap}>
            <div className={cx(s.row, s.shots)} data-row="">
              {SCREENS.map((x) => (
                <figure key={x.file} className={s.shot}>
                  <div className={s.frame}>
                    {/* The canvas is drawn here, the sign-in page the carousel builds (CanvasScreen); the rest are the brand pack's
                        screenshots. On a phone the canvas is a picture too, of this same card as a desktop draws it
                        (canvas-signin.webp; Story.module.css shows one or the other). */}
                    {x.file === 'canvas' ? (
                      <>
                        <div className={s.live}>
                          <CanvasScreen label={x.alt} />
                        </div>
                        <img className={s.still} src={canvasStill} alt={x.alt} loading="lazy" />
                      </>
                    ) : (
                      <img src={screen(x.file)} alt={x.alt} loading="lazy" />
                    )}
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
    <section ref={box} id="end" className={s.end} aria-label="Download Althar" data-km={KM.end}>
      <LightUnder tone="light" className={s.under} />
      <div className={s.aurora} aria-hidden="true">
        <i />
        {BLOCKS.map((b) => (
          <i key={b} className={s.block} data-block={b} />
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
      <Race />
      <Board />
      <WorkersScene />
      <Community />
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
