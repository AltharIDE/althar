import { cx } from '../../../lib/cx'
import { vars } from '../../../lib/vars'
import { LAB_NAME, Mark } from '../Mark'
import { frontierReached, LEADERS, labsSince, OPEN, openIn, reigns, YEARS, yearStats } from '../model/frontier'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Models.module.css'

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'] as const

const MONTHS = ['Jan', 'Apr', 'Jul', 'Oct'] as const
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 2025-11-24 → 24 Nov 2025 */
export const day = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `${d} ${MON[m - 1]!.slice(0, 3)} ${y}`
}

/** 2026-06-09 → June */
const month = (iso: string): string => MON[Number(iso.slice(5, 7)) - 1]!

/** The part of 2026 still to come, as a fraction of the year. */
const LEFT = 1 - reigns(2026).at(-1)!.to

/** One panel step per year, then the open models. */
const STEPS = YEARS.length + 1

const TOP = LEADERS.at(-1)!
const BEST_OPEN = OPEN.reduce((a, b) => (b.score > a.score ? b : a))
const OPEN_LABS = new Set(OPEN.filter((o) => o.on >= '2026').map((o) => o.maker)).size

/** Places release dots on lanes, nudging a dot right only when every lane is taken near its date. */
export function place(ats: readonly number[], gap = 0.022, lanes = 2): { x: number; lane: number }[] {
  const last: number[] = Array.from({ length: lanes }, () => -1)
  return ats.map((at) => {
    const xs = last.map((l) => Math.max(at, l + gap))
    const lane = xs.indexOf(Math.min(...xs))
    last[lane] = xs[lane]!
    return { x: xs[lane]!, lane }
  })
}

/** A caption over a tile on hover, since the narrow ones have no room for a name. */
function Tip({ name, by, on, score, at }: { name: string; by: string; on: string; score: number; at: number }) {
  return (
    <span className={cx(s.tip, at < 0.12 && s.tipL, at > 0.88 && s.tipR)}>
      <b>{name}</b> {by} · {day(on)} · <em>{score.toFixed(1)}</em>
    </span>
  )
}

/** One year: who held the top and for how long, and the open models close behind. */
export function Year({ year, state }: { year: number; state: 'seen' | 'now' | 'next' }) {
  const { leaders, gain } = yearStats(year)
  const open = openIn(year)
  const spot = place(open.map((o) => o.at))
  /* a phone's track is a third as wide, so its dots get a wider gap and a third lane */
  const tight = place(
    open.map((o) => o.at),
    0.06,
    3,
  )
  const last = year === YEARS.at(-1)
  return (
    <li className={cx(s.year, s[state])}>
      <span className={s.y}>{year}</span>
      <div className={s.lanes}>
        <div className={s.track}>
          {reigns(year).map((r) => (
            <span
              key={r.name}
              className={cx(s.reign, !r.fresh && s.carried, r.now && s.top)}
              style={vars({ '--from': r.from, '--to': r.to })}
            >
              <span className={s.face}>
                <Mark lab={r.lab} />
                <span className={s.nm}>{r.name}</span>
              </span>
              <Tip name={r.name} by={LAB_NAME[r.lab]} on={r.on} score={r.score} at={(r.from + r.to) / 2} />
            </span>
          ))}
          {last && <span className={s.rest} style={vars({ '--from': 1 - LEFT })} />}
        </div>
        <div
          className={s.oss}
          style={vars({ '--rows': Math.max(0, ...spot.map((d) => d.lane)) + 1, '--rows-s': Math.max(0, ...tight.map((d) => d.lane)) + 1 })}
        >
          {open.map((o, j) => (
            <span
              key={o.name}
              className={s.dot}
              style={vars({ '--at': spot[j]!.x, '--lane': spot[j]!.lane, '--at-s': tight[j]!.x, '--lane-s': tight[j]!.lane })}
            >
              <Mark lab={o.lab} />
              <Tip name={o.name} by={o.maker} on={o.on} score={o.score} at={o.at} />
            </span>
          ))}
        </div>
      </div>
      <div className={s.stat}>
        <p>
          <b>{leaders}</b> new #1 {leaders === 1 ? 'model' : 'models'}
          <span>
            top score +{gain}
            {last && ', so far'}
          </span>
        </p>
        <p className={s.ossStat}>
          <b>{open.length}</b> open, close behind
        </p>
      </div>
    </li>
  )
}

export function Models() {
  const labs = labsSince(2024).length
  return (
    <Pin id="models" tone="light" name="Model churn" className={s.models} steps={STEPS}>
      {(k) => (
        <div className={cx(ui.wrap, s.grid)} data-step={k}>
          <p className={cx(ui.kicker, s.kicker)}>
            Why now ·{' '}
            <span className={s.kicks}>
              <span className={s.kickA}>The frontier</span>
              <span className={s.kickB} aria-hidden="true">
                Open weights
              </span>
            </span>
          </p>
          <div className={s.heads}>
            <div className={cx(s.head, s.headA)}>
              <h2>The best model now changes every few weeks.</h2>
              <p className={cx(ui.body, s.body)}>
                Each bar is the model at the top of the Artificial Analysis Intelligence Index, from its release until a better one shipped.
                The lead changed twice in 2023 and eleven times in 2025. {WORDS[labs]} labs have held it since 2024.
              </p>
            </div>
            <div className={cx(s.head, s.headB)}>
              <h2>And one you can run yourself ships every two weeks.</h2>
              <p className={cx(ui.body, s.body)}>
                Each dot is an open-weights model at least as good as the top model of six months before: one a year until 2025, then eight,
                then {openIn(2026).length} so far this year from {WORDS[OPEN_LABS]?.toLowerCase()} labs. The best, {BEST_OPEN.name}, matches
                the frontier of {month(frontierReached(BEST_OPEN.score)!)}.
              </p>
            </div>
          </div>
          <figure
            className={s.fig}
            aria-label="The top model on the Artificial Analysis Intelligence Index, year by year, with the open models close behind"
          >
            <ol className={s.years}>
              {YEARS.map((y, j) => (
                <Year key={y} year={y} state={j < k ? 'seen' : j === k ? 'now' : 'next'} />
              ))}
            </ol>
            <div className={s.axis} aria-hidden="true">
              {MONTHS.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </figure>
          <p className={s.pull}>
            A tool tied to one lab is a bet that the lab stays on top.{' '}
            <b>Althar routes each step to whichever model is best at it now, open models included,</b> and the project keeps its memory when
            the lead changes hands.
          </p>
          <p className={s.src}>
            Source: Artificial Analysis Intelligence Index v4.3.2, read 25 September 2026. Most scores before 2026 are their estimates on
            the current index. Top today: {TOP.name}, {TOP.score}.
          </p>
        </div>
      )}
    </Pin>
  )
}
