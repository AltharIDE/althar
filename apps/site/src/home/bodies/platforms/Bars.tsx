import { type CSSProperties, Fragment, useEffect, useRef, useState } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Buttons } from './Marks'
import s from './Bars.module.css'

/*
 * The systems Althar runs on, said quietly: a band between the first screen
 * and the rest, not a section of its own.
 *
 *  - Strip: one line between hairlines; "Runs on" and the three systems,
 *    each with its mark.
 *  - Ticker: the names going by slowly, large, light and heavy in turn, each
 *    system's window buttons between them.
 *  - Rule: a hairline across the page, each system's window buttons sitting
 *    on it like marks on a ruler, its name under them.
 *  - Install: the way in on each, in a mono line that turns from one system
 *    to the next.
 *  - Downloads: the three downloads in a row, each with what it comes as.
 */

export type BarLook = 'strip' | 'ticker' | 'rule' | 'install' | 'downloads'

type Id = 'mac' | 'windows' | 'linux'
const SYSTEMS: ReadonlyArray<{ id: Id; name: string }> = [
  { id: 'mac', name: 'macOS' },
  { id: 'windows', name: 'Windows' },
  { id: 'linux', name: 'Linux' },
]

/** A system's own mark, in the text's colour: Apple's, Windows' four panes, and Tux. */
export function OsMark({ id, size = 18 }: { id: Id; size?: number }) {
  if (id === 'mac')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z"
        />
      </svg>
    )
  if (id === 'windows')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {/* Tux: the body, the belly, the eyes, the beak and the feet. */}
      <path
        fill="currentColor"
        d="M12 1.6c-2.6 0-4.4 2.1-4.4 5 0 1.6-.6 2.7-1.6 4.2-1.3 2-2.4 4.2-2.4 6.6 0 2.7 3.6 4.9 8.4 4.9s8.4-2.2 8.4-4.9c0-2.4-1.1-4.6-2.4-6.6-1-1.5-1.6-2.6-1.6-4.2 0-2.9-1.8-5-4.4-5Z"
      />
      <path fill="var(--os-belly, #fff)" d="M12 9.4c-2.4 0-4.2 3.2-4.2 6.6 0 2.4 1.9 3.8 4.2 3.8s4.2-1.4 4.2-3.8c0-3.4-1.8-6.6-4.2-6.6Z" />
      <circle cx="10.4" cy="6.2" r="1" fill="var(--os-belly, #fff)" />
      <circle cx="13.6" cy="6.2" r="1" fill="var(--os-belly, #fff)" />
      <path
        fill="#f2b33d"
        d="M10.2 8c.5.9 1.1 1.4 1.8 1.4s1.3-.5 1.8-1.4c-.6-.4-1.2-.6-1.8-.6s-1.2.2-1.8.6ZM4.2 20.6c1.1-1.2 2.6-1.6 3.8-1 .6.3.7 1.2.2 1.8-.8.9-2.9 1-4 .4-.3-.3-.2-.8 0-1.2ZM19.8 20.6c-1.1-1.2-2.6-1.6-3.8-1-.6.3-.7 1.2-.2 1.8.8.9 2.9 1 4 .4.3-.3.2-.8 0-1.2Z"
      />
    </svg>
  )
}

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/* ---- Strip ---- */

