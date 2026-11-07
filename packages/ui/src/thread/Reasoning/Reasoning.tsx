import { type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Rhythm } from '../../lib/rhythm'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Markdown } from '../Markdown/Markdown'
import s from './Reasoning.module.css'
import { headingOf, thoughtSummary } from './summary'

export { headingOf, thoughtSummary } from './summary'

export interface ReasoningText {
  thinking: string
  thought: (duration: string) => string
  /** Where how long it took isn't known, or was under a second. */
  thoughtBriefly: string
  /** Said once it has taken longer than an answer usually does. */
  slow: string
}

export const reasoningText: ReasoningText = {
  thinking: 'Thinking',
  thought: (d) => `Thought for ${d}`,
  thoughtBriefly: 'Thought',
  slow: 'longer than usual',
}

export interface ThinkingProps {
  /** What it says it is doing, when it says. Otherwise, text.thinking. */
  children?: ReactNode
  /** How long it has been at it, once that is worth saying: 12s. Shown, not read out each second. */
  took?: string
  /** It has taken longer than an answer usually does, and says so. */
  slow?: boolean
  text?: Partial<ReasoningText>
}

/**
 * The model is thinking and has nothing to show yet. The label shimmers;
 * then how long it has been, and that it is longer than usual where it is.
 * It shows after a beat, so an answer that comes at once never flashes it,
 * and it stands as tall as a line of what the model says, which takes its
 * place.
 */
export function Thinking({ children, took, slow = false, text }: ThinkingProps) {
  const t = { ...reasoningText, ...text }
  return (
    <div className={s.thinking} role="status">
      <span className={s.shimmer}>{children ?? t.thinking}</span>
      {took !== undefined && (
        <span className={s.took} aria-hidden="true">
          {took}
        </span>
      )}
      {slow && <span className={s.slow}>{t.slow}</span>}
    </div>
  )
}

export interface ReasoningProps extends Disclosable {
  /** How long it thought, once it is done: 14s. Without it, it says only that it thought. */
  took?: string
  /** What it thought, as markdown: drawn small and quiet, and what its line is made from. */
  source?: string
  /** What it thought about, in a line, where the host says; else from what it thought (thoughtSummary). */
  summary?: string
  /** It is thinking now: its line says what it is on, shimmering, and opened, what it thinks streams in. */
  live?: boolean
  /** What it thought, where it isn't markdown. */
  children?: ReactNode
  text?: Partial<ReasoningText>
}

/**
 * What the model thought, as a line among its turn's work: while it thinks,
 * what it is on (its latest heading, as Codex titles each part, or Thinking);
 * done, how long it thought, and what about. All of it is a click away, then
 * and after: a turn's thinking never shows unasked.
 */
export function Reasoning({
  took,
  source,
  summary,
  live = false,
  children,
  text,
  open,
  defaultOpen = false,
  onOpenChange,
}: ReasoningProps) {
  const t = { ...reasoningText, ...text }
  const [opened, setOpened] = useControlled(open, defaultOpen, onOpenChange)
  // A thought seen thinking changes its line as it goes, by a fade; one read later is still.
  const [watched, setWatched] = useState(live)
  if (live && !watched) setWatched(true)
  const words = source ?? ''
  const heading = live ? headingOf(words) : null
  const about = summary ?? (source === undefined ? '' : thoughtSummary(source))
  const label = live ? (heading ?? t.thinking) : took === undefined || took === '' ? t.thoughtBriefly : t.thought(took)
  return (
    <Disclosure
      open={opened}
      onOpenChange={setOpened}
      rhythm={Rhythm.Fold}
      busy={live}
      className={s.reasoning}
      data-live={live || undefined}
    >
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          <Icon name="think" size={12} />
          {/* What it is on, or how long it took: each comes in by a fade, not a flip. */}
          <span key={live ? `on:${label}` : 'done'} className={cx(s.label, live && s.shimmer, watched && s.relabelled)}>
            {label}
          </span>
          {!live && about !== '' && <span className={cx(s.about, watched && s.relabelled)}>{about}</span>}
          <Caret open={opened} />
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.body}>{source === undefined ? children : <Markdown source={source} streaming={live} className={s.words} />}</div>
      </Fold>
    </Disclosure>
  )
}
