import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import {
  type Change,
  KIND_WORD,
  type Kind,
  ON_MAIN,
  pullUrl,
  releaseUrl,
  RELEASES,
  ROADMAP,
  type Stage,
  STAGE_WORD,
} from '../../content/changelog'
import { LINKS } from '../../content/facts'
import { addDisplay } from '../../home/display'
import { cx } from '../../lib/cx'
import { useDownload } from '../../lib/download'
import { seeded } from '../../shared/footer/random'
import { LightUnder } from '../../shared/lightUnder'
import { OS_NAME, OsMark } from '../../shared/OsMark'
import s from './Log.module.css'

/*
 * The changelog as the flight log of the capsule the homepage brings in from
 * orbit. It opens on a window as the first screen's is, its instruments in
 * its corners: the mission's elapsed time since 0.1.0 went out, counting;
 * the current version; what is aboard for the next release; the launch. The
 * night side of the planet below, its edge lit cobalt: the page's one light.
 *
 * Under it, the log, newest first, down a rail: what has merged on main is
 * its live tail, the newest line's caret blinking; then each release, stamped
 * with its mission day and its date, its changes as lines grouped under New,
 * Improved and Fixed. Then what's next, as a course plotted into the dark,
 * Now lit, Next dashed, Later fading; and the download.
 *
 * With reduced motion the clock reads once and the caret holds still.
 */

addDisplay()

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const LATEST = RELEASES[0]!
const FIRST = RELEASES[RELEASES.length - 1]!
/** The launch: the first build, at the start of its day, UTC. */
const LAUNCH = Date.parse(`${FIRST.date}T00:00:00Z`)

/** A day as the log writes it: 20 Oct 2026, or 20 Oct. */
const dated = (iso: string, year = true) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]}${year ? ` ${y}` : ''}`
}

/** The mission day a date falls on, counted from the launch: T+8d. */
const missionDay = (iso: string) => `T+${Math.round((Date.parse(`${iso}T00:00:00Z`) - LAUNCH) / DAY)}d`

const two = (n: number) => String(n).padStart(2, '0')

/** The mission's elapsed time at `ms`: T+18d 07:42:13. */
const elapsed = (ms: number) => {
  const all = Math.max(0, Math.floor((ms - LAUNCH) / 1000))
  const d = Math.floor(all / 86_400)
  return `T+${d}d ${two(Math.floor(all / 3600) % 24)}:${two(Math.floor(all / 60) % 60)}:${two(all % 60)}`
}

/** A line's words, its `code` set as code. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <code key={i} className={s.code}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** A release's changes, in runs of one kind, in the order the release notes give them. */
const runs = (changes: readonly Change[]) =>
  changes.reduce<{ kind: Kind; lines: string[] }[]>((all, change) => {
    const last = all[all.length - 1]
    if (last?.kind === change.kind) last.lines.push(change.text)
    else all.push({ kind: change.kind, lines: [change.text] })
    return all
  }, [])

/** An instrument: what it reads, and the reading; a way into the log where it has one. */
function Readout({ label, href, end, children }: { label: string; href: string; end?: boolean; children: ReactNode }) {
  return (
    <a className={cx(s.readout, end && s.end)} href={href}>
      <i>{label}</i>
      {children}
    </a>
  )
}

/** The mission clock: the build's day in the prerender, then the reader's time, every second while it is in sight. */
function Clock() {
  const el = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const read = () => {
      const text = elapsed(Date.now())
      if (node.textContent !== text) node.textContent = text
    }
    read()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let seen = true
    let timer = 0
    // On the second, so it never skips one.
    const next = () => {
      timer = window.setTimeout(
        () => {
          if (seen) read()
          next()
        },
        1000 - (Date.now() % 1000) + 4,
      )
    }
    next()
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? true
      if (seen) read()
    })
    io.observe(node)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [])
  return (
    <b ref={el} className={s.clock}>
      {elapsed(Date.parse(`${import.meta.env.BUILT_ON}T00:00:00Z`))}
    </b>
  )
}

/** The window: the instruments in its corners, the page's name in the middle, the planet's lit edge below. */
function Window() {
  const grain = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (!context || !grain.current) return
    drawGrain(context, 128, seeded(11))
    grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
  }, [])

  return (
    <header className={s.window}>
      <div className={s.sky} aria-hidden="true">
        <div className={s.haze} />
        <div className={s.limb} />
        <div ref={grain} className={s.grain} />
      </div>
      <div className={s.row}>
        <Readout label="Mission elapsed" href={`#v${FIRST.version}`}>
          <Clock />
        </Readout>
        <Readout label="Current version" href={`#v${LATEST.version}`} end>
          <b>{LATEST.version}</b>
        </Readout>
      </div>
      <div className={s.name}>
        <h1 className={s.h1}>Changelog</h1>
        <p className={s.lead}>Every release since launch, what has merged since, and what’s next.</p>
      </div>
      <div className={s.row}>
        <Readout label="Next release" href="#on-main">
          <b>{ON_MAIN.length} merged</b>
          <span className={s.meter} aria-hidden="true">
            {ON_MAIN.map((m) => (
              <span key={m.pr} />
            ))}
          </span>
        </Readout>
        <Readout label="Launch" href={`#v${FIRST.version}`} end>
          <b>{dated(FIRST.date)}</b>
        </Readout>
      </div>
    </header>
  )
}

/** An entry's stamp: its mission day and date along a rule, and its link at the end. */
function Stamp({ day, date, note, link }: { day: string; date: string; note?: string; link?: ReactNode }) {
  return (
    <p className={s.stamp}>
      <span className={s.t}>{day}</span>
      <span>{date}</span>
      {note && <span className={s.note}>{note}</span>}
      <span className={s.rule} aria-hidden="true" />
      {link}
    </p>
  )
}

