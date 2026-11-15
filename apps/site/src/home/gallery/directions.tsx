import { Icon } from '@althar/ui'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { HIGHLIGHTS, type Picture as Drawing } from '../../changelog/takes/LogData'
import { LogPicture } from '../../changelog/takes/LogPictures'
import { cx } from '../../lib/cx'
import g from './gallery.module.css'
import { GalleryStation, Lightbox, Picture, type Place, Rail, usePlay } from './parts'
import { ALL, FEW } from './shots'

/*
 * The directions, each a whole proposal: where it stands, what it shows and
 * how it moves. A and C play by themselves; B and D move only as you do.
 */

const REAL = 'Real screens from Althar 0.9, on its demo projects.'
const PEEK = (
  <>
    Take a peek <b>inside.</b>
  </>
)

/** A · Tabs: one screen large at a time, its name under it in a row of tabs; it moves on by itself until you pick one. */
export function Tabs({ place }: { place: Place }) {
  const ref = useRef<HTMLDivElement>(null)
  const play = usePlay(ref, FEW.length, 'tabs')
  const shot = FEW[play.at] ?? FEW[0]!
  return (
    <GalleryStation place={place} name="The app" title={PEEK} lead={REAL}>
      <div ref={ref} className={g.tabs} {...play.hover}>
        <div id="gallery-panel" className={g.stage} data-light="" role="tabpanel" aria-label={shot.name}>
          {FEW.map((one, k) => (
            <div key={one.id} className={g.layer} data-on={k === play.at || undefined} aria-hidden={k !== play.at}>
              <Picture shot={one} eager={k < 2} />
            </div>
          ))}
        </div>
        <Rail play={play} stops={FEW.map((one) => ({ label: one.name, ms: 6500 }))} panel="gallery-panel" label="Screens" />
        <p className={g.caption} aria-live="polite">
          {shot.line}
        </p>
      </div>
    </GalleryStation>
  )
}

/** B · Strip: every screen in a row you scroll sideways, running off the page's edge; open one to see it whole. */
export function Strip({ place }: { place: Place }) {
  const row = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ start: true, end: false })
  const [open, setOpen] = useState<{ at: number; from: HTMLElement } | null>(null)
  const measure = () => {
    const el = row.current
    if (!el) return
    setEnds({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 })
  }
  useEffect(measure, [])
  const by = (dir: number) => {
    const el = row.current
    if (!el) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: still ? 'auto' : 'smooth' })
  }
  return (
    <GalleryStation place={place} name="Screens" title={PEEK} lead={REAL}>
      <div className={g.stripBox} data-light="">
        <div ref={row} className={g.strip} onScroll={measure}>
          {ALL.map((shot, k) => (
            <figure key={shot.id} className={g.card}>
              <button
                type="button"
                className={g.open}
                aria-label={`${shot.name}, whole`}
                onClick={(e) => setOpen({ at: k, from: e.currentTarget })}
              >
                <Picture shot={shot} className={g.cardPicture} eager={k < 3} />
              </button>
              <figcaption className={g.cardCaption}>
                <b>{shot.name}</b> {shot.line}
              </figcaption>
            </figure>
          ))}
        </div>
        <button
          type="button"
          className={cx(g.round, g.stripPrev)}
          data-off={ends.start || undefined}
          onClick={() => by(-1)}
          aria-label="Earlier screens"
        >
          <Icon name="chevronL" size={16} />
        </button>
        <button
          type="button"
          className={cx(g.round, g.stripNext)}
          data-off={ends.end || undefined}
          onClick={() => by(1)}
          aria-label="Later screens"
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {open && <Lightbox shots={ALL} at={open.at} from={open.from} onClose={() => setOpen(null)} />}
    </GalleryStation>
  )
}

