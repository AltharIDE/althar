import type { ReactElement, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { AskCard } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import s from './SmallChange.module.css'

/*
 * A small change's card, where its thread opens (docs/decisions/reviews.md,
 * "A small change is reviewed after it merges"): its route as four stops,
 * Change, Checks, Merge and Review, each with its time or where it stands.
 * The review is a stop like the others: drawn dashed while it waits for the
 * merge, moved before Merge where it was made a full task, and left off
 * where no review follows. Pressing it changes which, until it merges. What
 * a small change is waits behind its name; what its review found, in the
 * thread, behind See findings.
 */

/** When its review reads it: after the merge, before it (a full task), or not at all. */
export type SmallChangeReviewWhen = 'after' | 'before' | 'none'

export interface SmallChangeChecks {
  /** `none`: its repository runs none. */
  readonly state: 'waiting' | 'running' | 'passed' | 'failed' | 'none'
  readonly passed: number
  readonly total: number
  /** The first that failed, by name. */
  readonly failing: string | null
  readonly at: string | null
}

export interface SmallChangeMerge {
  readonly state: 'waiting' | 'ready' | 'merging' | 'queued' | 'merged'
  readonly at: string | null
}

export interface SmallChangeReview {
  readonly when: SmallChangeReviewWhen
  /** `quiet`: it found only what its project's rule keeps in the thread; `found`: what it found waits on the person. */
  readonly state: 'waiting' | 'running' | 'clear' | 'quiet' | 'found' | 'fixing' | 'left' | 'stopped'
  readonly findings: number
  readonly at: string | null
}

export interface SmallChangeText {
  kicker: string
  fullTask: string
  change: string
  checks: string
  merge: string
  review: string
  started: (at: string) => string
  checksRunning: (passed: number, total: number) => string
  checksPassed: string
  checksFailed: (name: string | null) => string
  checksNone: string
  ready: string
  merging: string
  queued: string
  afterMerge: string
  beforeMerge: string
  reviewing: string
  clear: string
  quiet: string
  found: (count: number) => string
  fixing: string
  left: (count: number) => string
  stopped: string
  addReview: string
  seeFindings: string
  choices: string
  before: string
  beforeNote: string
  after: string
  none: string
}

export const smallChangeText: SmallChangeText = {
  kicker: 'Small change',
  fullTask: 'Full task',
  change: 'Change',
  checks: 'Checks',
  merge: 'Merge',
  review: 'Review',
  started: (at) => `Started ${at}`,
  checksRunning: (passed, total) => `${passed} of ${total}`,
  checksPassed: 'Passed',
  checksFailed: (name) => (name === null ? 'Failed' : `${name} failed`),
  checksNone: 'None',
  ready: 'Ready',
  merging: 'Merging',
  queued: 'In the queue',
  afterMerge: 'After merge',
  beforeMerge: 'Before merge',
  reviewing: 'Reading',
  clear: 'Nothing found',
  quiet: 'Nothing major',
  found: (count) => `${count} found`,
  fixing: 'Being fixed',
  left: (count) => `${count} left as is`,
  stopped: 'Stopped',
  addReview: 'Review',
  seeFindings: 'See findings',
  choices: 'Review',
  before: 'Before it merges',
  beforeNote: 'Makes it a full task',
  after: 'After it merges',
  none: 'No review',
}

/** A time as a thread says it: the clock's hour and minute, nothing where there is no time. */
const when = (iso: string | null): string => {
  if (iso === null || Number.isNaN(new Date(iso).getTime())) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
const joined = (...parts: ReadonlyArray<string | null>) => parts.filter((part) => part !== null && part !== '').join(' · ')

type At = 'done' | 'now' | 'todo' | 'failed' | 'found'

/** Where a stop stands, and the line under its name. */
const at = (sub: ReactNode, where: At, later = false) => ({ sub, at: where, ...(later ? { later } : {}) })

interface Stop {
  readonly key: 'change' | 'checks' | 'merge' | 'review'
  readonly what: ReactNode
  readonly sub: ReactNode
  readonly at: At
  /** Waits for the merge: drawn dashed, with the track to it. */
  readonly later?: boolean
}

export type SmallChangeProps = RootProps<
  'div',
  {
    /** The task's title, which opens it. */
    title: string
    started: string
    /** What it changed, once its lead reported: "6 files", "1 line in RunMenu.tsx". */
    changed: { readonly at: string | null; readonly words: string | null }
    checks: SmallChangeChecks
    merge: SmallChangeMerge
    review: SmallChangeReview
    /** What a small change is, behind its name. */
    explain?: ReactNode
    onOpen?: () => void
    /** Merge asks first, as every merge does; offered once it is ready. */
    onMerge?: () => void
    /** Changes when its review reads it, until it merges: before it makes it a full task. Without it, the stop is no button. */
    onReview?: (when: SmallChangeReviewWhen) => void
    /** Takes the person to what its review found, in the thread. */
    onFindings?: () => void
    /** Opens the review a full task was given, its own task. */
    onOpenReview?: () => void
    busy?: boolean
    text?: Partial<SmallChangeText>
  }
>

/** A small change's route: its stops in a row, with Merge, and its review one of them. */
export function SmallChange({
  title,
  started,
  changed,
  checks,
  merge,
  review,
  explain,
  onOpen,
  onMerge,
  onReview,
  onFindings,
  onOpenReview,
  busy = false,
  text,
  className,
  ...rest
}: SmallChangeProps) {
  const t = { ...smallChangeText, ...text }
  const merged = merge.state === 'merged'
  const full = review.when === 'before'
  // Until it merges, its review can still move or go: before the merge, that is, where checks don't hold it either.
  const choosing = onReview !== undefined && !full && (merge.state === 'waiting' || merge.state === 'ready')
  const menu = (trigger: ReactElement) =>
    onReview === undefined ? (
      trigger
    ) : (
      <Menu label={t.choices} width={240} align="end" trigger={trigger}>
        <MenuRadioGroup label={t.choices} value={review.when} onChange={(value) => onReview(value as SmallChangeReviewWhen)}>
          <MenuRadioItem value="before" description={t.beforeNote}>
            {t.before}
          </MenuRadioItem>
          <MenuRadioItem value="after">{t.after}</MenuRadioItem>
          <MenuRadioItem value="none">{t.none}</MenuRadioItem>
        </MenuRadioGroup>
      </Menu>
    )

  const changeStop: Stop =
    changed.at === null
      ? { key: 'change', what: t.change, ...at(t.started(when(started)), 'now') }
      : { key: 'change', what: t.change, ...at(joined(changed.words, when(changed.at)), 'done') }
  const checksStop: Stop = {
    key: 'checks',
    what: t.checks,
    ...(checks.state === 'waiting'
      ? at(null, changed.at === null ? 'todo' : 'now')
      : checks.state === 'running'
        ? at(t.checksRunning(checks.passed, checks.total), 'now')
        : checks.state === 'failed'
          ? at(t.checksFailed(checks.failing), 'failed')
          : checks.state === 'none'
            ? at(t.checksNone, 'done')
            : at(joined(t.checksPassed, when(checks.at)), 'done')),
  }
  const mergeStop: Stop = {
    key: 'merge',
    what: t.merge,
    ...(merged
      ? at(when(merge.at), 'done')
      : merge.state === 'ready'
        ? at(t.ready, 'now')
        : merge.state === 'merging'
          ? at(t.merging, 'now')
          : merge.state === 'queued'
            ? at(t.queued, 'now')
            : at(null, 'todo')),
  }
  const reviewName = choosing ? (
    menu(<LinkButton className={s.choose}>{t.review}</LinkButton>)
  ) : full && onOpenReview !== undefined ? (
    <LinkButton className={s.choose} onClick={onOpenReview}>
      {t.review}
    </LinkButton>
  ) : (
    t.review
  )
  const reviewStop: Stop = {
    key: 'review',
    what: reviewName,
    ...(review.state === 'running'
      ? at(t.reviewing, 'now')
      : review.state === 'clear'
        ? at(t.clear, 'done')
        : review.state === 'quiet'
          ? at(t.quiet, 'done')
          : review.state === 'found'
            ? at(t.found(review.findings), 'found')
            : review.state === 'fixing'
              ? at(t.fixing, 'now')
              : review.state === 'left'
                ? at(t.left(review.findings), 'done')
                : review.state === 'stopped'
                  ? at(t.stopped, 'todo')
                  : full
                    ? at(t.beforeMerge, 'todo')
                    : at(t.afterMerge, 'todo', true)),
  }
  const stops =
    review.when === 'none'
      ? [changeStop, checksStop, mergeStop]
      : full
        ? [changeStop, checksStop, reviewStop, mergeStop]
        : [changeStop, checksStop, mergeStop, reviewStop]
  const adding = choosing && review.when === 'none'
  const columns = { gridTemplateColumns: `repeat(${stops.length + (adding ? 1 : 0)}, minmax(0, 1fr))` }
  const under = (key: Stop['key']) => ({ gridColumn: stops.findIndex((stop) => stop.key === key) + 1 })
  const ready = merge.state === 'ready' || merge.state === 'merging'
  const found = review.state === 'found' && onFindings !== undefined
  const kicker = full ? t.fullTask : t.kicker

  return (
    <AskCard
      icon="after"
      kicker={
        explain === undefined ? (
          kicker
        ) : (
          <HoverCard card={<div className={s.explain}>{explain}</div>} width={280} placement="below">
            <span tabIndex={0} className={s.named}>
              {kicker}
            </span>
          </HoverCard>
        )
      }
      quiet
      className={className === undefined ? s.card : `${s.card} ${className}`}
      data-rhythm={Rhythm.Card}
      {...rest}
    >
      <p className={s.title}>
        {onOpen ? (
          <LinkButton className={s.titleLink} onClick={onOpen}>
            {title}
          </LinkButton>
        ) : (
          title
        )}
      </p>
      <ol className={s.route} style={columns}>
        {stops.map((stop) => (
          <li key={stop.key} className={s.stop} data-at={stop.at} data-later={stop.later || undefined}>
            <span className={s.knot} aria-hidden="true">
              {stop.at === 'done' && <Icon name="check" size={9} />}
              {stop.at === 'failed' && <Icon name="close" size={9} />}
              {stop.at === 'found' && review.findings < 10 && review.findings}
            </span>
            <span className={s.what}>{stop.what}</span>
            {stop.sub !== null && stop.sub !== '' && (
              <span className={s.sub} title={typeof stop.sub === 'string' ? stop.sub : undefined}>
                {stop.sub}
              </span>
            )}
          </li>
        ))}
        {adding && (
          <li className={s.add}>
            {menu(
              <LinkButton className={s.choose}>
                <Icon name="plus" size={10} />
                {t.addReview}
              </LinkButton>,
            )}
          </li>
        )}
      </ol>
      {/* What waits on the person sits under its stop: Merge under Merge, See findings under Review. */}
      {ready && onMerge !== undefined ? (
        <div className={s.foot} style={columns}>
          <Button
            size="small"
            variant="signal"
            className={s.act}
            style={under('merge')}
            busy={busy || merge.state === 'merging'}
            onClick={onMerge}
          >
            {t.merge}
          </Button>
        </div>
      ) : found ? (
        <div className={s.foot} style={columns}>
          <Button size="small" variant="quiet" trailingIcon="arrow" className={s.to} style={under('review')} onClick={onFindings}>
            {t.seeFindings}
          </Button>
        </div>
      ) : null}
    </AskCard>
  )
}
