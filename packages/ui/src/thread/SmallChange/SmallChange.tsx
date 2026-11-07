import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/Icon'
import { Rhythm } from '../../lib/rhythm'
import type { RootProps } from '../../lib/props'
import { AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './SmallChange.module.css'

/*
 * A small change's card in its thread (README section 6): what the one-step
 * path skipped, each step with its time, and Merge, which still asks. Make it
 * a full task has its review run before the merge instead of after; once it
 * has, the card folds to the line saying so.
 */

/** One step, as the runtime keeps it: what happened, when, and whether it has. */
export interface SmallChangeStep {
  readonly key: 'started' | 'changed' | 'checks' | 'merged' | 'review'
  readonly what: string
  readonly at: string | null
  readonly done: boolean
}

export interface SmallChangeText {
  kicker: string
  /** What the path skipped, after the model: "Sonnet 5.5, no plan, reviewed after it merges". */
  skipped: (model: string | null, skips: ReadonlyArray<string>) => string
  fullTask: string
  makeFullTask: string
  merge: string
  review: string
  failed: string
}

export const smallChangeText: SmallChangeText = {
  kicker: 'Small change',
  skipped: (model, skips) => [model, ...skips].filter((word) => word !== null && word !== '').join(', '),
  fullTask: 'Full task',
  makeFullTask: 'Make it a full task',
  merge: 'Merge',
  review: 'Its review',
  failed: 'Checks failed',
}

/** A time as a thread says it: the clock's hour and minute, nothing where there is no time. */
const when = (iso: string | null): string => {
  if (iso === null || Number.isNaN(new Date(iso).getTime())) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const DONE: IconName = 'check'

export type SmallChangeProps = RootProps<
  'div',
  {
    /** The task's title, which opens it. */
    title: string
    /** The model its lead runs on, as people know it: Sonnet 5.5. */
    model: string | null
    /** What the path left out, in short lines: no plan, reviewed after it merges. */
    skips: ReadonlyArray<string>
    steps: ReadonlyArray<SmallChangeStep>
    /** Its pull request, while one is open: its name and what its checks say. */
    change?: { readonly name: string; readonly state: 'open' | 'merged' | 'closed' } | null
    /** Where its review went, once there is one. */
    review?: { readonly title: string; readonly onOpen: () => void } | null
    /** The person made it a full task: the card folds to one line. */
    fullTask?: boolean
    /** Merge asks first, as every merge does; without it, no Merge. */
    onMerge?: () => void
    onMakeFullTask?: () => void
    onOpen?: () => void
    busy?: boolean
    text?: Partial<SmallChangeText>
  }
>

/** A small change: what it skipped, each step with its time, and Merge. */
export function SmallChange({
  title,
  model,
  skips,
  steps,
  change = null,
  review = null,
  fullTask = false,
  onMerge,
  onMakeFullTask,
  onOpen,
  busy = false,
  text,
  className,
  ...rest
}: SmallChangeProps) {
  const t = { ...smallChangeText, ...text }
  if (fullTask)
    return (
      <p className={s.full} data-rhythm={Rhythm.Fold} {...rest}>
        <Icon name={DONE} size={11} />
        <span className={s.fullWhat}>{t.fullTask}</span>
        {review !== null && <LinkButton onClick={review.onOpen}>{review.title}</LinkButton>}
      </p>
    )
  const named = onOpen ? (
    <LinkButton className={s.title} onClick={onOpen}>
      {title}
    </LinkButton>
  ) : (
    title
  )
  const open = change !== null && change.state === 'open'
  // Checks that failed stop Merge: its change isn't ready, whatever the person may still decide.
  const failed = steps.some((step) => !step.done && step.key === 'checks' && step.what === t.failed)
  return (
    <AskCard
      icon="after"
      kicker={t.kicker}
      quiet
      who={
        onMakeFullTask === undefined || !open ? undefined : (
          <LinkButton className={s.aside} onClick={onMakeFullTask} disabled={busy}>
            {t.makeFullTask}
          </LinkButton>
        )
      }
      className={className}
      data-rhythm={Rhythm.Card}
      {...rest}
    >
      <p className={s.what}>
        <span className={s.titleText}>{named}</span>
        <span className={s.skipped}>{t.skipped(model, skips)}</span>
      </p>
      <ol className={s.steps}>
        {steps.map((step) => {
          const failed = !step.done && step.key === 'checks' && step.what === t.failed
          return (
            <li key={step.key} data-done={step.done || undefined} data-failed={failed || undefined}>
              <span className={s.dot}>{step.done && <Icon name={DONE} size={9} />}</span>
              <span className={s.stepWhat}>{failed ? t.failed : step.what}</span>
              <span className={s.when}>{when(step.at)}</span>
            </li>
          )
        })}
      </ol>
      {review !== null && change !== null && change.state === 'merged' && (
        <AskNote>
          <LinkButton onClick={review.onOpen}>{review.title}</LinkButton>
        </AskNote>
      )}
      {open && !failed && onMerge !== undefined && (
        <AskFoot>
          <Button size="small" variant="signal" busy={busy} onClick={onMerge}>
            {t.merge}
          </Button>
        </AskFoot>
      )}
    </AskCard>
  )
}
