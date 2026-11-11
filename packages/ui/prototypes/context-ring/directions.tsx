import {
  ActionButton,
  BrandMark,
  Button,
  Caret,
  Disclosure,
  DisclosureTrigger,
  Fold,
  NextStep,
  NextSteps,
  Segmented,
  UsageLines,
  type UsageLine,
} from '@althar/ui'
import { type ReactNode, useState } from 'react'

import ring from '../../src/composer/ContextRing/ContextRing.module.css'
import type { CardState, Usage } from './states'
import c from './directions.module.css'

/* ---------- words ---------- */

/** Thousands of tokens, as the ring writes them: 97.4k, 1M. */
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}M` : `${Math.round(n * 10) / 10}k`)
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`)
const share = (p: number) => (p >= 1 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : '< 0.1%')
const short = (name: string) => name.replace(/^Claude /, '')
export const percentOf = (s: CardState) => Math.round(Math.min(1, s.used / s.total) * 100)

/**
 * A line's figure, one qualifier at most: "< 0.1%" is already a bound, so it
 * takes no "~" as well. With `unit`, a plan's share says "of week".
 */
const figure = (line: UsageLine, unit: boolean) => {
  if (line.took !== undefined) {
    if (line.took === null) return '—'
    const tilde = line.estimated === true && line.took >= 0.1 ? '~' : ''
    return `${tilde}${share(line.took)}${unit ? ' of week' : ''}`
  }
  if (line.spent === undefined || line.spent === null) return '—'
  return `${line.estimated === true ? '~' : ''}$${line.spent.toFixed(2)}`
}

/**
 * What ran on it: the models and their tokens, the chat's own model left
 * out, since the picker beside the ring already names it.
 */
const ran = (line: UsageLine, chat: string) => {
  if (line.byModel !== undefined && line.byModel.length > 1)
    return `${line.byModel.map((m) => `${short(m.name)} ${tokens(m.tokens)}`).join(' · ')} tokens`
  const others = line.models.filter((m) => m !== chat).map(short)
  return [...others, `${tokens(line.tokens)} tokens`].join(' · ')
}
const when = (usage: Usage) => (usage.heading === 'Today' ? 'today' : 'so far')
const whose = (usage: Usage) => (usage.heading === 'Today' ? 'Today' : 'This task')

/* ---------- shared bits ---------- */

/** The ring, drawn as the composer draws it, at any size. */
export function Ring({ pct, size = 16 }: { pct: number; size?: number }) {
  const r = 6
  const C = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={c.ringMark}>
      <circle cx="8" cy="8" r={r} className={ring.track} />
      {pct > 0 && <circle cx="8" cy="8" r={r} className={ring.fill} strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 8 8)" />}
    </svg>
  )
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={`${ring.bar} ${className ?? ''}`} aria-hidden="true">
      <i style={{ width: `${pct * 100}%` }} />
    </span>
  )
}

