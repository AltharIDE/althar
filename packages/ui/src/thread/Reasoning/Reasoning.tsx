import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

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
  /**
   * It is thinking now: what it thinks shows as it streams, its last few
   * lines in a quiet window under its heading, and folds to its line when it
   * is done. Opened, all of it shows.
   */
  live?: boolean
  /** What it thought, where it isn't markdown. */
  children?: ReactNode
  text?: Partial<ReasoningText>
}

/**
 * What the model thought. While it thinks, the thinking streams in view,
 * quiet and capped to its last few lines, under what it says it is on (its
 * latest heading, as Codex titles each part, or Thinking). Done, it folds
 * to one line: how long it thought, and what about. All of it is a click
 * away, then and after.
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
  const body = useRef<HTMLDivElement>(null)
  // Its window shows the last lines; faded at the top only once there is more above them.
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    if (el.firstElementChild !== null) watch.observe(el.firstElementChild)
    return () => watch.disconnect()
  }, [])
  // A thought seen thinking changes its line as it goes, by a fade; one read later is still.
  const [watched, setWatched] = useState(live)
  if (live && !watched) setWatched(true)
  const words = source ?? ''
  const heading = live ? headingOf(words) : null
  const about = summary ?? (source === undefined ? '' : thoughtSummary(source))
  const label = live ? (heading ?? t.thinking) : took === undefined || took === '' ? t.thoughtBriefly : t.thought(took)
  return (
    <Disclosure
      open={live || opened}
      onOpenChange={() => setOpened(!opened)}
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
        <div ref={body} className={cx(s.body, !opened && s.glimpse, !opened && over && s.over)}>
          <div>{source === undefined ? children : <Markdown source={source} streaming={live} className={s.words} />}</div>
        </div>
      </Fold>
    </Disclosure>
  )
}
