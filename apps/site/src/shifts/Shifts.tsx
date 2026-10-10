import { Brand, BrandMark } from '@althar/ui'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import { LINKS } from '../content/facts'
import { KIND_WORD, SHIFTS, ShiftKind, type Shift } from '../content/shifts'
import { cx } from '../lib/cx'
import { Footer } from '../shared/footer/Footer'
import { Lit } from '../shared/Lit'
import { Nav } from '../shared/Nav'
import { byMonth, countByKind, daysCovered, newestFirst, onlyKind, shortDate } from './group'
import s from './Shifts.module.css'

/*
 * Shifts: what changed under developers who code with agents, since August.
 * A cobalt head with the count and every shift on one strip of days, then the
 * list by month, filterable by kind, each entry linking its source. The
 * argument is made once, at the top; the entries are only facts.
 */

const MARK_OF: Record<string, Brand> = {
  Anthropic: Brand.Anthropic,
  OpenAI: Brand.OpenAI,
  Google: Brand.Google,
  GitHub: Brand.GitHub,
  DeepSeek: Brand.DeepSeek,
  Cursor: Brand.Cursor,
  'Z.ai': Brand.Zai,
  Alibaba: Brand.Alibaba,
}

const DAY = 86_400_000
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)

/** Every shift on one strip of days, from the first of the oldest month to the newest shift. */
function Strip({ shifts }: { shifts: readonly Shift[] }) {
  const sorted = newestFirst(shifts)
  const newest = sorted[0]
  const oldest = sorted.at(-1)
  if (!newest || !oldest) return null
  const start = time(`${oldest.date.slice(0, 7)}-01`)
  const days = Math.round((time(newest.date) - start) / DAY) + 1
  const months = byMonth(shifts).map((m) => ({ ...m, at: (time(`${m.key}-01`) - start) / DAY / days }))
  const seen = new Map<string, number>()
  return (
    <div className={s.strip}>
      <ol className={s.marks}>
        {[...sorted].reverse().map((x) => {
          const stack = seen.get(x.date) ?? 0
          seen.set(x.date, stack + 1)
          const at = ((time(x.date) - start) / DAY + 0.5) / days
          return (
            <li key={x.id} style={{ '--at': at, '--stack': stack } as CSSProperties}>
              <a
                href={`#${x.id}`}
                className={s.mark}
                data-kind={x.kind}
                data-side={at < 0.2 ? 'start' : at > 0.8 ? 'end' : undefined}
                aria-label={`${shortDate(x.date)}: ${x.title}`}
              >
                <span className={s.tip}>
                  <b>{shortDate(x.date)}</b> {x.title}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
      <div className={s.axis} aria-hidden="true">
        {months.map((m) => (
          <span key={m.key} style={{ '--at': m.at } as CSSProperties}>
            <span className={s.monthLong}>{m.label}</span>
            <span className={s.monthShort}>{m.label.slice(0, 3)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Entry({ shift }: { shift: Shift }) {
  const mark = MARK_OF[shift.who]
  return (
    <li id={shift.id} className={s.entry}>
      <time className={s.date} dateTime={shift.date}>
        {shortDate(shift.date)}
      </time>
      <p className={s.who}>
        {mark && <BrandMark brand={mark} size={18} />}
        {shift.who}
      </p>
      <div className={s.body}>
        <p className={s.kind} data-kind={shift.kind}>
          {KIND_WORD[shift.kind]}
        </p>
        <h3 className={s.title}>{shift.title}</h3>
        <p className={s.what}>{shift.what}</p>
      </div>
      <a className={s.source} href={shift.source.url} rel="noopener noreferrer" target="_blank">
        {shift.source.name}
        <span aria-hidden="true"> ↗</span>
      </a>
    </li>
  )
}

export function Shifts() {
  const [kind, setKind] = useState<ShiftKind | null>(null)
  const counts = countByKind(SHIFTS)
  const kinds = Object.values(ShiftKind).filter((k) => counts[k] > 0)
  const months = byMonth(onlyKind(SHIFTS, kind))
  const newest = newestFirst(SHIFTS)[0]

  return (
    <div className={s.page}>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Lit
          kicker={<>Shifts{newest && ` · updated ${shortDate(newest.date)} 2026`}</>}
          title={
            <>
              The ground keeps moving.{' '}
              <b>
                {SHIFTS.length} shifts in {daysCovered(SHIFTS)} days.
              </b>
            </>
          }
          lead="New models, new limits, new owners, new terms: what changed for people who code with agents, since August. Each one is a reason not to tie your work to a single agent."
        />
        <div className={s.wrap}>
          <Strip shifts={SHIFTS} />
        </div>

        <section className={s.list} aria-label="Every shift">
          <div className={s.wrap}>
            <fieldset className={s.filters}>
              <legend className={s.legend}>Show</legend>
              <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>
                All <span>{SHIFTS.length}</span>
              </button>
              {kinds.map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} data-kind={k}>
                  <i className={s.shape} data-kind={k} aria-hidden="true" />
                  {KIND_WORD[k]} <span>{counts[k]}</span>
                </button>
              ))}
            </fieldset>
            {months.map((m) => (
              <section key={m.key} className={s.month} aria-labelledby={`m-${m.key}`}>
                <h2 id={`m-${m.key}`} className={s.monthName}>
                  {m.label}
                  <span>{m.items.length}</span>
                </h2>
                <ol className={s.entries}>
                  {m.items.map((x) => (
                    <Entry key={x.id} shift={x} />
                  ))}
                </ol>
              </section>
            ))}
            <p className={cx(s.note)}>
              We link the reporting; we don’t host it. Missing a shift, or one we got wrong? <a href={LINKS.issues}>Tell us on GitHub</a>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
