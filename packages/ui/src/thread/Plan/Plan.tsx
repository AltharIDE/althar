import { Icon } from '../../foundations/Icon/Icon'
import { PlanState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Plan.module.css'

export interface PlanStep {
  id: string
  label: string
  state: PlanState
}

export interface PlanText {
  title: string
  progress: (done: number, total: number) => string
  updated: (when: string) => string
  /** Each entry's state, read after it. */
  state: Record<PlanState, string>
}

export const planText: PlanText = {
  title: 'Plan',
  progress: (done, total) => `${done} of ${total}`,
  updated: (when) => `updated ${when}`,
  state: { [PlanState.Done]: 'done', [PlanState.Running]: 'in progress', [PlanState.Queued]: 'to do' },
}

export type PlanProps = RootProps<
  'section',
  {
    steps: readonly PlanStep[]
    /** When it last changed. */
    updated?: string
    text?: Partial<PlanText>
  }
>

function Mark({ state }: { state: PlanState }) {
  switch (state) {
    case PlanState.Done:
      return <Icon name="check" size={10} />
    case PlanState.Running:
      return <Spinner size="small" />
    case PlanState.Queued:
      return null
    default:
      return unreachable(state)
  }
}

/**
 * ACP sends the whole plan each time it changes, so the plan is one card
 * that updates in place, not a new message per change.
 */
export function Plan({ steps, updated, text, className, ...rest }: PlanProps) {
  const t = { ...planText, ...text }
  const done = steps.filter((x) => x.state === PlanState.Done).length
  return (
    <section className={cx(s.plan, className)} aria-label={t.title} {...rest}>
      <div className={s.head}>
        <Icon name="list" size={12} />
        {t.title}
        <span className={s.n}>
          {t.progress(done, steps.length)}
          {updated && ` · ${t.updated(updated)}`}
        </span>
      </div>
      <ol className={s.list}>
        {steps.map((x) => (
          <li key={x.id} className={cx(s.item, s[x.state])}>
            <span className={s.mark}>
              <Mark state={x.state} />
            </span>
            <span className={s.text}>{x.label}</span>
            <VisuallyHidden>, {t.state[x.state]}</VisuallyHidden>
          </li>
        ))}
      </ol>
    </section>
  )
}
