import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'

import { Agent, agentName } from '../content/agents'
import { AgentMark } from '../shared/AgentMark'
import { clamp, playback } from '../lib/motion'
import s from './TaskLoop.module.css'

/*
 * One task, as the app runs it (task 418 in the shell prototype): a plan,
 * the lead implements, other models review, the lead fixes what they found,
 * and back for a second review. Then the security review your rule adds,
 * verify, the pull request, and the one step that's yours: merging it.
 * Plays once, with a button to run it again.
 */

type Who = readonly Agent[] | 'coordinator' | 'you'

const NODES: readonly { name: string; who: Who; rule?: boolean }[] = [
  { name: 'Plan', who: 'coordinator' },
  { name: 'Implement', who: [Agent.Claude] },
  { name: 'Review', who: [Agent.Codex, Agent.OpenCode] },
  { name: 'Fix', who: [Agent.Claude] },
  { name: 'Security review', who: [Agent.Codex], rule: true },
  { name: 'Verify', who: [Agent.OpenCode] },
  { name: 'Open PR', who: [Agent.Claude] },
  { name: 'Merge', who: 'you' },
]

/** [step, from, to, what it says once done]. Review runs twice: round 2 comes back after Fix. */
const RUN = [
  [0, 0.3, 1.0, '3 parts'],
  [1, 1.0, 2.3, '4 files changed'],
  [2, 2.3, 3.5, '3 findings'],
  [3, 3.5, 4.7, '2 fixed · 1 set aside'],
  [2, 5.2, 6.1, 'Clean in round 2'],
  [4, 6.1, 7.0, 'No findings'],
  [5, 7.0, 7.9, '214 tests pass'],
  [6, 7.9, 8.6, 'PR 1192'],
  [7, 8.6, 9.8, 'Merged'],
] as const

const MERGE = 7
const ARC = [4.7, 5.2] as const
const ROUND_2 = 5.2
const RULE = 6.0

const LOG = [
  [1.0, '09:14', 'Plan ready. Claude Code leads.'],
  [3.5, '09:36', 'Codex and OpenCode reviewed: 3 findings.'],
  [4.7, '09:49', 'Claude Code fixed 2 and set 1 aside, with a reason. Back for review.'],
  [6.1, '09:55', 'Round 2 is clean. Your rule added a security review: it touches money.'],
  [7.9, '10:03', '214 tests pass. PR 1192 opened.'],
  [8.6, '10:03', 'Waiting on you to merge.'],
  [9.8, '10:11', 'You merged it.'],
] as const

const TOTAL = 10.4

function WhoRuns({ who }: { who: Who }) {
  if (who === 'coordinator')
    return (
      <span className={s.ag}>
        <i className={s.sq} aria-hidden="true" />
        Coordinator
      </span>
    )
  if (who === 'you')
    return (
      <span className={s.ag}>
        <i className={s.you} aria-hidden="true" />
        You
      </span>
    )
  return (
    <>
      {who.map((a, i) => (
        <span key={a} className={s.ag}>
          {i > 0 && <em aria-hidden="true">+</em>}
          <AgentMark agent={a} size={14} />
          {agentName(a)}
        </span>
      ))}
    </>
  )
}

export function TaskLoop() {
  const box = useRef<HTMLDivElement>(null)
  const replay = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const steps = Array.from(el.querySelectorAll<HTMLElement>('[data-step]'))
    const lines = Array.from(el.querySelectorAll<HTMLElement>('[data-line]'))
    const status = el.querySelector<HTMLElement>('[data-status]')
    const arc = el.querySelector<HTMLElement>('[data-arc]')
    const draw = (t: number) => {
      let reached = 0
      steps.forEach((li, i) => {
        const runs = RUN.filter((r) => r[0] === i)
        const now = runs.find((r) => t >= r[1] && t < r[2])
        const done = runs.filter((r) => t >= r[2])
        const out = li.querySelector<HTMLElement>('[data-out]')
        li.dataset.state = now ? (i === MERGE ? 'need' : 'now') : done.length ? 'done' : ''
        li.toggleAttribute('data-rule-shown', t >= RULE)
        if (out)
          out.textContent = now ? (i === MERGE ? 'Needs you' : i === 2 && t >= ROUND_2 ? 'Round 2' : 'Running') : (done.at(-1)?.[3] ?? '')
        if (now || done.length) reached = i
      })
      el.style.setProperty('--reach', String(reached))
      if (arc) {
        arc.style.setProperty('--k', String(clamp((t - ARC[0]) / (ARC[1] - ARC[0]))))
        arc.toggleAttribute('data-live', t >= ARC[0] && t < RUN[5][1])
      }
      const shown = lines.filter((l) => t >= Number(l.dataset.at))
      lines.forEach((l) => {
        l.hidden = !shown.slice(-3).includes(l)
      })
      if (status) {
        const merged = t >= RUN[8][2]
        const yours = !merged && t >= RUN[8][1]
        status.dataset.state = merged ? 'done' : yours ? 'need' : 'now'
        status.textContent = merged
          ? '✓ Merged · 2 review rounds'
          : yours
            ? '● Needs you: merge'
            : `● Running · round ${t >= ROUND_2 ? 2 : 1}`
      }
    }
    return playback({ total: TOTAL, draw, replay: replay.current, watch: el })
  }, [])

  return (
    <div ref={box} className={s.card}>
      <div className={s.head}>
        <span className={s.n}>431</span>
        <b>Rate-limit refunds like charges</b>
        <span className={s.lead}>
          Lead <WhoRuns who={[Agent.Claude]} />
        </span>
        <span className={s.status} data-status />
      </div>
      <div className={s.plane}>
        <span className={s.rail} aria-hidden="true">
          <b />
        </span>
        <span className={s.arc} data-arc aria-hidden="true">
          <span className={s.arcLine} />
          <span className={s.arcLabel}>Back for review · round 2</span>
        </span>
        <ol className={s.steps}>
          {NODES.map((n, i) => (
            <li key={n.name} data-step style={{ '--i': i } as CSSProperties}>
              {n.rule && <span className={s.rule}>Added by your rule</span>}
              <span className={s.k}>{n.name}</span>
              <span className={s.dot} aria-hidden="true" />
              <span className={s.who}>
                <WhoRuns who={n.who} />
              </span>
              <span className={s.out} data-out />
            </li>
          ))}
        </ol>
      </div>
      <div className={s.foot}>
        <ul className={s.log} aria-live="polite">
          {LOG.map(([at, time, line]) => (
            <li key={line} data-line data-at={at} hidden>
              <span className={s.time}>{time}</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <button ref={replay} type="button" className={s.replay} hidden>
          Run it again
        </button>
      </div>
    </div>
  )
}
