import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'

import {
  type Change,
  KIND_WORD,
  type Kind,
  type Release,
  releaseUrl,
  RELEASES,
  ROADMAP,
  type Stage,
  STAGE_WORD,
} from '../../content/changelog'
import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import { useDownload } from '../../lib/download'
import { Night, night as n, Readout, Window } from '../../shared/night/Night'
import { OS_NAME, OsMark } from '../../shared/OsMark'
import s from './Log.module.css'
import { type Highlight, HIGHLIGHTS, PUBLISHED } from './LogData'
import { LogPicture } from './LogPictures'

/*
 * The changelog as the flight log of the capsule the homepage brings in from
 * orbit. It opens on a window as the first screen's is, its instruments
 * along its top: the mission's elapsed time since 0.1.0 went out, counting;
 * the launch; and the current version. In it, the newest release: when it
 * went out, its version and title, large, and its lead feature beside its
 * picture; behind them, the night side of the planet, its edge lit cobalt:
 * the page's one light.
 *
 * Under it, the log, newest first, down a rail: the newest release goes on
 * from the window, lit; then each release, stamped with the mission's time
 * when it went out, led by its highlights, shown, and then its lines: what's
 * new in full, what was improved and fixed folded until asked for. Then
 * what's next, as a course plotted into the dark, Now lit, Next dashed,
 * Later fading; and the download.
 *
 * With reduced motion the clock reads once.
 */

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
function Stamp({ at, date, note, link, className }: { at: string; date: string; note?: string; link?: ReactNode; className?: string }) {
  return (
    <p className={cx(s.stamp, className)}>
      {/* The mission's time keeps its small d: T+7d. */}
      <span className={cx(s.t, at.startsWith('T+') && s.met)}>{at}</span>
      <span>{date}</span>
      {note && <span className={s.note}>{note}</span>}
      <span className={s.rule} aria-hidden="true" />
      {link}
    </p>
  )
}

/** A release's stamp: when it went out, on the mission's clock and by date, and its release on GitHub. */
function Released({ release, className }: { release: Release; className?: string }) {
  return (
    <Stamp
      at={wentOut(release)}
      date={dated(release.date)}
      note={release === FIRST ? 'Launch' : undefined}
      className={className}
      link={
        <a className={s.out} href={releaseUrl(release.version)}>
          On GitHub
          {OUT}
        </a>
      }
    />
  )
}

/** The window: the mission's clock, the launch and the version along its top, the newest release in the middle. */
function Opening() {
  const lead = HIGHLIGHTS[LATEST.version]?.[0]
  return (
    <Window
      deck={
        <>
          <Readout label="Mission elapsed" href={`#v${FIRST.version}`}>
            <Clock />
          </Readout>
          <Readout label="Launch" href={`#v${FIRST.version}`} at="mid">
            <b>{dated(FIRST.date)}</b>
          </Readout>
          <Readout label="Current version" href="#changes" at="end">
            <b>{LATEST.version}</b>
          </Readout>
        </>
      }
    >
      <h1 className={n.sr}>Changelog</h1>
      {/* The newest release: when it went out, its version and title over its lead, large in the middle, and the lead shown. */}
      <div className={cx(n.head, s.lead)} id={`v${LATEST.version}`}>
        {/* On a phone its stamp waits for the log, under the window, so the window keeps to the clock and the release. */}
        <Released release={LATEST} className={s.wideOnly} />
        <h2 className={n.over}>
          <span className={n.overLit}>{LATEST.version}</span>
          <span>{LATEST.title}</span>
        </h2>
        {lead && (
          <>
            <h3 className={n.headline}>{lead.title}</h3>
            <p className={n.why}>{lead.why}</p>
          </>
        )}
      </div>
      {lead && (
        <div className={n.picture}>
          <LogPicture picture={lead.picture} />
        </div>
      )}
    </Window>
  )
}

/** A highlight: what it gives you, why it matters, and the picture that shows it. Its name goes unsaid where the release's title already says it. */
function Shown({ highlight, release }: { highlight: Highlight; release: Release }) {
  return (
    <div className={s.shown}>
      {highlight.title !== release.title && <h3 className={s.hl}>{highlight.title}</h3>}
      <p className={s.hlWhy}>{highlight.why}</p>
      <div className={s.hlPic}>
        <LogPicture picture={highlight.picture} />
      </div>
    </div>
  )
}

/** What is folded until asked for: `count` more, opening in place. Find in page opens it too. */
function Fold({ count, children }: { count: number; children: ReactNode }) {
  return (
    <details className={s.fold}>
      <summary>
        <span className={s.closed}>{count} more</span>
        <span className={s.opened}>Fewer</span>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </summary>
      {children}
    </details>
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
  // The newest release's head and lead open the page, in the window: here it goes on with the rest, keeping the lead's lines.
  const current = release === LATEST
  const highlights = (HIGHLIGHTS[release.version] ?? []).slice(current ? 1 : 0)
  const all = runs(
    release.changes,
    highlights.flatMap((h) => h.covers),
  )
  const shown = all.filter((run) => run.kind === 'new')
  const folded = all.filter((run) => run.kind !== 'new')
  const more = folded.reduce((n, run) => n + run.lines.length, 0)
  return (
    <li className={cx(s.entry, first && s.launch, current && s.current)} id={current ? 'changes' : `v${release.version}`}>
      <span className={s.node} aria-hidden="true" />
      {current && <Released release={release} className={s.phoneOnly} />}
      {!current && (
        <>
          <Released release={release} />
          <h2 className={s.head}>
            {/* The version links to its own entry, to share. */}
            <a className={s.v} href={`#v${release.version}`}>
              {release.version}
            </a>
            <span className={s.title}>{release.title}</span>
          </h2>
        </>
      )}
      {highlights.map((highlight) => (
        <Shown key={highlight.title} highlight={highlight} release={release} />
      ))}
      <div className={s.runs}>
        {shown.map((run, i) => (
          <Run key={i} {...run} />
        ))}
        {more > 0 && (
          <Fold count={more}>
            <div className={s.runs}>
              {folded.map((run, i) => (
                <Run key={i} {...run} />
              ))}
            </div>
          </Fold>
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
const COURSE_H = 120
const courseY = (x: number) => 108 - 96 * x ** 1.5
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
            <span>
              <span className={s.long}>Plans </span>on GitHub
            </span>
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
    <Night className={s.main}>
      <Opening />
      <ol className={s.log} aria-label="Log">
        {RELEASES.map((release) => (
          <Entry key={release.version} release={release} />
        ))}
      </ol>
      <Ahead />
      <End />
    </Night>
  )
}