/**
 * The film's chapters: the changelog's drawings, in the order a task goes,
 * each as long as its own loop. The frame keeps one height; each drawing
 * stands in it as it best fits: on its foot, running off it as the
 * changelog's do (`end`); from its top, cut at the foot where it is taller
 * or grows (`start`); or drawn smaller (`fit`, of the frame's width).
 */
const CHAPTERS: readonly { picture: Drawing; label: string; ms: number; align: 'end' | 'start' | 'center'; fit?: number }[] = [
  { picture: 'plan', label: 'Plan', ms: 7000, align: 'end' },
  { picture: 'browser', label: 'Build and try', ms: 13800, align: 'end' },
  { picture: 'canvas', label: 'Draw', ms: 11000, align: 'center', fit: 0.76 },
  { picture: 'findings', label: 'Review', ms: 14400, align: 'start' },
  { picture: 'evidence', label: 'Evidence', ms: 8000, align: 'start' },
  { picture: 'undo', label: 'Undo', ms: 12400, align: 'end' },
]

const HIGHLIGHT = Object.fromEntries(
  Object.values(HIGHLIGHTS)
    .flat()
    .map((h) => [h.picture, h]),
)

/** C · Film: the changelog's moving drawings played as one task, chapter by chapter, on a rail like a video's. */
export function Film({ place }: { place: Place }) {
  const ref = useRef<HTMLDivElement>(null)
  const play = usePlay(ref, CHAPTERS.length, 'film')
  // Each chapter starts again when it comes on, from where its drawing rests; one going out is left as it is while it fades.
  const starts = useRef<number[]>(CHAPTERS.map(() => 0))
  starts.current[play.at] = play.round
  const chapter = CHAPTERS[play.at] ?? CHAPTERS[0]!
  const said = HIGHLIGHT[chapter.picture]
  return (
    <GalleryStation
      place={place}
      name="A task"
      title={
        <>
          One task, <b>start to finish.</b>
        </>
      }
      lead="The coordinator plans it, a lead builds it and tries it in its page, and a model from another lab reviews it."
    >
      <div ref={ref} className={g.film} {...play.hover}>
        <div id="gallery-panel" className={g.reel} data-light="" role="tabpanel" aria-label={said?.title ?? chapter.label}>
          {CHAPTERS.map((one, k) => (
            <div
              key={`${one.picture}-${starts.current[k]}`}
              className={g.chapter}
              data-on={k === play.at || undefined}
              data-align={one.align}
              style={one.fit ? ({ '--fit': one.fit } as CSSProperties) : undefined}
              aria-hidden={k !== play.at}
            >
              <LogPicture picture={one.picture} />
            </div>
          ))}
        </div>
        <Rail play={play} stops={CHAPTERS} panel="gallery-panel" label="Chapters" film />
        <p className={cx(g.caption, g.filmCaption)} aria-live="polite">
          {said && (
            <>
              <b>{said.title}.</b> {said.why}
            </>
          )}
        </p>
      </div>
    </GalleryStation>
  )
}

/** D · Wall: every screen at once, at its own shape, three across; open one to see it whole. */
export function Wall({ place }: { place: Place }) {
  const [open, setOpen] = useState<{ at: number; from: HTMLElement } | null>(null)
  return (
    <GalleryStation place={place} name="Screens" title={PEEK} lead={REAL}>
      <div className={g.wall} data-light="">
        {ALL.map((shot, k) => (
          <figure key={shot.id} className={g.tile}>
            <button
              type="button"
              className={g.open}
              aria-label={`${shot.name}, whole`}
              onClick={(e) => setOpen({ at: k, from: e.currentTarget })}
            >
              <Picture shot={shot} className={g.tilePicture} />
            </button>
            <figcaption className={g.cardCaption}>
              <b>{shot.name}</b> {shot.line}
            </figcaption>
          </figure>
        ))}
      </div>
      {open && <Lightbox shots={ALL} at={open.at} from={open.from} onClose={() => setOpen(null)} />}
    </GalleryStation>
  )
}
