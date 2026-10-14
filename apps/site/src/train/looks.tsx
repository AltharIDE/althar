import type { FC } from 'react'

import { TRAIN } from '../content/train'
import { Get } from '../shared/Close'
import { AT } from './journey'
import s from './Looks.module.css'
import type { Knock } from './motion'
import { PASSER } from './passer'
import type { Box } from './world'

/*
 * How the train's words are set. The scene and its camera are TrainHero's;
 * a look sets the words where and how it likes, inside the stage, measured
 * by the photograph's window (--px, --py, --u, --wx… from the stage), and
 * names its beats: when "fast." lands (the climax, which the camera pushes
 * toward and the headline's smear snaps back at), what knocks the camera,
 * and what flashes the light.
 *
 * The headline's words rise out of masks on their own time (arrive). "fast."
 * comes in on the train's: `frame` is called with the journey's second on
 * every frame, so it lands exactly with the speed, and `?t=` or reduced
 * motion shows the same moment every time.
 *
 * There is one look, depth: "fast." huge in the scene, behind the
 * passengers; a train goes by the other way, its pressure shaking the
 * carriage, and its tail uncovers the word standing beyond it.
 */

export type LookName = 'depth'

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
  /** The words in the scene, moved with it by the camera. */
  Words: FC
  /** What stands still in front of the scene: the lead and the ways in, which the camera's knocks and trembling leave be, so they can be read and pressed. */
  Steady?: FC
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
  </>
)

const DepthFoot: FC = () => (
  <footer className={s.depthFoot}>
    <p className={s.lead} data-arrive={rest(0)}>
      {TRAIN.lead}
    </p>
    <div className={s.depthWays} data-arrive={rest(120)}>
      <Get tone="blue" />
    </div>
  </footer>
)

const depth: Look = {
  name: 'Depth',
  Words: Depth,
  Steady: DepthFoot,
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

export const LOOKS: Record<LookName, Look> = { depth }
