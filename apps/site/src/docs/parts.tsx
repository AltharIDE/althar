import { LimitMoved, Light, ModelSwap, RateLimit } from '@althar/ui'
import { type ReactNode, useState } from 'react'

import { CODEX, SONNET } from '../../../../packages/ui/src/fixtures/models'
import { cx } from '../lib/cx'
import s from './parts.module.css'

/*
 * What every direction's page is made of: the four voices a page can speak
 * in, the fold for the curious, a figure on the homepage's panel in
 * Althar's light, the path to a setting, and the one thing to try on this
 * page, drawn with the app's own thread pieces.
 */

export type Tone = 'call' | 'heads' | 'own' | 'note'

const KICKER: Record<Tone, string> = { call: 'Your call', heads: 'Heads up', own: 'On its own', note: 'Note' }

function ToneIcon({ tone }: { tone: Tone }) {
  switch (tone) {
    case 'call':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="3.6" fill="currentColor" />
        </svg>
      )
    case 'heads':
      return (
        <svg
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 3 17.5 16.5h-15Z" />
          <path d="M10 8.2v3.6" strokeLinecap="round" />
          <circle cx="10" cy="14" r="0.4" fill="currentColor" />
        </svg>
      )
    case 'own':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3.2 2.6" />
          <circle cx="10" cy="10" r="2.6" fill="currentColor" />
        </svg>
      )
    case 'note':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v4.6" strokeLinecap="round" />
          <circle cx="10" cy="6.4" r="0.4" fill="currentColor" />
        </svg>
      )
  }
}

/** A line the page wants seen, in one of its four voices, loudest first: your call, heads up, on its own, a note. */
export function Callout({ tone, title, children, className }: { tone: Tone; title?: string; children: ReactNode; className?: string }) {
  return (
    <aside className={cx(s.callout, s[tone], className)}>
      <span className={s.icon}>
        <ToneIcon tone={tone} />
      </span>
      <p className={s.kicker}>{title ?? KICKER[tone]}</p>
      <div className={s.body}>{children}</div>
    </aside>
  )
}

export interface Fold {
  q: string
  a: ReactNode
}

/** What only the curious need, folded shut: open one, or skip them all and miss nothing. */
export function Folds({
  items,
  title = 'Behind the scenes',
  note,
  className,
}: {
  items: readonly Fold[]
  title?: string
  note?: string
  className?: string
}) {
  return (
    <section className={cx(s.folds, className)} aria-label={title}>
      <div className={s.foldsHead}>
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </div>
      {items.map((f) => (
        <details key={f.q} className={s.fold}>
          <summary>
            <span>{f.q}</span>
            <i aria-hidden="true" />
          </summary>
          <div className={s.answer}>{f.a}</div>
        </details>
      ))}
    </section>
  )
}

/** A figure on the homepage's panel, Althar's light rising at its foot. */
export function Plate({
  children,
  caption,
  className,
  light = true,
}: {
  children: ReactNode
  caption?: ReactNode
  className?: string
  light?: boolean
}) {
  return (
    <figure className={cx(s.plate, className)}>
      <div className={s.panel}>
        {light && (
          <div className={s.light} aria-hidden="true">
            <Light height={0.5} />
          </div>
        )}
        {children}
      </div>
      {caption && <figcaption className={s.caption}>{caption}</figcaption>}
    </figure>
  )
}

/** Where something is in the app, as the homepage says it: Settings › While you’re in another app. */
export function Path({ parts }: { parts: readonly string[] }) {
  return (
    <p className={s.path}>
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && <i aria-hidden="true">›</i>}
          {i === parts.length - 1 ? <b>{p}</b> : p}
        </span>
      ))}
    </p>
  )
}

/** What goes over to the agent that takes the work, and the one thing that doesn't. */
export function Carried({ className }: { className?: string }) {
  const rows = [
    { what: 'The thread', note: 'every message, and what review found', kept: true },
    { what: 'The plan', note: 'its steps, and who does each', kept: true },
    { what: 'The branch', note: 'and the work on it so far', kept: true },
    { what: 'The old agent’s memory', note: 'the new one reads its way in', kept: false },
  ]
  return (
    <ul className={cx(s.carried, className)}>
      {rows.map((r) => (
        <li key={r.what} data-kept={r.kept || undefined}>
          <span className={s.tick} aria-hidden="true">
            {r.kept ? '✓' : '—'}
          </span>
          <b>{r.what}</b>
          <span>{r.note}</span>
          <span className={s.hidden}>{r.kept ? 'goes with the work' : 'stays behind'}</span>
        </li>
      ))}
    </ul>
  )
}

export type Rule = 'move' | 'wait' | 'ask'

export const RULES: readonly { id: Rule; name: string; words: string; note: string }[] = [
  {
    id: 'move',
    name: 'Move it on',
    words: 'moves to the next agent free',
    note: 'To the next agent signed in, in the order of your agents. It takes the work over from where it stands.',
  },
  { id: 'wait', name: 'Wait for the reset', words: 'waits for the reset', note: 'The step keeps its place and runs again at the reset.' },
  {
    id: 'ask',
    name: 'Ask me',
    words: 'waits for you',
    note: 'The step waits for you: move it to a model that’s free, or wait for the reset.',
  },
]

const OPTIONS = [
  { id: 'codex', model: CODEX, note: 'Codex · 38% of this week used' },
  { id: 'sonnet', model: SONNET, note: 'same limit, resets 14:00', busy: true },
]

/**
 * The one thing to try on this page: pick the project's rule, use the plan
 * up, and see what the task's thread shows, in the app's own pieces.
 */
