import { useEffect, useRef } from 'react'

import { Agent, agentName } from '../content/agents'
import { COORDINATOR } from '../content/home'
import { AgentMark } from '../shared/AgentMark'
import { playback } from '../lib/motion'
import s from './Coordinator.module.css'

/*
 * The coordinator. You ask for two things; it answers with what applies to
 * the project and the plan for the first task: who does each step, and why.
 * Leaving it alone is a yes, so the plan counts down and starts on its own.
 *
 * Drawn for the page, not the app's own launch card: it has no buttons,
 * pickers or menus, since nothing here can be pressed.
 */

interface Step {
  label: string
  who: readonly Agent[]
  why: string
  /** Why it can't be dropped: it leads, or a rule asks for it. */
  tag?: string
}

const PLAN: readonly Step[] = [
  { label: 'Implement', who: [Agent.Claude], why: 'Recommended for money code', tag: 'The lead' },
  { label: 'Review', who: [Agent.Codex, Agent.OpenCode], why: 'Two models, findings combined' },
  { label: 'Security review', who: [Agent.Codex], why: 'Your rule for money handling', tag: 'Your rule' },
  { label: 'Verify', who: [Agent.OpenCode], why: 'The full suite' },
]

/** Seconds the plan waits before it starts on its own. */
const WAIT = 20

function Who({ who }: { who: readonly Agent[] }) {
  return (
    <span className={s.who}>
      {who.map((a, i) => (
        <span key={a} className={s.ag}>
          {i > 0 && <em aria-hidden="true">+</em>}
          <AgentMark agent={a} size={14} />
          {agentName(a)}
        </span>
      ))}
    </span>
  )
}

export function Coordinator() {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const left = el.querySelector<HTMLElement>('[data-left]')
    const next = el.querySelector<HTMLElement>('[data-next]')
    const draw = (t: number) => {
      const started = t >= WAIT
      el.toggleAttribute('data-started', started)
      el.style.setProperty('--wait', String(Math.min(t / WAIT, 1)))
      if (left) left.textContent = started ? 'Started · Claude Code is implementing' : `Starts on its own in ${Math.ceil(WAIT - t)}s`
      if (next) next.textContent = started ? 'Running' : 'Starts with 431'
    }
    return playback({ total: WAIT, draw, watch: el })
  }, [])

  return (
    <div ref={box} className={s.chat}>
      <p className={s.you}>{COORDINATOR.ask}</p>
      <div className={s.said}>
        <p className={s.me}>
          <i className={s.sq} aria-hidden="true" />
          Coordinator <span>just now</span>
        </p>
        <p>{COORDINATOR.reply}</p>
      </div>

      <div className={s.plan}>
        <p className={s.title}>
          <span className={s.n}>431</span>
          <b>Rate-limit refunds like charges</b>
          <span className={s.project}>billing-api</span>
        </p>
        <ol className={s.steps}>
          {PLAN.map((st, i) => (
            <li key={st.label} data-first={i === 0 || undefined}>
              <span className={s.i}>{i + 1}</span>
              <span className={s.step}>
                <b>{st.label}</b>
                <span className={s.why}>{st.why}</span>
              </span>
              <Who who={st.who} />
              {st.tag && <span className={s.tag}>{st.tag}</span>}
            </li>
          ))}
          <li>
            <span className={s.i}>{PLAN.length + 1}</span>
            <span className={s.step}>
              <b>Open a draft PR</b>
              <span className={s.why}>billing-api’s rule</span>
            </span>
          </li>
        </ol>
        <p className={s.foot}>
          <span>About 40 min · about $2 on your plans</span>
          <span className={s.left} data-left />
          <span className={s.wait} aria-hidden="true" />
        </p>
      </div>

      <p className={s.next}>
        <span className={s.n}>433</span>
        <b>Update the refunds docs</b>
        <span className={s.then}>
          <Who who={[Agent.OpenCode]} />
          <span>then</span>
          <Who who={[Agent.Codex]} />
        </span>
        <span className={s.when} data-next />
      </p>
    </div>
  )
}
