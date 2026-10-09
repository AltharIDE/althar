import { Logo } from '@althar/ui'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import appIcon from '../../../../../desktop/resources/icons/cobalt.svg?url'
import { useSeen } from '../kit/seen'
import t from '../kit/type.module.css'
import s from './Marks.module.css'

/*
 * The systems Althar runs on, said without pictures of the app: by what
 * each system puts round a window or under an icon.
 *
 *  - Buttons: a window's top edge, as wide as the page, coming up out of
 *    the first screen's light; its buttons turn from the Mac's three lights
 *    to Windows' minimise, maximise and close, to GNOME's round ones.
 *  - Icons: Althar's icon where each system keeps it: on the Mac's Dock,
 *    in Windows' taskbar, in Ubuntu's dock, each the way it says "running".
 *  - Roll: type only. "Runs on" and the system's name, rolling, its window
 *    buttons beside it as the agents' marks sit beside theirs in the first
 *    screen.
 */

type Id = 'mac' | 'windows' | 'linux'
const NAMES: ReadonlyArray<{ id: Id; name: string }> = [
  { id: 'mac', name: 'macOS' },
  { id: 'windows', name: 'Windows' },
  { id: 'linux', name: 'Linux' },
]

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/** Which system is showing: one after another every `every` ms while `on`, held while pointed at. */
function useTurn(on: boolean, every = 2600) {
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!on || held || still()) return
    const timer = window.setTimeout(() => setAt((n) => (n + 1) % NAMES.length), every)
    return () => window.clearTimeout(timer)
  }, [on, held, at, every])
  return { at, setAt, hold: () => setHeld(true), release: () => setHeld(false) }
}

/** A system's window buttons, drawn at `size` (the Mac's light's diameter). */
export function Buttons({ id, size = 14, className }: { id: Id; size?: number; className?: string }) {
  return (
    <span className={cx(s.buttons, s[`b${id[0]!.toUpperCase()}${id.slice(1)}`], className)} style={{ '--b': `${size}px` } as CSSProperties} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

function Head() {
  return (
    <div className={s.head}>
      <h2 className={cx(t.title, s.title)}>
        One app, <b>every desktop.</b>
      </h2>
      <p className={t.lead}>
        The same Althar on macOS, Windows and Linux: your projects, your agents and your plans, wherever you sit down.
      </p>
    </div>
  )
}

function Names({ at, onPick }: { at: number; onPick: (i: number) => void }) {
  return (
    <p className={s.names}>
      {NAMES.map((x, i) => (
        <button key={x.id} type="button" className={cx(s.name, i === at && s.nameOn)} aria-pressed={i === at} onClick={() => onPick(i)}>
          {x.name}
        </button>
      ))}
    </p>
  )
}

/* ---- Buttons ---- */

export function TitleBarLook() {
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref, 0.3)
  const { at, setAt, hold, release } = useTurn(seen)
  const id = NAMES[at]!.id
  return (
    <section ref={ref} className={cx(s.platforms, s.bar)} aria-labelledby="platforms-h" onPointerEnter={hold} onPointerLeave={release}>
      <span id="platforms-h" hidden>
        Runs on macOS, Windows and Linux
      </span>
      <div className={s.window}>
        <div className={s.titleBar}>
          <span className={s.left}>
            {NAMES.map((x) => (
              <span key={x.id} className={cx(s.set, x.id === 'mac' && s.setLeft, x.id === id && s.setOn)}>
                {x.id === 'mac' && <Buttons id="mac" size={22} />}
              </span>
            ))}
          </span>
          <span className={s.titleName}>
            <Logo size={26} />
            Althar
          </span>
          <span className={s.right}>
            {NAMES.filter((x) => x.id !== 'mac').map((x) => (
              <span key={x.id} className={cx(s.set, x.id === id && s.setOn)}>
                <Buttons id={x.id} size={22} />
              </span>
            ))}
          </span>
        </div>
        <div className={s.windowBody} aria-hidden="true">
          {[62, 48, 74, 0, 56, 68, 40].map((w, i) => (
            <i key={i} style={{ width: w ? `${w}%` : 0 }} />
          ))}
        </div>
      </div>
      <Names at={at} onPick={setAt} />
      <Head />
    </section>
  )
}

/* ---- Icons ---- */

export function IconsLook() {
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref, 0.3)
  return (
    <section ref={ref} className={cx(s.platforms, s.icons, seen && s.seen)} aria-labelledby="platforms-h">
      <span id="platforms-h" hidden>
        Runs on macOS, Windows and Linux
      </span>
      <Head />
      <ul className={s.shelves}>
        <li>
          <div className={s.dockShelf} aria-hidden="true">
            <i style={{ background: 'linear-gradient(160deg, #6fc0ff, #2f7fe0)' }} />
            <i style={{ background: '#f6f4ef' }} />
            <span className={s.iconWrap}>
              <img src={appIcon} alt="" />
              <b className={s.macDot} />
            </span>
            <i style={{ background: '#22262e' }} />
            <i style={{ background: 'linear-gradient(160deg, #ffd36b, #f2a531)' }} />
          </div>
          <p className={s.shelfName}>
            <b>macOS</b>
            <span>On the Dock</span>
          </p>
        </li>
        <li>
          <div className={s.taskbar} aria-hidden="true">
            <span className={s.start}>
              <b />
              <b />
              <b />
              <b />
            </span>
            <i style={{ background: '#3b7ddd' }} />
            <span className={cx(s.iconWrap, s.winOn)}>
              <img src={appIcon} alt="" />
              <b className={s.winBar} />
            </span>
            <i style={{ background: '#f2b33d' }} />
            <i style={{ background: '#22262e' }} />
          </div>
          <p className={s.shelfName}>
            <b>Windows</b>
            <span>In the taskbar</span>
          </p>
        </li>
        <li>
          <div className={s.ubuntu} aria-hidden="true">
            <i style={{ background: '#e95420' }} />
            <span className={s.iconWrap}>
              <img src={appIcon} alt="" />
              <b className={s.ubuntuDot} />
            </span>
            <i style={{ background: '#77216f' }} />
          </div>
          <p className={s.shelfName}>
            <b>Linux</b>
            <span>In the dock</span>
          </p>
        </li>
      </ul>
    </section>
  )
}

/* ---- Roll ---- */

export function RollLook() {
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref, 0.3)
  const { at, setAt, hold, release } = useTurn(seen, 2200)
  return (
    <section ref={ref} className={cx(s.platforms, s.roll)} aria-labelledby="platforms-h" onPointerEnter={hold} onPointerLeave={release}>
      <h2 id="platforms-h" className={cx(t.title, s.rollLine)}>
        <span className={s.rollPre}>Runs on</span>
        <span className={s.rollSlot} aria-live="polite">
          {NAMES.map((x, i) => (
            <span key={x.id} className={cx(s.rollWord, i === at && s.rollOn)} aria-hidden={i !== at}>
              <Buttons id={x.id} size={24} className={s.rollButtons} />
              <b>{x.name}.</b>
            </span>
          ))}
        </span>
      </h2>
      <p className={cx(t.lead, s.rollLead)}>
        The same app, the same window, your projects and your plans: whichever desktop you sit down at.
      </p>
      <Names at={at} onPick={setAt} />
    </section>
  )
}