function Strip() {
  return (
    <div className={cx(s.band, s.strip)}>
      <span className={s.label}>Runs on</span>
      {SYSTEMS.map((x, i) => (
        <Fragment key={x.id}>
          {i > 0 && <i className={s.dot} aria-hidden="true" />}
          <span className={s.system}>
            <OsMark id={x.id} />
            {x.name}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

/* ---- Ticker ---- */

function Ticker() {
  const run = (key: string) => (
    <span className={s.run} key={key} aria-hidden={key !== 'a'}>
      {SYSTEMS.map((x, i) => (
        <span key={x.id} className={s.tick}>
          <Buttons id={x.id} size={14} className={s.tickButtons} />
          <span className={i % 2 === 0 ? s.light : s.heavy}>{x.name}</span>
        </span>
      ))}
      <span className={s.tick}>
        <span className={s.light}>one app,</span>
        <span className={s.heavy}>every desktop.</span>
      </span>
    </span>
  )
  return (
    <div className={cx(s.band, s.ticker)} aria-label="Runs on macOS, Windows and Linux">
      <div className={s.track}>
        {run('a')}
        {run('b')}
      </div>
    </div>
  )
}

/* ---- Rule ---- */

function Rule() {
  return (
    <div className={cx(s.ruleWrap)}>
      <p className={s.ruleWords}>
        <b>One app,</b> every desktop.
      </p>
      <ol className={s.rule} aria-label="Runs on">
        {SYSTEMS.map((x) => (
          <li key={x.id}>
            <span className={s.onRule}>
              <Buttons id={x.id} size={13} />
            </span>
            <span className={s.ruleName}>{x.name}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---- Install ---- */

const COMMANDS: ReadonlyArray<{ id: Id; name: string; line: string }> = [
  { id: 'mac', name: 'macOS', line: 'brew install --cask althar' },
  { id: 'windows', name: 'Windows', line: 'winget install Althar.Althar' },
  { id: 'linux', name: 'Linux', line: 'flatpak install althar' },
]

function Install() {
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState('')
  const line = COMMANDS[at]!.line

  // Typed out, held, then the next system.
  useEffect(() => {
    if (still()) {
      setShown(line)
      return
    }
    let n = 0
    setShown('')
    const timer = window.setInterval(() => {
      n += 1
      setShown(line.slice(0, n))
      if (n >= line.length) window.clearInterval(timer)
    }, 38)
    return () => window.clearInterval(timer)
  }, [line])
  useEffect(() => {
    if (held || still() || shown.length < line.length) return
    const timer = window.setTimeout(() => setAt((n) => (n + 1) % COMMANDS.length), 2400)
    return () => window.clearTimeout(timer)
  }, [held, shown, line])

  return (
    <div ref={ref} className={cx(s.band, s.install)} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <span className={s.installOs}>
        {COMMANDS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={cx(s.installPick, i === at && s.installOn)}
            aria-pressed={i === at}
            onClick={() => setAt(i)}
          >
            <OsMark id={c.id} size={16} />
            <span>{c.name}</span>
          </button>
        ))}
      </span>
      <code className={s.command}>
        <span className={s.prompt}>$</span> {shown}
        <i className={s.caret} aria-hidden="true" />
      </code>
    </div>
  )
}

/* ---- Downloads ---- */

const DOWNLOADS: ReadonlyArray<{ id: Id; name: string; as: string }> = [
  { id: 'mac', name: 'macOS', as: 'Apple silicon and Intel · .dmg' },
  { id: 'windows', name: 'Windows', as: 'Windows 10 and 11 · .exe' },
  { id: 'linux', name: 'Linux', as: '.AppImage · .deb · .rpm' },
]

function Downloads() {
  return (
    <div className={cx(s.band, s.downloads)}>
      {DOWNLOADS.map((d) => (
        <a key={d.id} className={s.download} href={LINKS.releases}>
          <span className={s.downloadMark}>
            <OsMark id={d.id} size={22} />
          </span>
          <span className={s.downloadWords}>
            <b>{d.name}</b>
            <span>{d.as}</span>
          </span>
          <span className={s.arrow} aria-hidden="true">
            ↓
          </span>
        </a>
      ))}
    </div>
  )
}

export function Bar({ look }: { look: BarLook }) {
  const body =
    look === 'ticker' ? (
      <Ticker />
    ) : look === 'rule' ? (
      <Rule />
    ) : look === 'install' ? (
      <Install />
    ) : look === 'downloads' ? (
      <Downloads />
    ) : (
      <Strip />
    )
  return (
    <section className={s.bar} aria-label="Runs on macOS, Windows and Linux" style={{} as CSSProperties}>
      {body}
    </section>
  )
}
