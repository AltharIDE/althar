import { useEffect, useState } from 'react'

import { cssVars } from '../../../lib/cssVars'
import { cx } from '../../../lib/cx'
import { reducedMotion } from '../../../lib/motion'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { clock, Phase, type Checkpoint } from '../model'
import s from './Clock.module.css'

/*
 * The checkpoint's clock, as the plan card draws its own: a ring that
 * empties, the time in figures that hold still, and a bar running down a
 * foot. Unlike the plan's, it is kept by Althar, not by the screen: a
 * checkpoint nobody looked at still passes, because the point is that the
 * work doesn't wait on you. What it assumed stays where you'll see it later.
 *
 * With less motion asked for, nothing ticks: it says when it carries on.
 */

export interface ClockText {
  continuesIn: (time: string) => string
  /** With less motion: when it carries on, rather than a clock that ticks. */
  continuesAt: (at: string) => string
  /** A correction is being written, so the clock waits. */
  paused: string
  held: string
  /** Said once to a screen reader when the checkpoint is first shown. */
  announce: (time: string) => string
  time: (seconds: number) => string
}

export const clockText: ClockText = {
  continuesIn: (time) => `Continues in ${time}`,
  continuesAt: (at) => `Continues at ${at}`,
  paused: 'Paused while you write',
  held: 'Held. Continues when you say',
  announce: (time) => `The lead carries on by itself in ${time} unless you correct something. Hold it to take your time.`,
  time: clock,
}

/** Whether the clock ticks: not where less motion was asked for, or where a story shows that. */
export const ticks = (still?: boolean) => !(still ?? reducedMotion())

/** The time left as a ring that empties. Decoration: the words beside it say it. */
export function Ring({ share, size = 14, className }: { share: number; size?: number; className?: string }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg className={cx(s.ring, className)} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="8" cy="8" r={r} className={s.ringBg} />
      <circle cx="8" cy="8" r={r} className={s.ringFg} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - share) }} />
    </svg>
  )
}

/** The time left as a bar running down the bottom edge of what holds it, which is positioned. */
export function Bar({ share }: { share: number }) {
  return <i className={s.bar} style={cssVars({ '--left': share })} aria-hidden="true" />
}

export interface WhenProps {
  checkpoint: Checkpoint
  /** The whole wait, in seconds. */
  wait: number
  /** When it carries on, for the still clock: 11:06. */
  due: string
  still?: boolean
  /** Say once that it carries on by itself. One place says it: the thread, not the board as well. */
  announce?: boolean
  className?: string
  text?: Partial<ClockText>
}

/** The clock's words: the time left, when it carries on, or why it isn't counting. */
export function When({ checkpoint: c, wait, due, still, announce = false, className, text }: WhenProps) {
  const t = { ...clockText, ...text }
  const said = (() => {
    if (c.phase === Phase.Held) return t.held
    if (c.correcting !== undefined) return t.paused
    return ticks(still) ? t.continuesIn(t.time(c.left)) : t.continuesAt(due)
  })()
  return (
    <span className={cx(s.when, className)}>
      {said}
      {announce && c.phase === Phase.Open && <Announce said={t.announce(t.time(wait))} />}
    </span>
  )
}

/** Something counting down is said once, when it is first shown, not every tick. */
export function Announce({ said }: { said: string }) {
  const [shown, setShown] = useState(false)
  /* the region is on the page, empty, a moment before it speaks, or it isn't heard */
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 50)
    return () => window.clearTimeout(id)
  }, [])
  return <span aria-live="polite">{shown && <VisuallyHidden>{said}</VisuallyHidden>}</span>
}

/** How much of the wait is left, from 0 to 1. */
export const shareOf = (c: Checkpoint, wait: number) => Math.min(1, Math.max(0, c.left / wait))

/** Whether the clock is running: open, nothing being written, and not held. */
export const counting = (c: Checkpoint) => c.phase === Phase.Open && c.correcting === undefined