/** An account's line: mark and name, its figure at the end, what ran on it under both, never cut. */
function Rows({ lines, chat, suffix }: { lines: ReadonlyArray<UsageLine>; chat: string; suffix?: string }) {
  return (
    <ul className={c.rows}>
      {lines.map((line) => (
        <li key={line.id}>
          {line.mark !== undefined && <BrandMark brand={line.mark} size={13} />}
          <span className={c.rowName} title={line.name}>
            {line.name}
          </span>
          <b className={c.rowFig} title={line.estimated === true ? 'An estimate' : undefined}>
            {figure(line, true)}
          </b>
          <span className={c.rowSub}>
            {ran(line, chat)}
            {suffix !== undefined && ` ${suffix}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export interface CardProps {
  readonly state: CardState
  readonly onCompact: () => void
  readonly onClear: () => void
  /** For the page's grid: show what folds or switches in its other view. */
  readonly opened?: boolean
}

export interface Direction {
  readonly key: string
  readonly letter: string
  readonly name: string
  readonly idea: string
  readonly width: (s: CardState) => number
  readonly Card: (p: CardProps) => ReactNode
}

/* ---------- Now: the card as it is ---------- */

function NowCard({ state, onCompact, onClear }: CardProps) {
  const pct = state.used / state.total
  return (
    <div className={ring.card}>
      <span className={ring.top}>
        <b>{percentOf(state)}%</b> of context
      </span>
      <Bar pct={pct} />
      <span className={ring.n}>
        {k(state.used)} of {k(state.total)} · {state.model.short}
      </span>
      <span className={ring.foot}>
        <ActionButton size="small" flush="start" onClick={onClear}>
          Clear chat…
        </ActionButton>
        <ActionButton size="small" flush="end" onClick={onCompact} disabled={state.compacting === true}>
          {state.compacting === true ? 'Compacting…' : 'Compact'}
        </ActionButton>
      </span>
      {state.usage !== undefined && (
        <div className={ring.usage}>
          <UsageLines lines={state.usage.lines} heading={state.usage.heading} />
        </div>
      )}
    </div>
  )
}

/* ---------- A: one list ---------- */

function OneList({ state, onCompact, onClear }: CardProps) {
  const pct = state.used / state.total
  const { usage } = state
  return (
    <div className={c.a}>
      <div className={c.aRow}>
        <Ring pct={pct} size={14} />
        <span className={c.aName}>Context</span>
        <b className={c.aFig}>{percentOf(state)}%</b>
        <Bar pct={pct} className={c.aBar} />
        <span className={c.aSub}>
          {k(state.used)} of {k(state.total)} tokens
        </span>
      </div>
      {usage !== undefined &&
        usage.lines.map((line) => (
          <div key={line.id} className={c.aRow}>
            {line.mark !== undefined ? <BrandMark brand={line.mark} size={13} /> : <span />}
            <span className={c.aName} title={line.name}>
              {line.name}
            </span>
            <b className={c.aFig} title={line.estimated === true ? 'An estimate' : undefined}>
              {figure(line, true)}
            </b>
            <span className={c.aSub}>
              {ran(line, state.model.name)} {when(usage)}
            </span>
          </div>
        ))}
      <div className={c.aActions}>
        <Button variant="quiet" size="small" icon="compress" onClick={onCompact} busy={state.compacting === true}>
          {state.compacting === true ? 'Compacting…' : 'Compact'}
        </Button>
        <Button variant="quiet" size="small" icon="remove" onClick={onClear}>
          Clear chat…
        </Button>
      </div>
    </div>
  )
}

/* ---------- B: one big figure ---------- */

function BigFigure({ state, onCompact, onClear }: CardProps) {
  const pct = state.used / state.total
  const { usage } = state
  return (
    <div className={c.b}>
      <div className={c.bHead}>
        <span className={c.bBig}>{percentOf(state)}%</span>
        <span className={c.bActs}>
          <ActionButton size="small" onClick={onClear}>
            Clear chat…
          </ActionButton>
          <ActionButton size="small" icon="compress" onClick={onCompact} disabled={state.compacting === true}>
            {state.compacting === true ? 'Compacting…' : 'Compact'}
          </ActionButton>
        </span>
      </div>
      <Bar pct={pct} />
      <span className={c.bSub}>
        {k(state.used)} of {k(state.total)} tokens
      </span>
      {usage !== undefined && (
        <div className={c.bUsage}>
          <span className={c.bKey}>{whose(usage)}</span>
          <ul>
            {usage.lines.map((line) => (
              <li key={line.id} title={`${line.name}: ${ran(line, state.model.name)}`}>
                {line.mark !== undefined && <BrandMark brand={line.mark} size={12} />}
                <span className={c.bName}>{line.name}</span>
                <b title={line.estimated === true ? 'An estimate' : undefined}>{figure(line, true)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------- C: usage folded ---------- */

function Folded({ state, onCompact, onClear, opened }: CardProps) {
  const pct = state.used / state.total
  const { usage } = state
  return (
    <div className={c.c}>
      <div className={c.cTop}>
        <span>
          <b>{percentOf(state)}%</b> of context
        </span>
        <span className={c.cAmt}>
          {k(state.used)} of {k(state.total)}
        </span>
      </div>
      <Bar pct={pct} />
      {usage !== undefined && (
        <Disclosure className={c.cUsage} defaultOpen={opened === true}>
          <DisclosureTrigger>
            <button type="button" className={c.cToggle}>
              <span className={c.cWhose}>{whose(usage)}</span>
              <span className={c.cGlance}>
                {usage.lines.map((line) => (
                  <span key={line.id}>
                    {line.mark !== undefined && <BrandMark brand={line.mark} size={12} />}
                    {figure(line, false)}
                  </span>
                ))}
              </span>
              <Caret />
            </button>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={c.cLines}>
              <Rows lines={usage.lines} chat={state.model.name} />
            </div>
          </Fold>
        </Disclosure>
      )}
      <NextSteps className={c.steps}>
        <NextStep onPress={onClear}>Clear chat…</NextStep>
        <NextStep onPress={onCompact} busy={state.compacting === true} doing="Compacting…">
          Compact
        </NextStep>
      </NextSteps>
    </div>
  )
}

/* ---------- D: two views ---------- */

function TwoViews({ state, onCompact, onClear, opened }: CardProps) {
  const pct = state.used / state.total
  const { usage } = state
  const [view, setView] = useState<'context' | 'usage'>(opened === true ? 'usage' : 'context')
  const shown = usage === undefined ? 'context' : view
  return (
    <div className={c.d}>
      {usage !== undefined && (
        <Segmented
          label="Show"
          className={c.dTabs}
          value={view}
          onChange={setView}
          options={[
            { value: 'context', label: 'Context' },
            { value: 'usage', label: whose(usage) },
          ]}
        />
      )}
      {shown === 'context' ? (
        <div className={c.dPane}>
          <span className={c.dTop}>
            <b>{percentOf(state)}%</b> of context
          </span>
          <Bar pct={pct} />
          <span className={c.dSub}>
            {k(state.used)} of {k(state.total)} tokens
          </span>
          <NextSteps className={c.steps}>
            <NextStep onPress={onClear}>Clear chat…</NextStep>
            <NextStep onPress={onCompact} busy={state.compacting === true} doing="Compacting…">
              Compact
            </NextStep>
          </NextSteps>
        </div>
      ) : (
        usage !== undefined && (
          <div className={c.dPane}>
            <Rows lines={usage.lines} chat={state.model.name} />
          </div>
        )
      )}
    </div>
  )
}

export const NOW: Direction = {
  key: 'now',
  letter: '0',
  name: 'Now',
  idea: 'The card as it is today.',
  width: (s) => (s.usage === undefined ? 232 : 296),
  Card: NowCard,
}

export const DIRECTIONS: readonly Direction[] = [
  {
    key: 'a',
    letter: 'A',
    name: 'One list',
    idea: 'Context and each account are rows of one list: a mark, a name, a figure. The actions are its last rows.',
    width: () => 288,
    Card: OneList,
  },
  {
    key: 'b',
    letter: 'B',
    name: 'One big figure',
    idea: 'The share of context is the one large thing, with its actions beside it. Usage is a quiet line per account under it.',
    width: () => 288,
    Card: BigFigure,
  },
  {
    key: 'c',
    letter: 'C',
    name: 'Usage folded',
    idea: 'Context with its actions as the card’s foot. Usage folds to one line of figures, and opens for the detail.',
    width: () => 288,
    Card: Folded,
  },
  {
    key: 'd',
    letter: 'D',
    name: 'Two views',
    idea: 'Context and usage stop sharing the card: a switch at its top shows one at a time.',
    width: () => 288,
    Card: TwoViews,
  },
]
