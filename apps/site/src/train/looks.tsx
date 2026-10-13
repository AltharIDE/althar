import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'

import { type FC, useId } from 'react'

import { LINKS } from '../content/facts'
import { TRAIN } from '../content/train'
import { Get } from '../shared/Close'
import { AT, SPEED, whenPace } from './journey'
import s from './Looks.module.css'
import { clamp, type Knock, release, ring } from './motion'
import { PASSER } from './passer'
import type { Box } from './world'

/*
 * Three ways to set the train's words. The scene and its camera are the same
 * in each (TrainHero.tsx); each look sets the words where and how it likes,
 * inside the stage, measured by the photograph's window (--px, --py, --u,
 * --wx… from the stage), and names its beats: when "fast." lands (the
 * climax, which the camera pushes toward and the headline's smear snaps
 * back at), what knocks the camera, and what flashes the light.
 *
 * The headline's words rise out of masks on their own time (arrive). "fast."
 * comes in on the train's: `frame` is called with the journey's second on
 * every frame, so it lands exactly with the speed, and `?t=` or reduced
 * motion shows the same moment every time.
 *
 *   title  a film's title card in one serif; "fast." slams in letter by
 *          letter, stretched and smeared, squashes on contact, and each
 *          letter knocks the ones before it.
 *   depth  "fast." huge in the scene, behind the passengers; a train goes
 *          by the other way, its pressure shaking the carriage, and its
 *          tail uncovers the word standing beyond it, coming into focus.
 *   swiss  small and exact, in a corner, with the train's particulars;
 *          "fast." turns over on a station's departure board, each tile
 *          bouncing as it stops, and catches the light.
 */

export type LookName = 'title' | 'depth' | 'swiss'

/** What a look's frame is told about the scene: the middle window, in the first screen's px, and whether its word is painted there. Null before the scene is drawn. */
export interface Scene {
  win: Box
  painted: boolean
}

/** A look's beats: when "fast." lands, what knocks the camera, what flashes the light through the glass. */
export interface Beats {
  climax: number
  knocks: Knock[]
  flashes: Array<{ at: number; strength: number; decay: number }>
  /** How much the speed smears the headline before "fast." lands, 0 to 1. */
  wind: number
}

export interface Look {
  name: string
  Words: FC
  beats: Beats
  /** Brings the headline in, from the moment the train sets off; returns the animations, to pause and cancel. */
  arrive: (within: HTMLElement) => Animation[]
  /** Sets "fast." for the journey's second `t`. */
  frame: (within: HTMLElement, t: number, scene: Scene | null) => void
  /** Whether the other train goes by. */
  passer?: boolean
  /** A word painted into the scene, behind the other train (bigword.ts). */
  sceneWord?: string
}

const KMH = Math.round(SPEED.slow * 3.6)
/** The word's letters: it is plain ASCII, so a split by character is a split by letter. */
const LETTERS = TRAIN.last.split('')

/** Quick out, long settle: an expo out. */
const EXPO = 'cubic-bezier(0.19, 1, 0.22, 1)'

/** A line's words, each in a mask it rises out of. The mask is what the speed smears (data-wind). */
function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className={s.mask} data-wind>
            <span className={s.word} data-word>
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

const animate = (el: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions) =>
  el ? [el.animate(frames, { fill: 'backwards', ...options })] : []

/** The headline's words rise out of their masks one after another, a little turned and righting as they come; then the rest. */
const arriveAll = (within: HTMLElement, stagger = 55) => [
  ...[...within.querySelectorAll('[data-word]')].flatMap((word, i) =>
    animate(word, [{ transform: 'translateY(108%) rotate(5deg)' }, { transform: 'none' }], {
      duration: 1050,
      delay: AT.words * 1000 + i * stagger,
      easing: EXPO,
    }),
  ),
  ...[...within.querySelectorAll<HTMLElement>('[data-arrive]')].flatMap((el) => {
    const delay = Number(el.dataset.arrive || 0)
    return [
      ...animate(el, [{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 1000, delay, easing: EXPO }),
      ...animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay, easing: 'ease-out' }),
    ]
  }),
]

const rest = (ms: number) => AT.rest * 1000 + ms

/** Writes a style only when it changes: the frame runs sixty times a second. */
const put = (el: HTMLElement | SVGElement, prop: 'transform' | 'opacity' | 'filter', value: string) => {
  if (el.style[prop] !== value) el.style[prop] = value
}

