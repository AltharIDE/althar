import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import {
  type Change,
  KIND_WORD,
  type Kind,
  ON_MAIN,
  pullUrl,
  type Release,
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
import { COMING, type Highlight, HIGHLIGHT, MERGED, PUBLISHED } from './LogData'
import { LogPicture } from './LogPictures'

/*
 * The changelog as the flight log of the capsule the homepage brings in from
 * orbit. It opens on a window as the first screen's is, its instruments
 * along its top: the mission's elapsed time since 0.1.0 went out, counting,
 * and the launch; what main holds for the next release, and the current
 * version. In it, the newest release's highlight, shown; behind it, the
 * night side of the planet, its edge lit cobalt: the page's one light.
 *
 * Under it, the log, newest first, down a rail: what has merged on main is
 * its live tail, with what it brings next and its newest line's caret
 * blinking; then each release, stamped with the mission's time when it went
 * out, led by its highlight, shown, and then its lines: what's new in full,
 * what was improved and fixed folded until asked for. Then what's next, as a
 * course plotted into the dark, Now lit, Next dashed, Later fading; and the
 * download.
 *
 * With reduced motion the clock reads once and the caret holds still.
 */

addDisplay()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const LATEST = RELEASES[0]!
const FIRST = RELEASES[RELEASES.length - 1]!
/** The launch: when the first build was published. */
const LAUNCH = Date.parse(PUBLISHED[FIRST.version] ?? `${FIRST.date}T00:00:00Z`)

/** A day as the log writes it: 20 Oct 2026, or 20 Oct. */
const dated = (iso: string, year = true) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]}${year ? ` ${y}` : ''}`
}

const two = (n: number) => String(n).padStart(2, '0')

/** The mission's elapsed time at `ms`: T+17d 20:39, and its seconds with `seconds`. */
const elapsed = (ms: number, seconds = true) => {
  const all = Math.max(0, Math.floor((ms - LAUNCH) / 1000))
  const d = Math.floor(all / 86_400)
  const hm = `${two(Math.floor(all / 3600) % 24)}:${two(Math.floor(all / 60) % 60)}`
  return `T+${d}d ${hm}${seconds ? `:${two(all % 60)}` : ''}`
}

/** When a release went out, on the mission's clock: from GitHub, or its day. */
const wentOut = (release: Release) => elapsed(Date.parse(PUBLISHED[release.version] ?? `${release.date}T12:00:00Z`), false)

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

/** A release's changes, in runs of one kind, in the order the release notes give them, less those its highlight shows. */
const runs = (changes: readonly Change[], shown: readonly number[] = []) =>
  changes.reduce<{ kind: Kind; lines: string[] }[]>((all, change, i) => {
    if (shown.includes(i)) return all
    const last = all[all.length - 1]
    if (last?.kind === change.kind) last.lines.push(change.text)
    else all.push({ kind: change.kind, lines: [change.text] })
    return all
  }, [])

const OUT = (
  <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
    <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

/** An instrument: what it reads, and the reading; a way into the log. */
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
        1000 - ((Date.now() - LAUNCH) % 1000) + 4,
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

/** An entry's stamp: the mission's time and the date along a rule, and its link at the end. */
function Stamp({ at, date, note, link }: { at: string; date: string; note?: string; link?: ReactNode }) {
  return (
    <p className={s.stamp}>
      {/* The mission's time keeps its small d: T+7d. */}
      <span className={cx(s.t, at.startsWith('T+') && s.met)}>{at}</span>
      <span>{date}</span>
      {note && <span className={s.note}>{note}</span>}
      <span className={s.rule} aria-hidden="true" />
      {link}
    </p>
  )
}

/** The window: its instruments along the top, the newest release's highlight in the middle, the planet's lit edge behind. */
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
  const lead = HIGHLIGHT[LATEST.version]

  return (
    <header className={s.window}>
      <div className={s.sky} aria-hidden="true">
        <div className={s.haze} />
        <div className={s.limb} />
        <div ref={grain} className={s.grain} />
      </div>
      <div className={s.deck}>
        <div className={s.pair}>
          <Readout label="Mission elapsed" href={`#v${FIRST.version}`}>
            <Clock />
          </Readout>
          <Readout label="Launch" href={`#v${FIRST.version}`}>
            <b>{dated(FIRST.date)}</b>
          </Readout>
        </div>
        <h1 className={s.plate}>Changelog</h1>
        <div className={cx(s.pair, s.end)}>
          <Readout label="Next release" href="#on-main">
            <b>
              {ON_MAIN.length} merged
              <span className={s.meter} aria-hidden="true">
                {ON_MAIN.map((m) => (
                  <span key={m.pr} />
                ))}
              </span>
            </b>
          </Readout>
          <Readout label="Current version" href={`#v${LATEST.version}`} end>
            <b>{LATEST.version}</b>
          </Readout>
        </div>
      </div>
      {lead && (
        <>
          <div className={s.lead}>
            <p className={s.leadStamp}>
              <span className={s.met}>{wentOut(LATEST)}</span>
              <span>{LATEST.version}</span>
              <span>{dated(LATEST.date)}</span>
            </p>
            <h2 className={s.headline}>{lead.title}</h2>
            <p className={s.why}>
              {lead.why}{' '}
              <a className={s.more} href={`#v${LATEST.version}`}>
                Everything in {LATEST.version}
              </a>
            </p>
          </div>
          <div className={s.heroPic}>
            <LogPicture picture={lead.picture} />
          </div>
        </>
      )}
    </header>
  )
}

