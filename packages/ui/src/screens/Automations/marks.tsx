import { Icon } from '../../foundations/Icon/Icon'
import { AutomationRunState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './Automations.module.css'

/*
 * The small pieces the Automations tab and an automation's page share: its
 * mark in a round chip, and its runs as marks, each in the colour of what
 * came of it. Internal to these screens.
 */

/** Where an automation stands, as its colour says it: violet where it waits on you, cobalt while it runs, quiet once paused. */
export type AutomationTone = 'yours' | 'paused' | 'live' | 'quiet'

/** One run, as its mark and its line show it. */
export interface AutomationRunMark {
  id: string
  state: AutomationRunState
  /** When, as the person reads it: Today 9:00, Mon 2:00. */
  at: string
  /** What came of it, in a line. */
  words: string
}

const TONES: Readonly<Record<AutomationTone, string | undefined>> = {
  yours: s.chipYours,
  paused: s.chipPaused,
  live: s.chipLive,
  quiet: undefined,
}

/** Its mark in a round chip: a clock for a schedule; paused, the pause; a live dot while a run runs. */
export function AutomationChip({ tone, paused, size = 28 }: { tone: AutomationTone; paused: boolean; size?: number }) {
  const glyph = size >= 36 ? 16 : 13
  return (
    <span className={cx(s.chip, TONES[tone])} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={paused ? 'hold' : 'clock'} size={glyph} />
      {tone === 'live' && (
        <span className={s.chipDot}>
          <LiveDot pulse />
        </span>
      )}
    </span>
  )
}

const MARKS: Readonly<Record<AutomationRunState, string | undefined>> = {
  [AutomationRunState.Made]: s.markMade,
  [AutomationRunState.Nothing]: s.markNothing,
  [AutomationRunState.Failed]: s.markFailed,
  [AutomationRunState.Missed]: s.markMissed,
  [AutomationRunState.Skipped]: s.markSkipped,
  [AutomationRunState.Running]: s.markRunning,
  [AutomationRunState.Starting]: s.markRunning,
}

/** A run's mark: dark where it made something, light where there was nothing to do, red where it failed, an amber ring where the Mac slept through it, cobalt while it runs. */
export function RunMark({ state, className }: { state: AutomationRunState; className?: string }) {
  return <i className={cx(s.mark, MARKS[state], className)} aria-hidden="true" />
}

/** Its last runs as marks, oldest on the left, each saying when and what came of it on hover and focus. */
export function RunMarks({
  runs,
  count = 7,
  label,
  mark,
}: {
  runs: readonly AutomationRunMark[]
  count?: number
  /** The marks' name, for a screen reader. */
  label: (n: number) => string
  /** A mark's words: when, and what came of it. */
  mark: (at: string, words: string) => string
}) {
  const shown = runs.slice(0, count).toReversed()
  return (
    <span className={s.marks} role="list" aria-label={label(shown.length)}>
      {Array.from({ length: Math.max(0, count - shown.length) }, (_, i) => (
        <i key={`none${i}`} className={cx(s.mark, s.markNone)} aria-hidden="true" />
      ))}
      {shown.map((run) => (
        <Tooltip key={run.id} label={mark(run.at, run.words)}>
          <i className={cx(s.mark, MARKS[run.state])} role="listitem" tabIndex={0} aria-label={mark(run.at, run.words)} />
        </Tooltip>
      ))}
    </span>
  )
}
