import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import { labOf, Mark } from '../Mark'
import { Pin as Panel } from '../Slide'
import ui from '../ui.module.css'
import s from './Team.module.css'

const POINTS = [
  ['A stand-up, not a chat log.', 'What moved, what’s running and what’s waiting on you, as a report or as a board.'],
  ['Only decisions reach you.', 'Product calls, irreversible actions and contradictions in memory.'],
  ['The right agent for each step,', 'with review from a different lab from the author’s.'],
  ['Built as an instrument.', 'Calm, dense and keyboard-first, for hours of daily use.'],
] as const

/** A numbered pin on the mockup, matching a point beside it. */
const Pin = ({ n }: { n: number }) => (
  <span className={s.pin} aria-hidden="true">
    {n}
  </span>
)

const Chevron = () => (
  <svg className={s.chev} viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2.5 4l2.5 2.5L7.5 4" />
  </svg>
)

const MOVED = [
  ['Refund idempotency keys merged', 'task 415 · PR #1184', ['Claude Code', 'Codex']],
  ['Checkout timeouts: pool exhausted under retry storms', 'task 416', ['Codex']],
  ['Webhook retry contract promoted to canonical', 'task 417', []],
] as const

interface Run {
  id: number
  title: string
  /** The step it's on, and who runs it. */
  step: string
  agent: string
  at: number
  of: number
  age: string
  note?: string
}

const RUNNING: readonly Run[] = [
  {
    id: 418,
    title: 'Stale permissions after a role change',
    step: 'Security review',
    agent: 'Codex',
    at: 4,
    of: 9,
    age: '6m',
    note: '+ 1 step, by rule',
  },
  { id: 419, title: 'Migrate billing webhooks to v2', step: 'Implement', agent: 'Claude Code', at: 1, of: 6, age: '22m' },
  { id: 421, title: 'Drop legacy_sessions table', step: 'Review', agent: 'Codex', at: 2, of: 5, age: '41m' },
]

const DECISION = {
  q: 'If token rotation fails, should the request fail, or retry once?',
  why: 'Found by the security review. No decision on record; memory proposes retrying once, from task 402.',
  options: ['Retry once', 'Fail the request'],
} as const

const TABS = ['Conversation', 'Board', 'Both'] as const

/** The app window around either view, with the view's tab lit. */
function Window({ tab, className, children }: { tab: (typeof TABS)[number]; className?: string; children: ReactNode }) {
  return (
    <div className={cx(s.app, className)}>
      <div className={s.bar}>
        <i />
        <i />
        <i />
        <b>
          payments-service <Chevron />
        </b>
        <span className={s.tabs}>
          {TABS.map((t) => (
            <span key={t} className={cx(t === tab && s.on)}>
              {t}
              {t === 'Board' && <i className={s.tdot} />}
            </span>
          ))}
        </span>
        <span className={s.stat}>
          <span className={s.live}>{RUNNING.length} running</span>
          <em>1 needs you</em>
        </span>
        <span className={s.rooms}>
          <span>Knowledge</span>
          <span>Artifacts</span>
        </span>
      </div>
      {children}
    </div>
  )
}

/** The composer under the conversation. */
const Composer = () => (
  <div className={s.cz}>
    <p className={s.czIn}>
      <Pin n={4} />
      Tell the project what you want next
    </p>
    <p className={s.czBar}>
      <span className={s.model}>
        <Mark lab="anthropic" /> Opus 5 <em>High</em> <Chevron />
      </span>
      <kbd>c</kbd>
    </p>
  </div>
)

/** Where a task is in its steps: the ones done, the one running, the ones to come. */
function Track({ at, of }: { at: number; of: number }) {
  return (
    <span className={s.track} style={{ '--at': `${(at / (of - 1)) * 100}%` } as CSSProperties}>
      {Array.from({ length: of }, (_, j) => (
        <i key={j} className={cx(j < at && s.did, j === at && s.cur)} />
      ))}
    </span>
  )
}

/** The decision's two answers, each on its key. */
const Options = () => (
  <ul className={s.opts}>
    {DECISION.options.map((o, j) => (
      <li key={o}>
        <kbd>{'AB'[j]}</kbd>
        {o}
      </li>
    ))}
  </ul>
)