export function RuleDemo({ className, rule: ruleProp, onRule }: { className?: string; rule?: Rule; onRule?: (r: Rule) => void }) {
  const [own, setOwn] = useState<Rule>('move')
  const rule = ruleProp ?? own
  const [used, setUsed] = useState(false)
  const [answered, setAnswered] = useState<null | 'moved' | 'waiting'>(null)
  const [round, setRound] = useState(0)
  const pick = (r: Rule) => {
    setOwn(r)
    onRule?.(r)
    setUsed(false)
    setAnswered(null)
    setRound((n) => n + 1)
  }
  const restart = () => {
    setUsed(false)
    setAnswered(null)
    setRound((n) => n + 1)
  }
  const words = RULES.find((r) => r.id === rule)?.words
  const asking = used && rule === 'ask' && !answered
  const moved = used && (rule === 'move' || answered === 'moved')
  const waiting = used && (rule === 'wait' || answered === 'waiting')
  const said = !used
    ? 'Use the plan up to see what this rule does.'
    : rule === 'move'
      ? 'Nothing asked you anything. The work went on with Codex, from where it stood, and the thread says so in one line.'
      : rule === 'wait'
        ? 'The step keeps its place. At 14:00 it runs again on Claude Code, by itself.'
        : answered
          ? 'You answered, so the card folds to a line and the work goes on from the task’s record.'
          : 'The one rule that asks. The task now waits in Needs you, in violet, until you pick.'
  return (
    <div className={cx(s.demo, className)}>
      <div className={s.demoHead}>
        <p className={s.sentence}>
          When an account runs out, the work <b>{words}</b>.
        </p>
        <fieldset className={s.rules}>
          <legend className={s.hidden}>The project’s rule</legend>
          {RULES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={cx(s.rule, r.id === rule && s.ruleOn)}
              aria-pressed={r.id === rule}
              onClick={() => pick(r.id)}
            >
              {r.name}
            </button>
          ))}
        </fieldset>
      </div>

      <div className={s.task}>
        <div className={s.taskHead}>
          <span>Task 431</span>
          <b>Refunds rate-limit like charges</b>
        </div>
        <div className={s.steps}>
          <div className={s.step}>
            <i className={cx(s.dot, asking && s.dotCall, waiting && s.dotRest)} aria-hidden="true" />
            <b>Implement</b>
            <span>{moved ? 'GPT-5.2 Codex · the lead now' : 'Opus 5 · Claude Code (work)'}</span>
            <em className={cx(asking && s.emCall, !asking && !waiting && s.emLive)}>
              {asking ? 'Waits for you' : waiting ? 'Waits until 14:00' : 'Working'}
            </em>
          </div>
          <div className={s.step}>
            <i className={s.next} aria-hidden="true" />
            <b>Review</b>
            <span>another lab</span>
            <em>up next</em>
          </div>
        </div>
        <div className={s.meter}>
          <span>Claude Code (work) · Max</span>
          <span>{used ? 'Out of usage · back at 14:00' : '92% of this window used'}</span>
          <i aria-hidden="true">
            <i style={{ width: used ? '100%' : '92%' }} data-out={used || undefined} />
          </i>
        </div>

        <div className={s.thread} key={round} aria-live="polite">
          {used && rule === 'move' && <LimitMoved what="The lead" to={CODEX} runtime="Claude Code" resets="14:00" project="meridian" />}
          {used && rule === 'wait' && (
            <LimitMoved
              what="The lead"
              runtime="Claude Code"
              resets="14:00"
              project="meridian"
              text={{ waitsWhy: (r) => `${r} hit its usage limit · by meridian’s rule` }}
            />
          )}
          {used && rule === 'ask' && (
            <RateLimit
              runtime="Claude Code"
              resets="14:00"
              step="Implement"
              options={OPTIONS}
              onSwap={() => setAnswered('moved')}
              onWait={() => setAnswered('waiting')}
            />
          )}
        </div>
      </div>

      <div className={s.demoFoot}>
        {used ? (
          <button type="button" className={s.again} onClick={restart}>
            Start again
          </button>
        ) : (
          <button type="button" className={s.use} onClick={() => setUsed(true)}>
            Use up the Max plan
          </button>
        )}
        <p className={s.said} aria-live="polite">
          {said}
        </p>
      </div>
    </div>
  )
}

/** The docs' search: a field in the site's glass or on its paper. */
export function Search({
  tone = 'paper',
  placeholder = 'Search the docs',
  value,
  onChange,
  className,
}: {
  tone?: 'paper' | 'glass'
  placeholder?: string
  value?: string
  onChange?: (v: string) => void
  className?: string
}) {
  return (
    <label className={cx(s.search, tone === 'glass' && s.searchGlass, className)}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="7" cy="7" r="5" />
        <path d="m11 11 3.5 3.5" strokeLinecap="round" />
      </svg>
      <span className={s.hidden}>{placeholder}</span>
      <input type="search" placeholder={placeholder} value={value} onChange={onChange && ((e) => onChange(e.target.value))} />
      <kbd>⌘K</kbd>
    </label>
  )
}

/** What the task’s thread says when the work moves: the app’s own two lines, on a card. */
export function ThreadLines({ className }: { className?: string }) {
  return (
    <div className={cx(s.lines, className)}>
      <p className={s.linesHead}>
        <span>Task 431</span>
        <b>Refunds rate-limit like charges</b>
      </p>
      <div className={s.linesBody}>
        <LimitMoved what="The lead" to={CODEX} runtime="Claude Code" resets="14:00" project="meridian" />
        <ModelSwap to={CODEX} note="picks up from the task’s record, not from Opus 5’s memory" />
      </div>
    </div>
  )
}