/* ------------------------------------------------------------- title */

/**
 * The letters' flight: when the first leaves, how far behind each other
 * they leave, how long each takes from beyond the glass to its place, and
 * how much it has slowed by then (1 would be to a standstill: it hits
 * still moving, so it squashes).
 */
const FLY = { at: whenPace(0.2), stagger: 0.075, flight: 0.42, brake: 0.74 }
/** When letter i hits its place. */
const contact = (i: number) => FLY.at + i * FLY.stagger + FLY.flight
const TITLE_CLIMAX = contact(LETTERS.length - 1)

const Title: FC = () => {
  // For the filters' ids: React's own ids carry characters a url(#…) would need escaped.
  const id = `fast${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <>
      <header className={`${s.window} ${s.glass}`} data-glass>
        {/* A blur along the line for each letter of "fast.", as strong as the letter is fast. */}
        <svg className={s.filters} aria-hidden="true">
          <defs>
            {LETTERS.map((_, i) => (
              <filter key={i} id={`${id}-blur-${i}`} x="-150%" y="-10%" width="400%" height="120%" colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation="0 0" data-blur />
              </filter>
            ))}
          </defs>
        </svg>
        <div className={s.titleCard}>
          <p className={s.titleMark} data-arrive={250}>
            Althar
          </p>
          <h1 className={s.titleH1}>
            <Words text={TRAIN.title} />{' '}
            <em className={s.titleFast} aria-label={TRAIN.last}>
              {LETTERS.map((letter, i) => (
                <span key={i} className={s.letter} data-letter data-filter={`${id}-blur-${i}`} aria-hidden="true">
                  {letter}
                </span>
              ))}
            </em>
          </h1>
          <div className={s.titleWays} data-arrive={rest(250)}>
            <Get tone="blue" />
          </div>
        </div>
      </header>
      <footer className={s.foot} data-arrive={rest(450)}>
        <p className={s.lead}>{TRAIN.lead}</p>
      </footer>
    </>
  )
}

const title: Look = {
  name: 'Title card',
  Words: Title,
  beats: {
    climax: TITLE_CLIMAX,
    knocks: [
      ...LETTERS.slice(0, -1).map((_, i) => ({ at: contact(i), x: 1.6, y: 0.9, freq: 46, decay: 14 })),
      { at: TITLE_CLIMAX, x: 12, y: 6, zoom: -0.028, freq: 30, decay: 5.5 },
    ],
    flashes: [{ at: TITLE_CLIMAX, strength: 0.38, decay: 6 }],
    wind: 1,
  },
  arrive: (within) => arriveAll(within, 70),
  /*
   * Each letter leaves from beyond the glass's far edge, the further along
   * the word the further out, fast, and brakes, still moving when it hits:
   * stretched along its flight and leaning into it, smeared by its speed;
   * squashed by the hit, springing back; and its hit knocks the letters
   * already down, each a little less than the last.
   */
  frame: (within, t) => {
    const letters = within.querySelectorAll<HTMLElement>('[data-letter]')
    const blurs = within.querySelectorAll<SVGFEGaussianBlurElement>('[data-blur]')
    // From beyond the edge of the glass as it is seen: a phone shows only part of the window.
    const reach = within.querySelector<HTMLElement>('[data-glass]')?.clientWidth || window.innerWidth
    const a = FLY.brake
    letters.forEach((el, i) => {
      const launch = FLY.at + i * FLY.stagger
      if (t < launch) {
        put(el, 'opacity', '0')
        return
      }
      put(el, 'opacity', '1')
      const from = reach * (0.6 + i * 0.05)
      const top = (from / FLY.flight) * (1 + a)
      let x = 0
      let speed = 0
      let sx = 1
      let sy = 1
      let lean = 0
      const u = (t - launch) / FLY.flight
      if (u < 1) {
        x = from * (1 - u) * (1 - a * u)
        speed = (from / FLY.flight) * (1 - a * u + a * (1 - u))
        const k = speed / top
        sx = 1 + 0.85 * k
        sy = 1 - 0.1 * k
        lean = -18 * k
      } else {
        // The hit: carried a little past, back; squashed, and springing tall.
        const hit = contact(i)
        const vc = (from / FLY.flight) * (1 - a)
        x = (-0.55 * vc * ring(t, hit, 30, 13)) / 30
        const squash = release(t, hit, 38, 12)
        sx = 1 - 0.16 * squash
        sy = 1 + 0.11 * squash
      }
      // The knocks of the letters landing after it.
      for (let j = i + 1; j < LETTERS.length; j++) x -= 5 * 0.62 ** (j - i - 1) * ring(t, contact(j), 34, 11)
      const blur = Math.min(36, speed * 0.0072)
      const moved = Math.abs(x) > 0.05 || Math.abs(sx - 1) > 0.002 || Math.abs(lean) > 0.05
      put(
        el,
        'transform',
        moved ? `translateX(${x.toFixed(2)}px) skewX(${lean.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : '',
      )
      blurs[i]?.setAttribute('stdDeviation', `${blur.toFixed(2)} 0`)
      put(el, 'filter', blur > 0.3 ? `url(#${el.dataset.filter})` : '')
    })
  },
}

