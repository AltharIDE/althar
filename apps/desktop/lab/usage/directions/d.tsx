import { type ReactNode, useMemo } from 'react'

import { Icon } from '@althar/ui'

import { Legend, PartsBar, Spark, TipLines, useTip } from '../charts.tsx'
import { DAY, NOW, type Outcome, PRESETS_MANY, type Preset, TASKS } from '../facts.ts'
import { calendarOf, dailyOf, ENDINGS, endingsOf, movesOf, periodOf, type Score, scoreOf, timeSplitOf } from '../measures.ts'
import type { DirectionProps } from '../page.tsx'
import { date, dayName, duration, money, moneyWhole, percent, plural, span } from '../words.ts'
import sh from '../shared.module.css'
import s from './d.module.css'

/*
 * D · Compare. How this stretch went against the one before it, the same
 * length: a scoreboard of what finished, how fast and how clean, and what it
 * cost, each with its days drawn over the period before's; where the time to
 * merge goes (agents at work, checks, waiting on you: violet, as everywhere
 * it means you); how the tasks ended; what moved most; and every day of the
 * half year, so a period sits among the rest.
 */

type Better = 'up' | 'down' | null

interface Metric {
  readonly key: keyof Score
  readonly label: string
  readonly say: (v: number | null) => string
  readonly better: Better
}

const METRICS: ReadonlyArray<Metric> = [
  { key: 'finished', label: 'Finished', say: (v) => (v === null ? '—' : v.toLocaleString('en-GB')), better: null },
  { key: 'merged', label: 'Changes merged', say: (v) => (v === null ? '—' : v.toLocaleString('en-GB')), better: 'up' },
  { key: 'toMerge', label: 'Time to merge', say: (v) => duration(v), better: 'down' },
  { key: 'clean', label: 'Clean first review', say: (v) => percent(v), better: 'up' },
  { key: 'findings', label: 'Findings per change', say: (v) => (v === null ? '—' : v.toFixed(1)), better: 'down' },
  { key: 'abandoned', label: 'Abandoned', say: (v) => (v === null ? '—' : String(v)), better: 'down' },
  { key: 'perChange', label: 'Per merged change', say: (v) => (v === null ? '—' : money(v)), better: 'down' },
  { key: 'spent', label: 'At API prices', say: (v) => (v === null ? '—' : moneyWhole(v)), better: null },
]

const ENDING_WORDS: Readonly<Record<Exclude<Outcome, 'open'>, string>> = {
  merged: 'Merged',
  branch: 'On its branch',
  answered: 'Answered',
  reviewed: 'Review posted',
  abandoned: 'Abandoned',
}

const SPLIT = [
  { key: 'worked', label: 'Agents at work', color: 'color-mix(in srgb, var(--live) 62%, var(--n-2))' },
  { key: 'checking', label: 'Checks', color: 'var(--t-4)' },
  { key: 'waited', label: 'Waiting on you', color: 'color-mix(in srgb, var(--signal) 70%, var(--n-2))' },
] as const

function Delta({ now, before, better }: { now: number | null; before: number | null; better: Better }) {
  if (now === null || before === null || before === 0) return null
  const change = (now - before) / Math.abs(before)
  if (Math.abs(change) < 0.005) return <span className={s.delta}>Same</span>
  const up = change > 0
  const tone = better === null ? 'neutral' : (better === 'up') === up ? 'better' : 'worse'
  return (
    <span className={s.delta} data-tone={tone}>
      <Icon name={up ? 'up' : 'down'} size={11} />
      {Math.abs(Math.round(change * 100))}%
    </span>
  )
}

const FIRST = Math.min(...TASKS.map((task) => task.endedAt ?? NOW))

