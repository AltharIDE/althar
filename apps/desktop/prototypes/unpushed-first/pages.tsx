import { useState } from 'react'

import { Button } from '@althar/ui'

import { type Direction, directions } from './direction'
import { stages } from './scenario'

/*
 * The pages round the windows: one per direction, each window a frame of
 * screen.html at the size the app opens at, its states in order and
 * captioned as the screenshots are named; today's, for reference; and every
 * direction side by side.
 */

const W = 1180
const H = 760

const src = (d: Direction, s: string, extra = '') => `screen.html?d=${d}&s=${s}${extra}`

function Frame({ url, scale = 1, title }: { url: string; scale?: number; title: string }) {
  return (
    <div style={{ width: W * scale, height: H * scale, overflow: 'hidden', borderRadius: 12 * scale + 2 }} className="frame-box">
      <iframe
        src={url}
        title={title}
        loading="lazy"
        width={W}
        height={H}
        style={{ border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', display: 'block', background: 'var(--n-2)' }}
      />
    </div>
  )
}

function Shot({ label, caption, url }: { label: string; caption: string; url: string }) {
  return (
    <figure className="shot" style={{ margin: 0 }}>
      <figcaption className="caption">
        <b>{label}</b>
        {caption}
      </figcaption>
      <div className="frame">
        <Frame url={url} title={`${label} ${caption}`} />
      </div>
    </figure>
  )
}

function Nav({ page }: { page: string }) {
  const links = [['index', 'All side by side'], ['today', 'Today'], ...directions.map((d) => [d.key, d.name.split(' · ')[0] ?? d.key])]
  return (
    <nav className="nav">
      {links.map(([key, name]) => (
        <a key={key} href={`${key}.html`} aria-current={key === page ? 'page' : undefined}>
          {name}
        </a>
      ))}
    </nav>
  )
}

/** A window where Push really goes: pushing, then pushed, the count gone at once. */
function Live({ d }: { d: Direction }) {
  const [round, setRound] = useState(0)
  return (
    <figure className="shot" style={{ margin: 0 }}>
      <figcaption className="caption">
        <b>Try it</b>
        Press Push: it shows pushing, then pushed, and the count goes at once.{' '}
        <Button size="small" onClick={() => setRound(round + 1)}>
          Start over
        </Button>
      </figcaption>
      <div className="frame">
        <Frame key={round} url={src(d, 'ahead', '&live')} title="Try it" />
      </div>
    </figure>
  )
}

const extraFaces: Partial<Record<Direction, { face: string; note: string }>> = {
  a: { face: 'talk', note: 'the conversation: the lead’s push request as today; the header says what comes first' },
  b: { face: 'out', note: 'on Outputs: the same bar, pinned over the change' },
  c: { face: 'out', note: 'inside the task: as today' },
  d: { face: 'talk', note: 'the conversation: as today' },
  e: { face: 'out', note: 'on Outputs: the header’s count is there too' },
}

function DirectionPage({ d }: { d: Exclude<Direction, 'today'> }) {
  const it = directions.find((one) => one.key === d)
  const L = d.toUpperCase()
  const other = extraFaces[d]
  return (
    <main className="page">
      <header>
        <h1>{it?.name}</h1>
        <p className="lede">{it?.gist}</p>
        <Nav page={d} />
      </header>
      <Live d={d} />
      {stages.map((stage) => (
        <Shot key={stage.key} label={`${L}${stage.n}`} caption={stage.name} url={src(d, stage.key)} />
      ))}
      {other && <Shot label={`${L}2, other face`} caption={`3 commits to push, ${other.note}`} url={src(d, 'ahead', `&f=${other.face}`)} />}
    </main>
  )
}

function TodayPage() {
  return (
    <main className="page">
      <header>
        <h1>Today</h1>
        <p className="lede">
          The app as it is, with the same task: Outputs puts Accept and merge in the card, and Push 3 commits under it, both violet; the
          conversation has the lead’s push request at the end of the thread. T1–T5 are the conversation, T6–T10 Outputs.
        </p>
        <Nav page="today" />
      </header>
      {(['talk', 'out'] as const).flatMap((face, i) =>
        stages.map((stage) => (
          <Shot
            key={`${face}${stage.key}`}
            label={`T${i * 5 + stage.n}`}
            caption={`${face === 'talk' ? 'Conversation' : 'Outputs'} · ${stage.name}`}
            url={src('today', stage.key, `&f=${face}`)}
          />
        )),
      )}
    </main>
  )
}

/** A window's screenshot, as shoot.mjs names it. */
const shotOf = (d: Direction, n: number, key: string) =>
  d === 'today' ? `T${5 + n}-today-out-${key}.png` : `${d.toUpperCase()}${n}-${key}.png`

function Comparison() {
  const scale = 0.32
  const columns: ReadonlyArray<{ key: Direction; name: string }> = [{ key: 'today', name: 'Today' }, ...directions]
  return (
    <main className="page">
      <header>
        <h1>Unpushed commits first: every direction, side by side</h1>
        <p className="lede">
          One task: the lead committed three more times after review and didn’t push. Each column is a direction, A to E, after today’s for
          reference; each row a state. These are screenshots of the live windows; open a direction for them full size and working, with one
          where Push really goes.
        </p>
        <Nav page="index" />
      </header>
      <div className="compare" style={{ gridTemplateColumns: `110px repeat(${columns.length}, ${W * scale}px)` }}>
        <span />
        {columns.map((c) => (
          <a key={c.key} className="head" href={`${c.key}.html`}>
            {c.name}
          </a>
        ))}
        {stages.map((stage) => [
          <span key={`s${stage.key}`} className="state">
            {stage.n}. {stage.name}
          </span>,
          ...columns.map((c) => (
            <a key={`${c.key}${stage.key}`} href={`${c.key}.html`} className="cell">
              <img src={shotOf(c.key, stage.n, stage.key)} alt={`${c.name}, ${stage.name}`} width={W * scale} height={H * scale} />
              <span className="label">{c.key === 'today' ? `T${5 + stage.n}` : `${c.key.toUpperCase()}${stage.n}`}</span>
            </a>
          )),
        ])}
      </div>
    </main>
  )
}

export function Pages({ page }: { page: string }) {
  if (page === 'today') return <TodayPage />
  if (page === 'a' || page === 'b' || page === 'c' || page === 'd' || page === 'e') return <DirectionPage d={page} />
  return <Comparison />
}
