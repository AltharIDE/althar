import { useState } from 'react'

import { Icon, LiveDot, MergeLine, mergeLineText, VisuallyHidden } from '@althar/ui'

import type { Going, State } from './data'
import s from './units.module.css'

/*
 * What one ask to merge becomes, in each direction: every pull request and
 * task asked to go in, with where it stands, kept current in place. The
 * errands it kept are its rows, not lines of their own; the coordinator's
 * turns that only took a merge step draw nothing; once all are in, it is the
 * kit's merge line folded to one line.
 */

const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

const WORD: Record<State, string> = mergeLineText.state

const merged = (going: ReadonlyArray<Going>) => going.every((one) => one.state === 'merged')
const trouble = (state: State) => state === 'sent_back' || state === 'conflict'
const tone = (state: State) => (state === 'sent_back' ? 'sentBack' : state)

/** The mark before each: a check for what merged, a live dot while checks run, a ring for what waits its turn, a dashed one for what isn't in line yet, a cross for what came back. */
function Mark({ state }: { state: State }) {
  switch (state) {
    case 'merged':
      return <Icon name="check" size={11} />
    case 'checks':
    case 'merging':
      return <LiveDot ping />
    case 'sent_back':
    case 'conflict':
      return <Icon name="close" size={11} />
    case 'queued':
      return <span className={s.ring} aria-hidden="true" />
    case 'waiting':
      return <span className={cx(s.ring, s.dashed)} aria-hidden="true" />
  }
}

/** Its number and title, a link to the pull request; or its task's name, while it has none. */
function Label({ going }: { going: Going }) {
  if (going.url === null) return <span className={s.task}>{going.title}</span>
  return (
    <a href={going.url} target="_blank" rel="noreferrer" className={s.link} title={`#${going.number} ${going.title}`}>
      <span className={s.number}>#{going.number}</span> <span className={s.title}>{going.title}</span>
    </a>
  )
}

/** One row: its mark, what it is, what it waits for or what went wrong under it, and where it stands. */
function Row({ going }: { going: Going }) {
  return (
    <li className={cx(s.row, s[tone(going.state)])}>
      <span className={s.mark}>
        <Mark state={going.state} />
      </span>
      <span className={s.main}>
        <Label going={going} />
        {going.note !== undefined && <span className={s.note}>{going.note}</span>}
      </span>
      <span className={s.state}>{WORD[going.state]}</span>
    </li>
  )
}

/** All in: the kit's own merge line, which folds itself to one line. */
export function Landed({ going }: { going: ReadonlyArray<Going> }) {
  return (
    <MergeLine
      label="Merged into main"
      rows={going.map((one) => ({ number: one.number ?? 0, title: one.title, url: one.url ?? '', state: 'merged' }))}
    />
  )
}

/** A: one card in the reply that asked for it, a row for each, kept current in place. */
export function MergeCard({ going }: { going: ReadonlyArray<Going> }) {
  if (merged(going)) return <Landed going={going} />
  return (
    <section className={s.card} aria-label="Merging into main" data-rhythm="card">
      <ol className={s.rows}>
        {going.map((one) => (
          <Row key={one.key} going={one} />
        ))}
      </ol>
    </section>
  )
}

/** The track's stops, and where each state stands on it: what came back stands at its checks. */
const STOPS = ['In line', 'Checks', 'Queue', 'Merged'] as const
const STOP: Record<State, number> = { waiting: 0, checks: 1, sent_back: 1, conflict: 1, queued: 2, merging: 2, merged: 3 }

/** B: the same card, each row a track it moves along, In line to Merged; what comes back steps back to its checks, in red. */
export function MergeTrack({ going }: { going: ReadonlyArray<Going> }) {
  if (merged(going)) return <Landed going={going} />
  return (
    <section className={cx(s.card, s.tracks)} aria-label="Merging into main" data-rhythm="card">
      <div className={s.trackHead} aria-hidden="true">
        <span />
        <span className={s.stops}>
          {STOPS.map((stop) => (
            <span key={stop}>{stop}</span>
          ))}
        </span>
      </div>
      <ol className={s.rows}>
        {going.map((one) => (
          <li key={one.key} className={cx(s.trackRow, s[tone(one.state)])}>
            <span className={s.main}>
              <Label going={one} />
              {one.note !== undefined && <span className={s.note}>{one.note}</span>}
            </span>
            <Track state={one.state} open={one.url !== null} />
          </li>
        ))}
      </ol>
    </section>
  )
}

/** One row's track: the stops, the way it came, and where it is now, which slides on as it moves. */
function Track({ state, open }: { state: State; open: boolean }) {
  const at = STOP[state]
  return (
    <span className={cx(s.track, s[tone(state)], !open && s.unopened)} style={{ ['--at' as string]: at }}>
      <span className={s.rail} aria-hidden="true" />
      <span className={s.came} aria-hidden="true" />
      {STOPS.map((stop, index) => (
        <span key={stop} className={cx(s.stop, index <= at && s.passed)} style={{ ['--i' as string]: index }} aria-hidden="true" />
      ))}
      <span className={s.puck} aria-hidden="true">
        <Mark state={state} />
      </span>
      <VisuallyHidden>{WORD[state]}</VisuallyHidden>
    </span>
  )
}

/**
 * C: one line at the thread's foot while any is on its way, under whatever
 * was said since: each a mark and its number. What came back says why under
 * it; the line opens to the rows. Once all are in, it goes, and the reply
 * that asked holds the folded merge line.
 */
export function FootLine({ going, open: opened = false }: { going: ReadonlyArray<Going>; open?: boolean }) {
  const [open, setOpen] = useState(opened)
  const back = going.filter((one) => trouble(one.state))
  return (
    <section className={s.foot} aria-label="Merging into main" data-rhythm="line">
      <button type="button" className={s.footHead} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <span className={s.footName}>Merging into main</span>
        <span className={s.tokens}>
          {going.map((one) => (
            <span
              key={one.key}
              className={cx(s.token, s[tone(one.state)])}
              title={`${one.number === null ? one.title : `#${one.number} ${one.title}`}: ${WORD[one.state]}`}
            >
              <span className={s.tokenMark}>
                <Mark state={one.state} />
              </span>
              {one.number === null ? one.task : `#${one.number}`}
              <VisuallyHidden> {WORD[one.state]}</VisuallyHidden>
            </span>
          ))}
        </span>
        <span className={cx(s.chevron, open && s.chevronOpen)}>
          <Icon name="chevronD" size={11} />
        </span>
      </button>
      {!open &&
        back.map((one) => (
          <p key={one.key} className={s.back}>
            <span className={s.backWho}>#{one.number} sent back.</span> {one.note}
          </p>
        ))}
      {open && (
        <ol className={cx(s.rows, s.footRows)}>
          {going.map((one) => (
            <Row key={one.key} going={one} />
          ))}
        </ol>
      )}
    </section>
  )
}
