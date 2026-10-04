import { useEffect, useRef } from 'react'

import { Agent, agentName } from '../content/agents'
import { INSTALL } from '../content/facts'
import { WHY } from '../content/home'
import { SHIFTS } from '../content/shifts'
import { AgentMark } from '../shared/AgentMark'
import { SHIFTS as SHIFTS_PAGE } from '../shared/Bar'
import { clamp, ease, playback } from '../lib/motion'
import { latest, shortDate } from '../shifts/group'
import s from './Why.module.css'

/*
 * Why more than one agent. The answer to "the best coding agent right now"
 * keeps rolling; three reasons as tiles, each with a small working picture;
 * then the line, and a ticker of what actually changed lately, from the
 * shifts list.
 */

const OPEN = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M8 3.5c-2 0-3 1-3 3v2.5c0 1.5-.8 2.6-2.5 3 1.7.4 2.5 1.5 2.5 3v2.5c0 2 1 3 3 3M16 3.5c2 0 3 1 3 3v2.5c0 1.5.8 2.6 2.5 3-1.7.4-2.5 1.5-2.5 3v2.5c0 2-1 3-3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
)
const NEW = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3.5 3" />
    <path d="M12 7.5v9M7.5 12h9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
)

const iconFor = (a: Agent | 'open' | 'new') => (a === 'open' ? OPEN : a === 'new' ? NEW : <AgentMark agent={a} />)

/** The answer keeps changing: rolls through the names, and round again. */
function Reel() {
  const reel = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = reel.current?.firstElementChild as HTMLElement | null | undefined
    if (!el) return
    const n = WHY.answers.length
    const step = 1.8
    return playback({
      total: step * n,
      idle: true,
      watch: reel.current,
      draw: (t) => {
        const p = t / step
        const k = ease(clamp((p - Math.floor(p) - 0.72) / 0.28))
        el.style.transform = `translateY(${-((Math.floor(p) % n) + k) * 1.25}em)`
      },
    })
  }, [])
  const items = [...WHY.answers, WHY.answers[0]]
  return (
    <span ref={reel} className={s.reel} aria-hidden="true">
      <span>
        {items.map((a, i) => (
          <span key={i}>
            {iconFor(a.agent)}
            {a.word}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Tile A: Claude Code leads until its limit, then Codex leads, on the same branch. */
function Swap() {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    const [first, second] = el ? Array.from(el.children) : []
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) return
    return playback({
      total: 6,
      idle: true,
      watch: el,
      draw: (t) => {
        const moved = t % 6 >= 2.6
        first.dataset.state = moved ? 'gone' : 'on'
        second.dataset.state = moved ? 'on' : 'off'
      },
    })
  }, [])
  const row = (agent: Agent, lead: string, off: string, state: string) => (
    <p className={s.vrow} data-state={state}>
      <AgentMark agent={agent} size={16} />
      {agentName(agent)}
      <span className={s.r} data-when="on">
        {lead}
      </span>
      <span className={s.r} data-when="off">
        {off}
      </span>
    </p>
  )
  return (
    <div ref={box} className={s.swap}>
      {row(Agent.Claude, 'Lead · implement', 'Limit reached', 'on')}
      {row(Agent.Codex, 'Lead · same branch', 'Ready', 'off')}
    </div>
  )
}

const PLAN_USE = [
  [Agent.Claude, 0.62, 1],
  [Agent.Codex, 0.28, 0.5],
] as const

/** Tile B: two plans filling at their own rates; a full one waits for its reset. */
function Plans() {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    return playback({
      total: 6,
      idle: true,
      watch: el,
      draw: (t) => {
        const k = clamp((t % 6) / 4)
        PLAN_USE.forEach(([agent, a, b]) => {
          const row = el.querySelector<HTMLElement>(`[data-plan="${agent}"]`)
          if (!row) return
          const u = a + (b - a) * k
          row.toggleAttribute('data-full', u >= 1)
          const fill = row.querySelector<HTMLElement>('b')
          const pct = row.querySelector<HTMLElement>('[data-pct]')
          if (fill) fill.style.width = `${(u * 100).toFixed(0)}%`
          if (pct) pct.textContent = u >= 1 ? 'Resets 15:00' : `${Math.round(u * 100)}%`
        })
      },
    })
  }, [])
  return (
    <div ref={box}>
      {PLAN_USE.map(([agent]) => (
        <p key={agent} className={s.vrow} data-plan={agent}>
          <AgentMark agent={agent} size={16} />
          <span className={s.pname}>{agentName(agent)}</span>
          <span className={s.vbar}>
            <b />
          </span>
          <span className={s.r} data-pct />
        </p>
      ))}
    </div>
  )
}

/** What changed lately, from the shifts list, round and round. */
function Ticker() {
  const items = latest(SHIFTS, 8)
  const run = (copy: number) =>
    items.map((x) => (
      <a key={`${copy}-${x.id}`} href={`${SHIFTS_PAGE}#${x.id}`} tabIndex={copy === 0 ? 0 : -1}>
        <b>{shortDate(x.date)}</b>
        {x.title}
      </a>
    ))
  return (
    <div className={s.ticker}>
      <div className={s.track}>
        <span>{run(0)}</span>
        <span aria-hidden="true">{run(1)}</span>
      </div>
    </div>
  )
}

export function Why() {
  const [a, b, c] = WHY.reasons
  return (
    <section id="why" className={s.why} aria-labelledby="why-h">
      <div className={s.wrap}>
        <p className={s.no}>
          <b>{WHY.no}</b>
          {WHY.label}
        </p>
        <h2 id="why-h" className={s.mega}>
          <span className={s.dim}>{WHY.ask[0]}</span>
          <span className={s.dim}>{WHY.ask[1]} </span>
          <span className={s.hidden}>whichever one is ahead this month. It keeps changing.</span>
          <Reel />
        </h2>
        <p className={s.lead}>{WHY.lead}</p>
        <div className={s.tiles}>
          <article className={s.tile}>
            <span className={s.key}>{a?.key}</span>
            <h3>{a?.title}</h3>
            <p>{a?.body}</p>
            <div className={s.vis}>
              <Swap />
            </div>
          </article>
          <article className={s.tile}>
            <span className={s.key}>{b?.key}</span>
            <h3>{b?.title}</h3>
            <p>{b?.body}</p>
            <div className={s.vis}>
              <Plans />
            </div>
          </article>
          <article className={s.tile}>
            <span className={s.key}>{c?.key}</span>
            <h3>{c?.title}</h3>
            <p>{c?.body}</p>
            <div className={s.vis}>
              <pre className={s.code}>
                <span aria-hidden="true">$ </span>
                {INSTALL.clone}
              </pre>
            </div>
          </article>
        </div>
        <p className={s.close}>
          <span className={s.dim}>{WHY.close[0]}</span>
          <span>{WHY.close[1]}</span>
        </p>
        <a className={s.more} href={SHIFTS_PAGE}>
          {WHY.shifts} <span aria-hidden="true">→</span>
        </a>
      </div>
      <Ticker />
    </section>
  )
}
