import { type CSSProperties, useRef } from 'react'

import { Agent } from '../../../content/agents'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { useSeen } from '../kit/seen'
import s from './Handoff.module.css'

/*
 * A usage limit, as one task's morning on two of your plans: Claude Code
 * works on it until its five-hour limit at 11:31, and Codex carries it on
 * from there, on the same thread, plan and branch, until it is ready for
 * you at 12:40. Claude Code's plan rests until 14:00. Drawn as two lanes on
 * a clock, filling in as it comes into view. On a phone each lane's name
 * stands over its track, so the moment it moved is said above the lanes and
 * marked on the tracks alone.
 */

const FROM = 11 * 60
const TO = 14 * 60
const at = (h: number, m: number) => ((h * 60 + m - FROM) / (TO - FROM)) * 100

const TICKS = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00']

/** `play`, when given, says when it draws in, in place of being seen. */
export function Handoff({ play }: { play?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const seenSelf = useSeen(ref, 0.4)
  const seen = play ?? seenSelf
  const cut = at(11, 31)
  const done = at(12, 40)
  return (
    <div
      ref={ref}
      className={cx(s.handoff, seen && s.seen)}
      role="img"
      aria-label="Task 431: Claude Code worked on it from 11:02 until its usage limit at 11:31; Codex carried it on until it was ready at 12:40; Claude Code's plan is back at 14:00"
    >
      <div className={s.head}>
        <span className={s.task}>Task 431</span>
        <b>Refunds rate-limit like charges</b>
      </div>

      <p className={s.eventLine}>
        <time>11:31</time> Claude Code’s 5-hour limit. Codex carries on.
      </p>

      <div className={s.chart} style={{ '--cut': `${cut}%`, '--done': `${done}%`, '--start': `${at(11, 2)}%` } as CSSProperties}>
        <div className={s.lane}>
          <p className={s.who}>
            <AgentMark agent={Agent.Claude} size={20} />
            <span>
              <b>Claude Code</b>
              <span>Northwind · Claude Team</span>
            </span>
          </p>
          <div className={s.track}>
            <i className={cx(s.bar, s.ink)} style={{ left: 'var(--start)', width: 'calc(var(--cut) - var(--start))' }} />
            <i className={s.rest} style={{ left: 'var(--cut)', right: 0 }} />
            <i className={s.cutMark} style={{ left: 'var(--cut)' }} />
            <span className={s.restLabel} style={{ left: 'calc(var(--cut) + 10px)' }}>
              Out of usage · back at 14:00
            </span>
          </div>
        </div>

        <div className={s.lane}>
          <p className={s.who}>
            <AgentMark agent={Agent.Codex} size={20} />
            <span>
              <b>Codex</b>
              <span>Personal · ChatGPT Pro</span>
            </span>
          </p>
          <div className={s.track}>
            <i className={cx(s.bar, s.live, s.second)} style={{ left: 'var(--cut)', width: 'calc(var(--done) - var(--cut))' }} />
            <i className={s.cutMark} style={{ left: 'var(--cut)' }} />
            <span className={s.ready} style={{ left: 'var(--done)' }}>
              <i />
              Ready for you
            </span>
          </div>
        </div>

        {/* The moment it moved, across both lanes, and the clock: in the tracks' own width. */}
        <div className={s.overlay}>
          <div className={s.event} style={{ left: 'var(--cut)' }}>
            <span className={s.eventLabel}>
              <time>11:31</time> Claude Code’s 5-hour limit. Codex carries on.
            </span>
          </div>

          <ol className={s.ticks}>
            {TICKS.map((tick, i) => (
              <li key={tick} style={{ left: `${(i / (TICKS.length - 1)) * 100}%` }}>
                {tick}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <ul className={s.same}>
        <li>
          <b>Same thread</b>
          <span>Codex reads everything Claude did and said.</span>
        </li>
        <li>
          <b>Same plan</b>
          <span>The steps, the reviewers and your rules stay as they were.</span>
        </li>
        <li>
          <b>Same branch</b>
          <span>It picks up the commits where Claude left them.</span>
        </li>
      </ul>
    </div>
  )
}