/** The coordinator's report in the conversation after a night away: a mockup made for this slide. */
export function Standup({ className }: { className?: string }) {
  return (
    <Window tab="Conversation" className={className}>
      <div className={s.talk}>
        <p className={s.away}>
          <Pin n={1} />
          You were away 14 hours
        </p>

        <p className={s.who}>
          <i />
          Coordinator <span>07:41</span>
        </p>
        <p className={s.say}>payments-service ran overnight. One decision needs you, and one task gained a step by rule.</p>

        <p className={s.sh}>
          Needs you <Pin n={2} />
        </p>
        <div className={s.ask}>
          <p className={s.askK}>
            <b>Decision</b> 418 <span>18 min ago</span>
          </p>
          <p className={s.askQ}>{DECISION.q}</p>
          <p className={s.askW}>{DECISION.why}</p>
          <Options />
          <p className={s.askF}>
            Review keeps running while you decide. <b>Decide →</b>
          </p>
        </div>

        <p className={s.sh}>Moved</p>
        <ul className={s.rows}>
          {MOVED.map(([what, meta, by]) => (
            <li key={what}>
              <b>{what}</b>
              <span className={s.meta}>
                {meta}
                {by.map((a) => (
                  <Mark key={a} lab={labOf(a)} />
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className={s.sh}>
          Still running <Pin n={3} />
        </p>
        <ul className={s.rows}>
          {RUNNING.map((t) => (
            <li key={t.id}>
              <b>{t.title}</b>
              <span className={s.meta}>
                {t.step.toLowerCase()} · <Mark lab={labOf(t.agent)} /> {t.agent} · {t.age}
              </span>
            </li>
          ))}
        </ul>

        <p className={s.say}>
          I added a security review to 418: the diff touches token rotation, which a rule from 4 February marks sensitive.
        </p>
        <Composer />
      </div>
    </Window>
  )
}

const NEXT = [
  { id: 420, kind: 'Delivery', title: 'Upgrade the Stripe SDK to v15', note: 'Starts when 419 merges' },
  { id: 425, kind: 'Question', title: 'Which partners still call the v1 webhook endpoint?', note: 'After 420' },
] as const

const SETTLED = [
  { id: 415, kind: 'Merged', title: 'Refund idempotency keys', meta: 'PR 1184 · 2 review cycles', at: '3h ago' },
  { id: 416, kind: 'Answered', title: 'Checkout timeouts', meta: 'Cause found: pool exhausted', at: '5h ago' },
  { id: 417, kind: 'Knowledge', title: 'Webhook retry contract', meta: 'Promoted to canonical', at: '1d ago' },
] as const

/** A column's head: its glyph, its name, how many it holds. */
function Head({ k, n, pin, className }: { k: string; n: number; pin?: number; className?: string }) {
  return (
    <p className={cx(s.ch, className)}>
      <i />
      {k}
      {pin !== undefined && <Pin n={pin} />}
      <span className={s.count}>{n}</span>
    </p>
  )
}

/** The board view of the same morning: a mockup made for this slide. */
export function Board({ className }: { className?: string }) {
  return (
    <Window tab="Board" className={className}>
      <div className={s.cols}>
        <section className={cx(s.col, s.next)}>
          <Head k="Up next" n={NEXT.length} />
          {NEXT.map((t, j) => (
            <div key={t.id} className={s.row}>
              <span className={s.kind}>
                <span className={s.num}>{j + 1}</span>
                {t.id} {t.kind}
              </span>
              <b>{t.title}</b>
              <span className={s.cnote}>{t.note}</span>
            </div>
          ))}
        </section>

        <section className={cx(s.col, s.run)}>
          <Head k="Running" n={RUNNING.length} pin={3} />
          {RUNNING.map((t) => (
            <div key={t.id} className={s.card}>
              <span className={s.kind}>
                {t.id} Delivery <span className={s.age}>{t.age}</span>
              </span>
              <b>{t.title}</b>
              <Track at={t.at} of={t.of} />
              <span className={s.foot}>
                <span className={s.stepName}>{t.step}</span>
                {t.at + 1} of {t.of}
              </span>
              <span className={s.foot}>
                <span className={s.chip}>
                  <Mark lab={labOf(t.agent)} /> {t.agent}
                </span>
              </span>
              {t.note && <span className={s.cnote}>{t.note}</span>}
            </div>
          ))}
        </section>

        <section className={cx(s.col, s.you)}>
          <Head k="Needs you" n={1} pin={2} />
          <div className={s.card}>
            <span className={s.kind}>
              <b className={s.decision}>Decision</b> <span className={s.age}>18 min ago</span>
            </span>
            <b>{DECISION.q}</b>
            <span className={s.cnote}>Memory proposes retrying once, from task 402.</span>
            <Options />
            <span className={s.foot}>
              From 418 <b className={s.decide}>Decide →</b>
            </span>
          </div>
        </section>

        <section className={cx(s.col, s.done)}>
          <Head k="Settled" n={SETTLED.length} pin={1} />
          {SETTLED.map((t) => (
            <div key={t.id} className={s.row}>
              <span className={s.kind}>
                <b className={cx(t.kind === 'Merged' && s.ok)}>{t.kind === 'Merged' ? `✓ ${t.kind}` : t.kind}</b>
                {t.id}
                <span className={s.age}>{t.at}</span>
              </span>
              <b>{t.title}</b>
              <span className={s.cnote}>{t.meta}</span>
            </div>
          ))}
        </section>
      </div>
    </Window>
  )
}

/** Two views of one project, as the panel scrolls: the conversation's stand-up, then the board. */
export function Team() {
  return (
    <Panel id="team" tone="light" name="The experience" className={s.team} steps={2}>
      {(k) => (
        <div className={cx(ui.wrap, ui.split, s.split)} data-step={k}>
          <div>
            <p className={cx(ui.kicker, s.kicker)}>The experience</p>
            <h2>Run agents the way a good lead runs a team.</h2>
            <ol className={s.pts}>
              {POINTS.map(([b, t], j) => (
                <li key={b}>
                  <span className={s.n}>{j + 1}</span>
                  <p>
                    <b>{b}</b> {t}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <figure
            className={s.shot}
            aria-label="Mockup: the coordinator’s stand-up for payments-service in the conversation, then the same project as a board"
          >
            <Standup className={s.v0} />
            <Board className={s.v1} />
          </figure>
        </div>
      )}
    </Panel>
  )
}
