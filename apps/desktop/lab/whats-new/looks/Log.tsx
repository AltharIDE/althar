import { Fragment, type ReactNode } from 'react'

import { Code } from '@althar/ui'

import { night as n, Night, Readout, Window } from '../../../../site/src/shared/night/Night'
import { open } from '../parts'
import { byKind, FLAGSHIP, FLAGSHIP_WHY, fromVersion, type Kind, newTo, NOW, type Release, RELEASES } from '../notes'
import { useLab } from '../state'
import l from './log.module.css'
import ls from './site/Log.module.css'
import { LogPicture, type Picture } from './site/LogPictures'

/*
 * Look 3: the site's flight log, in the window. The site's own night page
 * (apps/site's shared/night), its instruments along the top reading the
 * update, the release large in the middle over its lead's living picture,
 * then the log: the releases new to you lit, with their highlights and
 * their changes in runs, the rest folded, and the releases before on the
 * rail. The pictures and the log's styles are the site's (site/, from the
 * 0.10.0 entry's branch).
 */

const WORD: Record<Kind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' }

/** 20 Nov 2026, as the log stamps it. */
const stamped = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Each release's highlights past its lead, with the site's pictures: 0.10.0's artifacts are 0.8.0's canvases, talked to. */
const SHOWN: Record<string, readonly { title: string; why: string; picture: Picture }[]> = {
  '0.10.0': [
    {
      title: 'Artifacts you talk to',
      why: 'Open one beside its own chat, point at a part and say what you think, and its agent draws a new version.',
      picture: 'canvas',
    },
  ],
  '0.9.0': [
    {
      title: 'Undo, files and all',
      why: 'Take back a message you sent a task in its own worktree: the files those turns changed go back as they were, and your prompt returns to the draft.',
      picture: 'undo',
    },
  ],
}

function Words({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <Code key={i} className={ls.code}>
        {part.slice(1, -1)}
      </Code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

function Run({ kind, lines }: { kind: Kind; lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <div className={ls.run} data-kind={kind}>
      <span className={ls.label}>{WORD[kind]}</span>
      <ul className={ls.lines}>
        {lines.map((line) => (
          <li key={line}>
            <Words text={line} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A stamp along a rule: its date, and a note. */
function Stamp({ release, note }: { release: Release; note?: string }) {
  return (
    <p className={ls.stamp}>
      <span className={ls.t}>{release.version}</span>
      <span>{stamped(release.date)}</span>
      {note !== undefined && <span className={ls.note}>{note}</span>}
      <span className={ls.rule} aria-hidden="true" />
    </p>
  )
}

/** A release on the rail: lit where it's new to you, its highlights, what's new, and the rest folded. */
function Entry({ release, fresh, last }: { release: Release; fresh: boolean; last: boolean }) {
  const lead = release === NOW
  const runs = (['improved', 'fixed'] as const).map((kind) => ({ kind, lines: byKind(release, kind).map((c) => c.text) }))
  const more = runs.reduce((sum, run) => sum + run.lines.length, 0)
  return (
    <li className={[ls.entry, fresh && ls.current, last && ls.launch].filter(Boolean).join(' ')}>
      <span className={ls.node} aria-hidden="true" />
      {!lead && (
        <>
          <Stamp release={release} note={fresh ? 'New to you' : undefined} />
          <h2 className={ls.head}>
            <span className={ls.v}>{release.version}</span>
            <span className={ls.title}>{release.title}</span>
          </h2>
        </>
      )}
      {fresh &&
        (SHOWN[release.version] ?? []).map((one) => (
          <div key={one.title} className={ls.shown}>
            <h3 className={ls.hl}>{one.title}</h3>
            <p className={ls.hlWhy}>{one.why}</p>
            <div className={ls.hlPic}>
              <LogPicture picture={one.picture} />
            </div>
          </div>
        ))}
      <div className={ls.runs}>
        <Run kind="new" lines={byKind(release, 'new', true).map((c) => c.text)} />
        {more > 0 && (
          <details className={ls.fold}>
            <summary>
              <span className={ls.closed}>{more} more</span>
              <span className={ls.opened}>Fewer</span>
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </summary>
            <div className={ls.runs}>
              {runs.map((run) => (
                <Run key={run.kind} {...run} />
              ))}
            </div>
          </details>
        )}
      </div>
    </li>
  )
}

export function Log({ back }: { back?: ReactNode }) {
  const { skipped } = useLab()
  const fresh = newTo(skipped)
  const shown = RELEASES.slice(0, 5)
  return (
    <div className={l.page}>
      <Night head className={`${ls.main} ${l.night}`}>
        {back !== undefined && <div className={l.back}>{back}</div>}
        <Window
          deck={
            <>
              <Readout label="Updated from" href="#/whats-new">
                <b>{fromVersion(skipped)}</b>
              </Readout>
              <Readout label="Released" href="#/whats-new" at="mid">
                <b>{stamped(NOW.date)}</b>
              </Readout>
              <Readout label="Now on" href="#/whats-new" at="end">
                <b>{NOW.version}</b>
              </Readout>
            </>
          }
        >
          <div className={`${n.head} ${ls.lead}`}>
            <h1 className={n.over}>
              <span className={n.overLit}>{NOW.version}</span>
              <span>{NOW.title}</span>
            </h1>
            <p className={n.headline}>{FLAGSHIP.title}</p>
            <p className={n.why}>{FLAGSHIP_WHY}</p>
            <p className={`${ls.ways} ${l.ways}`}>
              <button type="button" className={ls.primary} onClick={() => open('homes')}>
                Connect a home
              </button>
              <button type="button" className={ls.secondary} onClick={() => open('workers')}>
                Add a worker
              </button>
            </p>
          </div>
          <div className={n.picture}>
            <LogPicture picture="home" />
          </div>
        </Window>
        <ol className={ls.log} aria-label="Log">
          {shown.map((release, i) => (
            <Entry key={release.version} release={release} fresh={fresh.includes(release)} last={i === shown.length - 1} />
          ))}
        </ol>
        <p className={l.end}>
          <a href="https://althar.ai/changelog" target="_blank" rel="noreferrer">
            {RELEASES[shown.length]?.version} and earlier, on the changelog
          </a>
        </p>
      </Night>
    </div>
  )
}
