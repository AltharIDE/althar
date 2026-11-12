import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Rhythm } from '../../lib/rhythm'
import { Disclosure, DisclosureTrigger, Fold, Unfold, type Disclosable } from '../../primitives/Fold/Fold'
import s from './WorkedFor.module.css'

export interface WorkedForText {
  took: (duration: string) => string
  /** While the turn runs: how long it has worked so far. */
  working: (duration: string) => string
}

export const workedForText: WorkedForText = { took: (d) => `Worked for ${d}`, working: (d) => `Working for ${d}` }

export interface WorkedForProps extends Disclosable {
  /** How long the turn took, or has taken so far. */
  took: string
  /**
   * Once it is over, the part of its time that took most, where one did:
   * "3m 10s waiting for a place", after how long it took. None where its
   * time was the agent's own work.
   */
  most?: string
  /** Once it is over, where all its time went, a few words each, what opening it shows first: "40s thinking and writing". */
  spent?: ReadonlyArray<string>
  /**
   * The turn is at work: its header counts, and under it stand what it has
   * said on the way and what it is doing now, until it answers or ends,
   * when they fold away under the header, as does its work where the person
   * opened it meanwhile.
   */
  live?: boolean
  /** While it works: what it has said on the way, in order, as it said it to the person. */
  said?: ReactNode
  /** While it works: what it is doing now, one line that changes in place (WorkNow). None while it writes. */
  now?: ReactNode
  /** Everything it did, in order: what the header opens to. Without it, the header doesn't open. */
  children?: ReactNode
  className?: string
  text?: Partial<WorkedForText>
}

/**
 * A turn's work, as Codex's app shows it. While the turn runs: one quiet
 * header, how long it has worked, a hairline under it; under that, what the
 * agent has said on the way, in its own words, and one quiet line for what it
 * is doing now, replaced in place as it moves on, never a list. Once it
 * answers, or ends, all of it folds away under the header, which says how
 * long it worked and opens to every step, thought and word of it. Its answer
 * stands under it, drawn by the host.
 */
export function WorkedFor({
  took,
  most,
  spent,
  live = false,
  said,
  now,
  children,
  className,
  text,
  open,
  defaultOpen = false,
  onOpenChange,
}: WorkedForProps) {
  const t = { ...workedForText, ...text }
  const [opened, setOpened] = useControlled(open, defaultOpen, onOpenChange)
  // Its work folds as it ends, opened to watch it or not; once over, it opens again on a click.
  const wasLive = useRef(live)
  useLayoutEffect(() => {
    if (wasLive.current && !live && opened) setOpened(false)
    wasLive.current = live
  }, [live, opened, setOpened])
  const where = !live && spent !== undefined && spent.length > 0 ? spent : undefined
  const opens = (children !== undefined && children !== null) || where !== undefined
  const head = (
    <>
      <span className={s.took}>{live ? t.working(took) : t.took(took)}</span>
      {!live && most !== undefined && <span className={s.most}>· {most}</span>}
      {opens && <Icon name="chevron" size={10} className={s.chevron} />}
    </>
  )
  const showing = (said !== undefined && said !== null) || (now !== undefined && now !== null)
  // Opened, every step shows, these among them; so they fold away while it is.
  const going = (
    <Unfold open={live && showing && !opened}>
      <div className={s.live}>
        {said}
        {now}
      </div>
    </Unfold>
  )
  if (!opens)
    return (
      <div className={cx(s.worked, className)} data-rhythm={Rhythm.Fold} data-state="closed" data-live={live || undefined}>
        <div className={s.head} aria-busy={live || undefined}>
          {head}
        </div>
        {going}
      </div>
    )
  return (
    <Disclosure
      open={opened}
      onOpenChange={setOpened}
      rhythm={Rhythm.Fold}
      className={cx(s.worked, className)}
      data-live={live || undefined}
    >
      <DisclosureTrigger>
        <button type="button" className={s.head} aria-busy={live || undefined}>
          {head}
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.trail}>
          {where !== undefined && <p className={s.spent}>{where.join(' · ')}</p>}
          {children}
        </div>
      </Fold>
      {going}
    </Disclosure>
  )
}

export interface WorkNowProps {
  /** What kind of step it is, as its row in the work shows it: a file read, a search, a command. None for thinking. */
  icon?: IconName
  /** The step, in a few words: "Reading MEMORY.md", "Thinking". */
  children: string
}

/**
 * What a turn is doing now, under what it has said: one quiet line, its
 * words shimmering, replaced in place by the next step, never kept.
 */
export function WorkNow({ icon, children }: WorkNowProps) {
  return (
    <p className={s.now} title={children}>
      {icon !== undefined && <Icon name={icon} size={12} className={s.icon} />}
      {/* each step comes in by a fade, not a flip */}
      <span key={children} className={s.doing}>
        {children}
      </span>
    </p>
  )
}