/** What has merged on main since the last release: the log's live tail, newest first, its newest line's caret blinking. */
function Tail() {
  const newest = ON_MAIN[0]!
  return (
    <li className={cx(s.entry, s.tail)} id="on-main">
      <span className={s.node} aria-hidden="true" />
      <Stamp day={missionDay(newest.date)} date={dated(newest.date)} note="On main" />
      <h2 className={s.head}>
        <span className={s.v}>main</span>
        <span className={s.title}>Since {LATEST.version}, for the next release</span>
      </h2>
      <ul className={s.lines}>
        {ON_MAIN.map((m, i) => {
          const day = i === 0 || ON_MAIN[i - 1]!.date !== m.date
          return (
            <li key={m.pr} className={cx(s.merged, i === 0 && s.newest)}>
              <span className={cx(s.label, !day && s.again)}>{dated(m.date, false)}</span>
              <span className={s.text}>
                <span>{m.text}</span>
                <a className={s.pr} href={pullUrl(m.pr)} aria-label={`Pull request ${m.pr}`}>
                  #{m.pr}
                </a>
              </span>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

/** A release: its stamp, its version and title, and its changes under New, Improved and Fixed. */
function Entry({ release, first }: { release: (typeof RELEASES)[number]; first: boolean }) {
  return (
    <li className={cx(s.entry, first && s.launch)} id={`v${release.version}`}>
      <span className={s.node} aria-hidden="true" />
      <Stamp
        day={missionDay(release.date)}
        date={dated(release.date)}
        note={first ? 'Launch' : undefined}
        link={
          <a className={s.out} href={releaseUrl(release.version)}>
            On GitHub
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
              <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </a>
        }
      />
      <h2 className={s.head}>
        <span className={s.v}>{release.version}</span>
        <span className={s.title}>{release.title}</span>
      </h2>
      <div className={s.runs}>
        {runs(release.changes).map((run, i) => (
          <div key={i} className={s.run} data-kind={run.kind}>
            <span className={s.label}>{KIND_WORD[run.kind]}</span>
            <ul className={s.lines}>
              {run.lines.map((line, j) => (
                <li key={j}>
                  <Words text={line} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </li>
  )
}

/*
 * The course ahead, on a chart: climbing from Now, lit, through Next to
 * Later and on into the dark. Drawn across the chart's width, each stage a
 * third of it, its waypoint at the start of its third and on the course.
 */
const STAGES: readonly Stage[] = ['now', 'next', 'later']
/** The course's height, in px, and its height at a share `x` of the way across. */
const COURSE_H = 132
const courseY = (x: number) => 118 - 104 * x ** 1.4
const along = (from: number, to: number) => {
  const points: string[] = []
  for (let i = 0; i <= 24; i++) {
    const x = from + ((to - from) * i) / 24
    points.push(`${(x * 1000).toFixed(1)} ${courseY(x).toFixed(2)}`)
  }
  return `M${points.join(' L')}`
}

function Ahead() {
  return (
    <section className={s.ahead} id="next" aria-labelledby="next-h">
      <Stamp
        day="Course ahead"
        date="A draft"
        link={
          <a className={s.out} href={`${LINKS.repo}/tree/main/docs/plans`}>
            Plans on GitHub
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
              <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </a>
        }
      />
      <h2 className={s.head} id="next-h">
        <span className={s.title}>What’s next</span>
      </h2>
      <div className={s.chart}>
        <svg className={s.course} viewBox={`0 0 1000 ${COURSE_H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="log-fade" gradientUnits="userSpaceOnUse" x1="667" y1="0" x2="1000" y2="0">
              <stop offset="0" stopColor="rgb(255 244 232)" stopOpacity="0.3" />
              <stop offset="1" stopColor="rgb(255 244 232)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={s.flown} d={along(0, 1 / 3)} />
          <path className={s.plotted} d={along(1 / 3, 2 / 3)} />
          <path className={s.beyond} d={along(2 / 3, 1)} stroke="url(#log-fade)" />
        </svg>
        <ol className={s.stages}>
          {STAGES.map((stage, i) => (
            <li key={stage} className={s.stage} data-stage={stage} style={{ '--y': `${courseY(i / 3)}px` } as CSSProperties}>
              <span className={s.waypoint} aria-hidden="true" />
              <h3 className={s.label}>{STAGE_WORD[stage]}</h3>
              <ul>
                {ROADMAP.filter((p) => p.stage === stage).map((p) => (
                  <li key={p.title}>
                    <b>{p.title}</b>
                    <span>{p.detail}</span>
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

/** The latest release, to download, as the log ends. */
function End() {
  const download = useDownload()
  const os = download.pending ? 'mac' : download.os
  return (
    <div className={s.endRow}>
      <p>
        <span className={s.v}>{LATEST.version}</span> is the latest release.
      </p>
      <div className={s.ways}>
        <a className={s.primary} href={download.href}>
          {os && <OsMark id={os} size={16} />}
          {os ? `Download for ${OS_NAME[os]}` : 'Download'}
        </a>
        <a className={s.secondary} href={LINKS.releases}>
          All releases
        </a>
      </div>
    </div>
  )
}

export function Log() {
  return (
    <main id="main" tabIndex={-1} className={s.main}>
      {/* Dark all the way down: the nav turns to smoked glass over it. */}
      <LightUnder tone="ink" className={s.under} />
      <Window />
      <ol className={s.log} aria-label="Log">
        <Tail />
        {RELEASES.map((release) => (
          <Entry key={release.version} release={release} first={release === FIRST} />
        ))}
      </ol>
      <Ahead />
      <End />
    </main>
  )
}
