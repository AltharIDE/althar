import { EdgeSheet, Logo } from '@althar/ui'
import { useEffect, useRef, useState } from 'react'

// Prototype: the kit's demo world, read from its source.
import { EDGE_NEEDS, EDGE_WORK, edgeRowOf } from '../../../../../../packages/ui/src/fixtures/edge'
import { IslandOpen } from './app'
import { BrowserWindow, Desktop, EditorWindow, TerminalWindow } from './Mac'
import { Reel, type ReelMoment } from './Reel'
import { cx } from '../../../lib/cx'
import { useSeen } from './seen'
import { Shot } from './Shot'
import s from './EdgeTour.module.css'
import t from './type.module.css'

/*
 * Althar at the edge of the screen, wherever you are: round the notch over
 * your editor, saying what just came in while you read in the browser, in
 * the menu bar over a terminal, and quiet on an empty desktop with what
 * waits counted. One screen, the places one after another.
 */

const none = () => {}

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/**
 * The island as you would meet it: closed round the notch, then, a moment
 * after the picture is seen, dropping open, as it does when you point at it.
 */
function OpeningIsland({ active, after = 1200 }: { active: boolean; after?: number }) {
  const spot = useRef<HTMLSpanElement>(null)
  const seen = useSeen(spot, 0.5)
  const [open, setOpen] = useState(still)
  useEffect(() => {
    if (!active || open || !seen) return
    const timer = window.setTimeout(() => setOpen(true), after)
    return () => window.clearTimeout(timer)
  }, [active, open, seen, after])
  return (
    <>
      <span ref={spot} className={s.spot} aria-hidden="true" />
      <IslandOpen open={open} />
    </>
  )
}

const MENU_SHEET = (
  <EdgeSheet
    tone="paper"
    waiting={EDGE_NEEDS.length}
    working={EDGE_WORK.length}
    needs={EDGE_NEEDS.map((row) => edgeRowOf(row, none))}
    work={EDGE_WORK.map((row) => edgeRowOf(row, none))}
    onOpenApp={none}
  />
)

const ISLAND = { x: 450, y: 0, w: 540, h: 600 }

export const EDGE_MOMENTS: ReelMoment[] = [
  {
    label: 'In your editor',
    stays: 6800,
    render: (active) => (
      <Shot w={1440} h={900} phone={ISLAND} label="The island round the notch, dropping open over a code editor" frame={s.screen}>
        <Desktop wallpaper="dark" app="Code" island={<OpeningIsland active={active} />}>
          <EditorWindow style={{ left: 120, top: 50, width: 1200, height: 780 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    label: 'In the browser',
    stays: 4400,
    render: () => (
      <Shot
        w={1440}
        h={900}
        phone={{ x: 380, y: 0, w: 680, h: 520 }}
        label="A pull request ready for you, said round the notch over a browser"
        frame={s.screen}
      >
        <Desktop
          wallpaper="light"
          app="Chrome"
          island={<IslandOpen open={false} saying={{ project: 'Meridian', kind: 'Ready to accept' }} />}
        >
          <BrowserWindow style={{ left: 90, top: 40, width: 1260, height: 800 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    label: 'In a terminal',
    stays: 5600,
    render: (active) => (
      <Shot w={1440} h={900} phone={ISLAND} label="The island dropping open over a terminal" frame={s.screen}>
        <Desktop wallpaper="dark" app="Terminal" island={<OpeningIsland active={active} after={700} />}>
          <TerminalWindow style={{ left: 120, top: 60, width: 1200, height: 760 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    label: 'Anywhere else',
    stays: 4400,
    render: () => (
      <Shot
        w={1440}
        h={900}
        phone={{ x: 360, y: 0, w: 720, h: 560 }}
        label="A permission asked round the notch over an empty desktop"
        frame={s.screen}
      >
        <Desktop wallpaper="light" app="Finder" island={<IslandOpen open={false} saying={{ project: 'Halyard', kind: 'Permission' }} />} />
      </Shot>
    ),
  },
]

export function EdgeTour({ tone = 'ink' }: { tone?: 'paper' | 'ink' }) {
  return (
    <div className={s.tour}>
      <div className={s.bezel}>
        <Reel moments={EDGE_MOMENTS} tone={tone} />
      </div>
      <MenuBarNote />
    </div>
  )
}

/*
 * The menu bar, for a Mac without a notch: the top right corner of a screen
 * at the size it is, a terminal behind. The pointer comes up to Althar's
 * mark, clicks, and the same list drops from it.
 */
function MenuBarNote() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref, 0.45)
  return (
    <div ref={ref} className={s.menuNote}>
      <div className={s.menuWords}>
        <h3 className={cx(t.title, s.menuTitle)}>
          No notch? <b>The menu bar.</b>
        </h3>
        <p>
          On a Mac without one, or on a second screen, Althar sits in the menu bar. Click its mark and the same list drops down: answer,
          open, carry on.
        </p>
        <p className={s.choose}>
          <span>Settings</span>
          <i aria-hidden="true">›</i>
          <span>While you’re in another app</span>
          <i aria-hidden="true">›</i>
          <b>In the menu bar</b>
        </p>
      </div>
      <div className={s.menuScene}>
        <Shot
          w={620}
          h={600}
          maxScale={1}
          label="Althar in the menu bar: its mark clicked, and the list dropped open under it"
          frame={s.sceneFrame}
        >
          <div className={cx(s.corner, (seen || still()) && s.cornerOn, still() && s.cornerStill)}>
            <div className={s.cornerBar}>
              <span className={s.cornerMenus}>
                <span>Shell</span>
                <span>Edit</span>
                <span>View</span>
                <span>Window</span>
                <span>Help</span>
              </span>
              <span className={s.cornerStatus}>
                <span className={s.cornerMark}>
                  <Logo size={14} />
                  <i />
                </span>
                <i className={s.glyphControl} />
                <i className={s.glyphWifi} />
                <i className={s.glyphBattery} />
                <span className={s.clock}>Thu 14:02</span>
              </span>
            </div>
            <TerminalWindow style={{ left: -160, top: 74, width: 560, height: 470 }} />
            <div className={s.drop}>{MENU_SHEET}</div>
            <svg className={s.cursor} viewBox="0 0 18 24" width="18" height="24" aria-hidden="true">
              <path d="M1 1v19.5l5-4.6 3.3 7.3 3.1-1.4-3.2-7.1H16z" fill="#000" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </div>
        </Shot>
      </div>
    </div>
  )
}