/* ------------------------------------------------------------- depth */

/** When the tail clears the glass. */
const CLEARED = PASSER.at + PASSER.cross + PASSER.body

const Depth: FC = () => (
  <>
    {/* The giant word, as the page has it without scripts: in the scene, behind the passengers. With them it is painted in the scene itself (bigword.ts). */}
    <div className={s.depthWord} data-fast aria-hidden="true">
      <span>{TRAIN.last}</span>
    </div>
    <header className={s.window}>
      <h1 className={s.depthH1}>
        <Words text={TRAIN.title} /> <span className={s.hidden}>{TRAIN.last}</span>
      </h1>
    </header>
    <footer className={s.depthFoot}>
      <p className={s.lead} data-arrive={rest(0)}>
        {TRAIN.lead}
      </p>
      <div className={s.depthWays} data-arrive={rest(120)}>
        <Get tone="blue" />
      </div>
    </footer>
  </>
)

const depth: Look = {
  name: 'Depth',
  Words: Depth,
  passer: true,
  sceneWord: TRAIN.last,
  beats: {
    climax: CLEARED,
    knocks: [
      // The other train's bow wave hits the carriage; its wake pulls it back as the tail goes.
      { at: PASSER.at + 0.02, x: -10, y: 5, zoom: 0.012, freq: 24, decay: 4.5 },
      { at: CLEARED, x: 8, y: -4, zoom: -0.022, freq: 28, decay: 5 },
    ],
    // The sun back on the carriage as the tail goes: a little, so the word stands white against the sky.
    flashes: [{ at: CLEARED - 0.03, strength: 0.18, decay: 5 }],
    wind: 0.8,
  },
  arrive: (within) => arriveAll(within, 50),
  // The word is the scene's to paint; the page's own stands in only where it can't be, once the other train has gone by.
  frame: (within, t, scene) => {
    const word = within.querySelector<HTMLElement>('[data-fast]')
    if (word) put(word, 'opacity', !scene?.painted && t >= CLEARED ? '1' : '0')
  },
}

/* ------------------------------------------------------------- swiss */

/** When the board's tiles show, blank; when they start turning; how long a flap takes to fall; and how many each letter turns through. */
const BOARD = { shown: whenPace(0.12), at: whenPace(0.24), flap: 0.07, stagger: 0.09, turns: 6 }
/** When tile i stops on its letter. */
const stops = (i: number) => BOARD.at + i * BOARD.stagger + (BOARD.turns + i * 2) * BOARD.flap
const BOARD_DONE = stops(LETTERS.length - 1)
/** What the flaps show on their way round: a board's letters. */
const FACES = 'abcdefghijklmnopqrstuvwxyz'

const Swiss: FC = () => (
  <header className={s.window}>
    <dl className={s.swissFacts} data-arrive={150}>
      <div>
        <dt>Speed</dt>
        <dd>
          <b data-kmh>{KMH}</b> {TRAIN.unit}
        </dd>
      </div>
      <div>
        <dt>Crew</dt>
        <dd>Claude Code, Codex, OpenCode</dd>
      </div>
      <div>
        <dt>Runs on</dt>
        <dd>macOS, Windows, Linux</dd>
      </div>
      <div>
        <dt>Licence</dt>
        <dd>Apache 2.0</dd>
      </div>
    </dl>
    <div className={s.swissBlock}>
      <p className={s.swissMark} data-arrive={100}>
        Althar
      </p>
      <h1 className={s.swissH1}>
        <Words text={TRAIN.title} /> <span className={s.hidden}>{TRAIN.last}</span>
        <span className={s.board} aria-hidden="true">
          {LETTERS.map((letter, i) => (
            <span key={i} className={s.tile} data-flap={letter}>
              {/* A flap board's four halves: the next letter's top, the shown letter's lower half, and the flap that falls between them, the shown letter's top on its face and the next one's lower half on its back. */}
              <span className={s.top} data-part>
                <b>{letter}</b>
              </span>
              <span className={s.under} data-part>
                <b>{letter}</b>
              </span>
              <span className={s.flapFace} data-part>
                <b>{letter}</b>
              </span>
              <span className={s.flapBack} data-part>
                <b>{letter}</b>
              </span>
            </span>
          ))}
        </span>
      </h1>
      <p className={s.swissLead} data-arrive={rest(0)}>
        {TRAIN.lead}
      </p>
      <div className={s.swissWays} data-arrive={rest(100)}>
        <a className={s.swissPrimary} href={LINKS.releases}>
          Download
        </a>
        <a className={s.swissLink} href={LINKS.repo}>
          Star on GitHub <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </header>
)