/** A highlight: what it gives you, why it matters, and the picture that shows it. */
function Shown({ highlight, note, children }: { highlight: Highlight; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.shown}>
      {note && <p className={s.coming}>{note}</p>}
      <h3 className={s.hl}>{highlight.title}</h3>
      <p className={s.hlWhy}>
        {highlight.why}
        {children}
      </p>
      <div className={s.hlPic}>
        <LogPicture picture={highlight.picture} />
      </div>
    </div>
  )
}

/** What has merged on main since the last release: the log's live tail, what it brings first, then each merge, newest first, its caret blinking. */
function Tail() {
  const newest = ON_MAIN[0]!
  const merges = ON_MAIN.filter((m) => m.pr !== COMING.pr)
  return (
    <li className={cx(s.entry, s.tail)} id="on-main">
      <span className={s.node} aria-hidden="true" />
      <Stamp at={elapsed(Date.parse(MERGED[newest.pr] ?? `${newest.date}T12:00:00Z`), false)} date={dated(newest.date)} note="On main" />
      <h2 className={s.head}>
        <span className={s.v}>main</span>
        <span className={s.title}>Since {LATEST.version}, for the next release</span>
      </h2>
      <Shown highlight={COMING} note="Coming in the next release">
        {' '}
        <a className={s.prIn} href={pullUrl(COMING.pr)}>
          #{COMING.pr}
        </a>
      </Shown>
      <ul className={s.lines}>
        {merges.map((m, i) => {
          const day = i === 0 || merges[i - 1]!.date !== m.date
          return (
            <li key={m.pr} className={cx(s.merged, m === newest && s.newest)}>
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

/** A run of one kind of change, under its word. */
function Run({ kind, lines }: { kind: Kind; lines: readonly string[] }) {
  return (
    <div className={s.run} data-kind={kind}>
      <span className={s.label}>{KIND_WORD[kind]}</span>
      <ul className={s.lines}>
        {lines.map((line, j) => (
          <li key={j}>
            <Words text={line} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A release: its stamp, its version and title, its highlight, what's new, and what was improved and fixed, folded. */
function Entry({ release }: { release: Release }) {
  const first = release === FIRST
  // The newest release's highlight opens the page: here it keeps every line.
  const highlight = release === LATEST ? undefined : HIGHLIGHT[release.version]
  const all = runs(release.changes, highlight?.covers)
  const shown = all.filter((run) => run.kind === 'new')
  const folded = all.filter((run) => run.kind !== 'new')
  const more = folded.reduce((n, run) => n + run.lines.length, 0)
  return (
    <li className={cx(s.entry, first && s.launch)} id={`v${release.version}`}>
      <span className={s.node} aria-hidden="true" />
      <Stamp
        at={wentOut(release)}
        date={dated(release.date)}
        note={first ? 'Launch' : undefined}
        link={
          <a className={s.out} href={releaseUrl(release.version)}>
            On GitHub
            {OUT}
          </a>
        }
      />
      <h2 className={s.head}>
        {/* The version links to its own entry, to share. */}
        <a className={s.v} href={`#v${release.version}`}>
          {release.version}
        </a>
        <span className={s.title}>{release.title}</span>
      </h2>
      {highlight && <Shown highlight={highlight} />}
      <div className={s.runs}>
        {shown.map((run, i) => (
          <Run key={i} {...run} />
        ))}
        {more > 0 && (
          <details className={s.fold}>
            <summary>
              <span className={s.closed}>{more} more</span>
              <span className={s.opened}>Fewer</span>
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </summary>
            <div className={s.runs}>
              {folded.map((run, i) => (
                <Run key={i} {...run} />
              ))}
            </div>
          </details>
        )}
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
const COURSE_H = 150
const courseY = (x: number) => 138 - 126 * x ** 1.5
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
        at="Course ahead"
        date="A draft"
        link={
          <a className={s.out} href={`${LINKS.repo}/tree/main/docs/plans`}>
            Plans on GitHub
            {OUT}
          </a>
        }
      />
      <h2 className={s.head} id="next-h">
        <span className={s.title}>What’s next</span>
      </h2>
      <div className={s.plot}>
        <svg
          className={s.course}
          viewBox={`0 0 1000 ${COURSE_H}`}
          preserveAspectRatio="none"
          style={{ height: COURSE_H }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="log-fade" gradientUnits="userSpaceOnUse" x1="667" y1="0" x2="1000" y2="0">
              <stop offset="0" stopColor="rgb(255 244 232)" stopOpacity="0.45" />
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
          <Entry key={release.version} release={release} />
        ))}
      </ol>
      <Ahead />
      <End />
    </main>
  )
}
