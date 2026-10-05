import { useEffect, useRef } from 'react'

import { Agent, agentName } from '../content/agents'
import { AgentMark } from '../shared/AgentMark'
import { clamp, ease, playback } from '../lib/motion'
import s from './Meters.module.css'

/*
 * Your agents today: each plan's usage, the tasks running on it, and the
 * moment Claude hits its five-hour limit and its task carries on in Codex.
 * Plays once, as the page opens.
 *
 * It's drawn as a slim card held up at an angle: it floats a little, and
 * leans toward the pointer. The tasks are plain lines of text, not chips,
 * so nothing on it looks like something to press.
 */

interface Row {
  agent: Agent
  plan: string
  window: string
  /** Usage at the start and the end, from 0 to 1. Null: paid by the token. */
  use: readonly [number, number] | null
}

const ROWS: readonly Row[] = [
  { agent: Agent.Claude, plan: 'Claude Max plan', window: '5-hour window', use: [0.74, 1] },
  { agent: Agent.Codex, plan: 'ChatGPT Plus plan', window: 'weekly limit', use: [0.22, 0.41] },
  { agent: Agent.OpenCode, plan: 'Any API key, or a local model', window: 'pay as you go', use: null },
]

/** [task, title, where it runs, where it moves when its agent runs out] */
const TASKS = [
  ['431', 'Refunds', Agent.Claude, Agent.Codex],
  ['432', 'Webhooks', Agent.Codex, null],
  ['433', 'Docs', Agent.OpenCode, null],
  ['434', 'Lint', Agent.OpenCode, null],
] as const

const FULL = 2.6
const MOVE = 3
const TOTAL = 6

export function Meters() {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)

  /* Leans toward the pointer, a few degrees at most. Only with a mouse, and not with reduced motion. */
  useEffect(() => {
    const el = stage.current
    if (!el || !window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3))
      el.style.setProperty('--ty', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3))
    }
    const leave = () => {
      el.style.removeProperty('--tx')
      el.style.removeProperty('--ty')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const q = <T extends Element>(sel: string) => el.querySelectorAll<T>(sel)
    const draw = (t: number) => {
      for (const r of ROWS) {
        const row = el.querySelector<HTMLElement>(`[data-row="${r.agent}"]`)
        if (!row) continue
        const fill = row.querySelector<HTMLElement>('[data-fill]')
        const used = row.querySelector<HTMLElement>('[data-used]')
        if (!r.use) {
          if (used) used.textContent = `$${(0.42 + t * 0.11).toFixed(2)} today`
          continue
        }
        const k = r.agent === Agent.Claude ? clamp(t / FULL) : clamp(t / 9)
        const u = r.use[0] + (r.use[1] - r.use[0]) * ease(k)
        const full = u >= 1
        row.toggleAttribute('data-full', full)
        if (fill) fill.style.width = `${(u * 100).toFixed(1)}%`
        if (used) used.textContent = full ? 'Limit reached · resets 15:00' : `${Math.round(u * 100)}% used`
      }
      const moved = t >= MOVE
      q<HTMLElement>('[data-task="431"]').forEach((c) => {
        c.hidden = (c.dataset.on === Agent.Codex) !== moved
      })
      const note = el.querySelector<HTMLElement>('[data-note]')
      if (note) note.style.visibility = moved ? 'visible' : 'hidden'
    }
    return playback({ total: TOTAL, draw, watch: el })
  }, [])

  return (
    <div ref={stage} className={s.stage}>
      <div className={s.float}>
        <div ref={box} className={s.card}>
          <p className={s.head}>
            <span>Your agents · today</span>
            <span>4 tasks running</span>
          </p>
          {ROWS.map((r) => (
            <div key={r.agent} className={s.row} data-row={r.agent}>
              <p className={s.who}>
                <AgentMark agent={r.agent} size={20} />
                {agentName(r.agent)}
              </p>
              <p className={s.plan}>{r.plan}</p>
              <span className={s.bar}>
                <b data-fill />
              </span>
              <p className={s.state}>
                <span>{r.window}</span>
                <span className={s.used} data-used />
              </p>
              <ul className={s.tasks}>
                {TASKS.flatMap(([n, title, on, moves]) =>
                  [on, moves]
                    .filter((a): a is NonNullable<typeof a> => a === r.agent)
                    .map((a) => (
                      <li key={`${n}-${a}`} className={s.task} data-task={n} data-on={a} hidden={a === moves}>
                        <i aria-hidden="true" />
                        <span className={s.n}>{n}</span>
                        {title}
                      </li>
                    )),
                )}
              </ul>
            </div>
          ))}
          <p className={s.note} data-note>
            <span className={s.time}>14:02</span>
            <span>Claude hit its 5-hour limit. 431 carried on in Codex: same branch, same thread.</span>
          </p>
        </div>
      </div>
    </div>
  )
}