/** The same face every time for a letter's turn `k`. */
const faceOf = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return FACES[Math.floor((v - Math.floor(v)) * FACES.length)]!
}

const swiss: Look = {
  name: 'Swiss',
  Words: Swiss,
  beats: {
    climax: BOARD_DONE,
    // A board is mechanical and small: each tile's stop is a tick, felt rather than seen.
    knocks: LETTERS.map((_, i) => ({ at: stops(i), x: 0.7, y: 0.5, freq: 60, decay: 18 })),
    flashes: [],
    wind: 0.45,
  },
  arrive: (within) => arriveAll(within, 35),
  /*
   * A departure board's flaps: blank tiles once the train is under way, then
   * each tile turns over, a face at a time, each flap falling over the hinge,
   * through a few letters, and stops on its own, one after the other along
   * the word, with a bounce. When the last stops, a gleam runs along them.
   */
  frame: (within, t) => {
    within.querySelectorAll<HTMLElement>('[data-flap]').forEach((tile, i) => {
      const [top, under, face, back] = [...tile.querySelectorAll<HTMLElement>('[data-part]')]
      if (!top || !under || !face || !back) return
      const shownAt = BOARD.shown + i * 0.04
      if (t < shownAt) {
        put(tile, 'opacity', '0')
        return
      }
      put(tile, 'opacity', '1')
      const final = tile.dataset.flap ?? ''
      const turns = BOARD.turns + i * 2
      const step = (t - BOARD.at - i * BOARD.stagger) / BOARD.flap
      // Turn k shows letter k: blank before the first, random faces on the way round, the word's own at the end.
      const letter = (k: number) => (k < 0 ? '' : k >= turns ? final : faceOf(i, k))
      const k = Math.floor(step)
      const f = step - k
      const resting = step < 0 || k >= turns
      const shown = resting ? letter(step < 0 ? -1 : turns) : letter(k)
      const next = resting ? shown : letter(k + 1)
      const write = (part: HTMLElement, text: string) => {
        const b = part.firstElementChild
        if (b && b.textContent !== text) b.textContent = text
      }
      write(top, next)
      write(under, f < 0.5 || resting ? shown : next)
      write(face, shown)
      write(back, next)
      // The flap falls over the hinge: its face down to edge-on, then its back from edge-on down onto the lower half.
      put(face, 'transform', !resting && f < 0.5 ? `rotateX(${(-180 * f).toFixed(1)}deg)` : '')
      put(face, 'opacity', !resting && f < 0.5 ? '1' : '0')
      put(back, 'transform', !resting && f >= 0.5 ? `rotateX(${(180 * (1 - f)).toFixed(1)}deg)` : '')
      put(back, 'opacity', !resting && f >= 0.5 ? '1' : '0')
      // Dropped in from a little above when it appears; a small bounce when it stops.
      const y = -0.35 * Math.max(0, release(t, shownAt, 22, 9)) - 0.07 * ring(t, stops(i), 30, 10)
      put(tile, 'transform', Math.abs(y) > 0.001 ? `translateY(${y.toFixed(3)}em)` : '')
      // The gleam along the board once it is done, tile after tile.
      const gleam = clamp((t - BOARD_DONE - 0.1 - i * 0.06) / 0.5)
      tile.style.setProperty('--gleam', gleam > 0 && gleam < 1 ? gleam.toFixed(3) : '-1')
    })
  },
}

export const LOOKS: Record<LookName, Look> = { title, depth, swiss }
export const LOOK_NAMES = Object.keys(LOOKS) as LookName[]
