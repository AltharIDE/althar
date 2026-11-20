import { useMemo } from 'react'

import { BrandMark, Icon } from '@althar/ui'

import { Legend, PartsBar, Swatch, TipLines, useTip } from '../charts.tsx'
import { AGENTS, type AgentId, DAY, NOW, PRESETS_MANY, type Preset } from '../facts.ts'
import { type PlanWeek, periodOf, spentIn, thisWeek, tokensIn, weeksIn } from '../measures.ts'
import type { DirectionProps } from '../page.tsx'
import { agentBrand, agentInk, date, dayName, duration, inkVar, money, moneyWhole, plural, points, tokens, when } from '../words.ts'
import sh from '../shared.module.css'
import s from './c.module.css'

/*
 * C · Plans. Usage against the limits the person actually pays for, rather
 * than dollars nobody paid: each plan's week as it fills, beside an even pace,
 * with where this pace ends it (and when it would run out); what drew on it,
 * by task, the coordinator and use outside Althar apart; the weeks before,
 * and the ones that ran out; and what the plans carried at API prices, the
 * one place dollars are said, with the tokens behind them.
 */

const AGENT_IDS: ReadonlyArray<AgentId> = ['claude-code', 'codex']

/** A week from reset to reset: used, an even pace, now, and on to the reset at this pace. */
function WeekChart({ week }: { week: PlanWeek }) {
  const tip = useTip()
  const span = week.to - week.from
  const x = (at: number) => ((at - week.from) / span) * 100
  const y = (used: number) => 100 - Math.min(100, used)
  const line = week.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(2)},${y(p.used).toFixed(2)}`).join('')
  const last = week.points.at(-1)!
  const area = `${line}L${x(last.at).toFixed(2)},100L0,100Z`
  const ink = inkVar(agentInk(week.agent))
  const forecastEnd =
    week.forecast === null
      ? null
      : week.forecast.outAt !== null
        ? { at: week.forecast.outAt, used: 100 }
        : { at: week.to, used: week.forecast.ends }
  const days = Array.from({ length: 7 }, (_, i) => week.from + i * DAY)
  const usedAt = (at: number) => week.points.findLast((p) => p.at <= at)?.used ?? 0
  return (
    <div className={s.chart}>
      <svg className={s.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[25, 50, 75].map((v) => (
          <line key={v} x1="0" x2="100" y1={y(v)} y2={y(v)} className={s.grid} vectorEffect="non-scaling-stroke" />
        ))}
        {days.slice(1).map((at) => (
          <line key={at} x1={x(at)} x2={x(at)} y1="0" y2="100" className={s.dayLine} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="0" x2="100" y1="0" y2="0" className={s.limit} vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="100" x2="100" y2="0" className={s.pace} vectorEffect="non-scaling-stroke" />
        <path d={area} style={{ fill: ink }} className={s.area} />
        <path d={line} style={{ stroke: ink }} className={s.used} vectorEffect="non-scaling-stroke" />
        {forecastEnd !== null && (
          <path
            d={`M${x(last.at)},${y(last.used)}L${x(forecastEnd.at)},${y(forecastEnd.used)}${week.forecast?.outAt != null ? `L100,0` : ''}`}
            style={{ stroke: ink }}
            className={s.forecast}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {week.now !== null && <line x1={x(NOW)} x2={x(NOW)} y1="0" y2="100" className={s.now} vectorEffect="non-scaling-stroke" />}
        {/* What the pointer rests on, a slice of an hour at a time. */}
        {Array.from({ length: 7 * 6 }, (_, i) => {
          const from = week.from + (i * span) / 42
          const to = from + span / 42
          if (from > NOW) return null
          const at = Math.min(to, NOW)
          return (
            <rect
              key={i}
              x={x(from)}
              y="0"
              width={100 / 42}
              height="100"
              className={s.hit}
              {...tip(
                <TipLines
                  title={`${dayName(at)} ${date(at)}, by ${when(at).split(' ').at(-1)}`}
                  lines={[`${points(usedAt(at))} of the week used`, `Even pace: ${points(((at - week.from) / span) * 100)}`]}
                />,
              )}
            />
          )
        })}
      </svg>
      <span className={s.limitLabel}>Limit</span>
      {week.now !== null && <span className={s.dot} style={{ left: `${x(NOW)}%`, top: `${y(last.used)}%`, background: ink }} />}
      {week.outAt !== null && (
        <span className={s.out} style={{ left: `${x(week.outAt)}%` }}>
          Ran out {when(week.outAt)}
        </span>
      )}
      <div className={s.days}>
        {days.map((at) => (
          <span key={at} style={{ left: `${x(at + DAY / 2)}%` }} data-today={(NOW >= at && NOW < at + DAY) || undefined}>
            {dayName(at)}
          </span>
        ))}
      </div>
    </div>
  )
}

const TOP = 3
const KINDS: ReadonlyArray<Preset> = ['change', 'small', 'prototype', 'review', 'chat']
/** Each kind of work in the plan's own ink, lighter as it goes, so the parts read as one plan's. */
const KIND_MIX: Readonly<Record<Preset, number>> = { change: 100, small: 72, prototype: 50, review: 34, chat: 22 }

function PlanCard({ agent }: { agent: AgentId }) {
  const week = useMemo(() => thisWeek(agent), [agent])
  const ink = inkVar(agentInk(agent))
  const top = week.tasks.slice(0, TOP)
  const forecast = week.forecast
  const kinds = KINDS.map((preset) => ({
    preset,
    points: week.tasks.filter((one) => one.task.preset === preset).reduce((sum, one) => sum + one.points, 0),
    color: `color-mix(in srgb, ${ink} ${KIND_MIX[preset]}%, var(--n-1))`,
  })).filter((kind) => kind.points >= 0.2)
  const parts = [
    ...kinds.map((kind) => ({ key: kind.preset, label: PRESETS_MANY[kind.preset], value: kind.points, color: kind.color })),
    { key: 'coordinator', label: 'Coordinator', value: week.coordinator, color: 'var(--t-3)' },
    { key: 'outside', label: 'Outside Althar', value: week.outside, color: 'var(--line-3)' },
  ].filter((part) => part.value >= 0.2)
  return (
    <article className={s.card}>
      <header className={s.cardHead}>
        <div className={s.plan}>
          <BrandMark brand={agentBrand(agent)} size={16} />
          <span className={s.planName}>{AGENTS[agent].plan}</span>
        </div>
        <div className={s.used}>
          <span className={s.usedValue}>{points(week.used)}</span>
          <span className={sh.quiet}> used</span>
        </div>
      </header>
      <div className={s.cardLine}>
        <span>
          Resets {when(week.to)} · in {duration(week.to - NOW)}
        </span>
        {forecast !== null &&
          (forecast.outAt !== null ? (
            <span className={s.warn}>
              <Icon name="problem" size={12} /> At this pace, out {when(forecast.outAt)}, {duration(week.to - forecast.outAt)} before it
              resets
            </span>
          ) : (
            <span>At this pace, ends near {points(forecast.ends)}</span>
          ))}
      </div>
      <WeekChart week={week} />
      <div className={s.drew}>
        <div className={s.drewHead}>What used it</div>
        <PartsBar
          height={8}
          total={week.used}
          parts={parts.map((part) => ({ ...part, tip: <TipLines title={part.label} lines={[`~${points(part.value)} of the week`]} /> }))}
        />
        <ul className={s.kinds}>
          {parts.map((part) => (
            <li key={part.key}>
              <Swatch color={part.color} />
              <span>{part.label}</span>
              <span className={sh.num}>{points(part.value)}</span>
            </li>
          ))}
        </ul>
        <div className={s.drewHead} style={{ marginTop: 14 }}>
          Costliest tasks
        </div>
        <ol className={s.top}>
          {top.map((one) => (
            <li key={one.task.id}>
              <span className={s.topTitle} title={one.task.title}>
                {one.task.title}
              </span>
              <span className={sh.num}>~{points(one.points)}</span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  )
}

function PastWeeks({ agent, range }: { agent: AgentId; range: DirectionProps['range'] }) {
  const tip = useTip()
  const weeks = useMemo(() => weeksIn(agent, periodOf(range)), [agent, range])
  const ink = inkVar(agentInk(agent))
  const out = weeks.filter((week) => week.outAt !== null)
  return (
    <div className={s.past}>
      <div className={s.pastHead}>
        <BrandMark brand={agentBrand(agent)} size={13} />
        <span className={s.pastName}>{AGENTS[agent].plan}</span>
        <span className={sh.quiet}>
          {out.length === 0 ? 'Never ran out' : `Ran out in ${out.length} of ${plural(weeks.length, 'week')}`}
        </span>
      </div>
      <div className={s.weeks}>
        {weeks.map((week) => (
          <div
            key={week.from}
            className={s.week}
            data-now={week.now !== null || undefined}
            {...tip(
              <TipLines
                title={`Week of ${date(week.from)}${week.now !== null ? ', so far' : ''}`}
                lines={[
                  `${points(week.used)} used`,
                  ...(week.outAt === null
                    ? []
                    : [
                        `Ran out ${when(week.outAt)}, ${duration(week.to - week.outAt)} before it reset`,
                        `${plural(week.moved, 'task')} moved to another agent`,
                      ]),
                ]}
              />,
            )}
          >
            <div className={s.weekBar}>
              <span
                className={s.weekFill}
                style={{ height: `${week.used}%`, background: ink }}
                data-out={week.outAt !== null || undefined}
              />
            </div>
            <span className={s.weekLabel}>{week.outAt !== null ? <strong>{dayName(week.outAt)}</strong> : date(week.from)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Plans({ range, scope }: DirectionProps) {
  const period = useMemo(() => periodOf(range), [range])
  const spent = useMemo(() => spentIn(period, scope), [period, scope])
  const used = useMemo(() => tokensIn(period, scope), [period, scope])
  const months = range / 30
  return (
    <>
      <section className={sh.section}>
        <div className={s.cards}>
          {AGENT_IDS.map((agent) => (
            <PlanCard key={agent} agent={agent} />
          ))}
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>The weeks before</h2>
          <Legend items={[{ label: 'Ran out: the day it did', color: 'var(--danger)' }]} />
        </div>
        <div className={s.pasts}>
          {AGENT_IDS.map((agent) => (
            <PastWeeks key={agent} agent={agent} range={range} />
          ))}
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>What your plans carried</h2>
          <span className={sh.quiet} style={{ fontSize: 12 }}>
            {range} days{scope === 'all' ? '' : `, ${scope}`}, at API prices
          </span>
        </div>
        <div className={s.carried}>
          {AGENT_IDS.map((agent) => {
            const paid = AGENTS[agent].price * months
            return (
              <div key={agent} className={s.carry}>
                <BrandMark brand={agentBrand(agent)} size={16} />
                <span className={s.carryName}>{AGENTS[agent].plan}</span>
                <span className={s.carryPaid}>
                  {moneyWhole(paid)} <span className={sh.quiet}>for {range === 30 ? 'the month' : `${range} days`}</span>
                </span>
                <span className={s.carryWorth}>{money(spent[agent])}</span>
                <span className={s.carryTimes}>{spent[agent] > 0 ? `${Math.round(spent[agent] / paid)}×` : '—'}</span>
              </div>
            )
          })}
        </div>
        <div className={sh.figures} style={{ ['--count' as string]: 5, marginTop: 20 }}>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Read from the cache</div>
            <div className={sh.figValue}>{tokens(used.tokens.cached)}</div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Not from the cache</div>
            <div className={sh.figValue}>{tokens(used.tokens.uncached)}</div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Written to the cache</div>
            <div className={sh.figValue}>{tokens(used.tokens.written)}</div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Output</div>
            <div className={sh.figValue}>{tokens(used.tokens.output)}</div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>The cache saved</div>
            <div className={sh.figValue}>{moneyWhole(used.saved)}</div>
          </div>
        </div>
      </section>
    </>
  )
}