export function Compare({ range, scope }: DirectionProps) {
  const tip = useTip()
  const now = useMemo(() => periodOf(range), [range])
  const before = useMemo(() => periodOf(range, 1), [range])
  const hasBefore = before.to > FIRST
  const a = useMemo(() => scoreOf(now, scope), [now, scope])
  const b = useMemo(() => scoreOf(before, scope), [before, scope])
  const daysA = useMemo(() => dailyOf(now, scope), [now, scope])
  const daysB = useMemo(() => dailyOf(before, scope), [before, scope])
  const splitA = useMemo(() => timeSplitOf(now, scope), [now, scope])
  const splitB = useMemo(() => timeSplitOf(before, scope), [before, scope])
  const endA = useMemo(() => endingsOf(now, scope), [now, scope])
  const endB = useMemo(() => endingsOf(before, scope), [before, scope])
  const moves = useMemo(() => movesOf(now, before, scope), [now, before, scope])
  const calendar = useMemo(() => calendarOf(scope), [scope])

  const splitTop = Math.max(splitA.worked + splitA.checking + splitA.waited, splitB.worked + splitB.checking + splitB.waited)
  const waitShare = splitA.waited / Math.max(1, splitA.worked + splitA.checking + splitA.waited)
  const endTop = Math.max(1, ...ENDINGS.map((one) => Math.max(endA[one], endB[one])))
  const calTop = Math.max(1, ...calendar.map((day) => day.finished))
  const count = calendar.length / 7
  const weeks = Array.from({ length: count }, (_, w) => calendar.slice(w * 7, w * 7 + 7))
  const colOf = (at: number) => Math.floor((at - calendar[0]!.at) / (7 * DAY))
  /** Where a period starts and ends along the weeks, in columns of 18px. */
  const spanOf = (period: { from: number; to: number }) => ({
    left: Math.max(0, colOf(period.from)) * 18,
    width: (Math.min(count - 1, colOf(period.to - 1)) - Math.max(0, colOf(period.from)) + 1) * 18 - 3,
  })

  const nameOf = (move: (typeof moves)[number]) => (move.kind === 'preset' ? PRESETS_MANY[move.what as Preset] : `Led by ${move.what}`)

  const splitRow = (label: string, split: typeof splitA): ReactNode => (
    <div className={s.splitRow}>
      <span className={s.splitLabel}>{label}</span>
      <div className={s.splitBar}>
        <PartsBar
          height={10}
          total={splitTop}
          parts={SPLIT.map((part) => ({
            key: part.key,
            value: split[part.key],
            color: part.color,
            tip: <TipLines title={part.label} lines={[`${duration(split[part.key])} on average`]} />,
          }))}
        />
      </div>
      <span className={sh.num}>{duration(split.worked + split.checking + split.waited)}</span>
    </div>
  )

  return (
    <>
      <section className={sh.section}>
        <p className={s.versus}>
          <span className={s.now}>{span(now.from, now.to)}</span>
          <span className={sh.quiet}> against </span>
          <span className={s.before}>{hasBefore ? span(before.from, before.to) : 'nothing before it'}</span>
          {!hasBefore && <span className={sh.quiet}> · the first task finished {date(FIRST)}</span>}
        </p>
        <div className={s.board}>
          {METRICS.map((metric) => {
            const va = a[metric.key]
            const vb = hasBefore ? b[metric.key] : null
            return (
              <div key={metric.key} className={s.tile}>
                <div className={sh.figLabel}>{metric.label}</div>
                <div className={s.tileValue}>
                  <span className={sh.figValue}>{metric.say(va)}</span>
                  <Delta now={va} before={vb} better={metric.better} />
                </div>
                <div className={sh.figNote}>{hasBefore ? `was ${metric.say(vb)}` : 'Nothing to compare'}</div>
                <div className={s.spark}>
                  <Spark
                    now={daysA.map((day) => day[metric.key])}
                    before={hasBefore ? daysB.map((day) => day[metric.key]) : []}
                    tip={(i) => (
                      <TipLines
                        title={date(now.from + i * DAY)}
                        lines={[
                          `${metric.say(daysA[i]?.[metric.key] ?? null)}`,
                          ...(hasBefore ? [`${date(before.from + i * DAY)}: ${metric.say(daysB[i]?.[metric.key] ?? null)}`] : []),
                        ]}
                      />
                    )}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className={s.sparkLegend}>
          <Legend
            items={[
              { label: 'These days', color: 'var(--t-1)', shape: 'line' },
              { label: 'The days before', shape: 'dash' },
            ]}
          />
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Where the time to merge goes</h2>
          <Legend items={SPLIT.map((part) => ({ label: part.label, color: part.color }))} />
        </div>
        {splitA.count > 0 && (
          <p className={sh.sub} style={{ marginTop: -6 }}>
            Of a change’s time to merge, {percent(waitShare)} is waiting on you, on average.
          </p>
        )}
        <div className={s.split}>
          {splitRow('These days', splitA)}
          {hasBefore && splitRow('The days before', splitB)}
        </div>
      </section>

      <div className={s.pair}>
        <section className={sh.section}>
          <div className={sh.sectionHead}>
            <h2 className={sh.h2}>How tasks ended</h2>
          </div>
          <div className={s.endings}>
            {ENDINGS.map((one) => (
              <div key={one} className={s.ending}>
                <span className={s.endingLabel}>{ENDING_WORDS[one]}</span>
                <div className={s.endingBars}>
                  <span className={s.barNow} style={{ width: `${(endA[one] / endTop) * 100}%` }} />
                  {hasBefore && <span className={s.barBefore} style={{ width: `${(endB[one] / endTop) * 100}%` }} />}
                </div>
                <span className={sh.num}>
                  {endA[one]}
                  {hasBefore && <span className={sh.quiet}> · {endB[one]}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={sh.section}>
          <div className={sh.sectionHead}>
            <h2 className={sh.h2}>What moved most</h2>
            <span className={sh.quiet} style={{ fontSize: 12 }}>
              Share of the tasks
            </span>
          </div>
          {!hasBefore || moves.length === 0 ? (
            <p className={sh.empty}>Nothing before these days to compare with.</p>
          ) : (
            <ul className={s.moves}>
              {moves.map((move) => (
                <li key={move.what}>
                  <span className={s.moveWhat}>{nameOf(move)}</span>
                  <span className={sh.num}>
                    <span className={sh.quiet}>{percent(move.before)} →</span> {percent(move.now)}
                  </span>
                  <span className={s.moveDelta} data-up={move.now > move.before || undefined}>
                    {move.now > move.before ? '+' : '−'}
                    {Math.abs(Math.round((move.now - move.before) * 100))} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Every day</h2>
          <span className={sh.quiet} style={{ fontSize: 12 }}>
            Tasks finished
          </span>
        </div>
        <div className={s.everyDay}>
          <div className={s.calendar} style={{ ['--weeks' as string]: count }}>
            <div className={s.calDays}>
              {['Mon', '', 'Wed', '', 'Fri', '', ''].map((name, i) => (
                <span key={i}>{name}</span>
              ))}
            </div>
            <div className={s.calGrid}>
              {weeks.map((week, w) => (
                <div key={w} className={s.calWeek}>
                  <span className={s.calMonth}>{new Date(week[0]!.at).getUTCDate() <= 7 ? date(week[0]!.at).split(' ')[1] : ''}</span>
                  {week.map((day) => (
                    <span
                      key={day.at}
                      className={s.calDay}
                      data-future={day.future || undefined}
                      data-in={(day.at >= now.from - DAY && day.at < now.to) || undefined}
                      style={{
                        ['--heat' as string]: day.finished === 0 ? '0%' : `${Math.round(18 + Math.sqrt(day.finished / calTop) * 82)}%`,
                      }}
                      {...(day.future
                        ? {}
                        : tip(
                            <TipLines title={date(day.at)} lines={[`${plural(day.finished, 'task')} finished`, `${day.merged} merged`]} />,
                          ))}
                    />
                  ))}
                </div>
              ))}
              <span className={s.calSpan} data-now style={spanOf(now)}>
                These days
              </span>
              {hasBefore && colOf(before.to - 1) >= 0 && (
                <span className={s.calSpan} style={spanOf(before)}>
                  Before
                </span>
              )}
            </div>
          </div>
          <div className={s.busiest}>
            <div className={s.busiestHead}>Busiest days</div>
            <ol>
              {[...calendar]
                .filter((day) => !day.future)
                .sort((x, y) => y.finished - x.finished)
                .slice(0, 5)
                .map((day) => (
                  <li key={day.at}>
                    <span>
                      {dayName(day.at)} {date(day.at)}
                    </span>
                    <span className={sh.num}>
                      {day.finished} <span className={sh.quiet}>· {day.merged} merged</span>
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  )
}
