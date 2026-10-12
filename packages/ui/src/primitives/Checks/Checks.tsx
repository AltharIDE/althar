import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../Model/Model'
import { CheckState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { LiveDot } from '../LiveDot/LiveDot'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './Checks.module.css'

/*
 * What a change was checked by, in order: tests, reviews, anything a rule
 * added. A review names who did it. One running is cobalt, one held on your
 * call violet, one that failed red; the rest are ink.
 */

export interface ChangeCheck {
  id: string
  name: string
  state: CheckState
  /** What it found, or where it is: 216 passed, reading the diff · 6m. */
  detail?: string
  /** Who ran it, for a review. */
  by?: readonly ModelInfo[]
  /** A project rule added it. */
  added?: boolean
}

export interface ChecksText {
  state: Record<CheckState, string>
  added: string
}

export const checksText: ChecksText = {
  state: {
    [CheckState.Passed]: 'passed',
    [CheckState.Running]: 'running',
    [CheckState.Held]: 'held on your call',
    [CheckState.Queued]: 'queued',
    [CheckState.Failed]: 'failed',
  },
  added: 'by rule',
}

function Mark({ state }: { state: CheckState }) {
  switch (state) {
    case CheckState.Passed:
      return <Icon name="check" size={10} />
    case CheckState.Running:
      return <LiveDot ping />
    case CheckState.Held:
      return <span className={s.you} aria-hidden="true" />
    case CheckState.Failed:
      return <Icon name="close" size={10} />
    case CheckState.Queued:
      return null
    default:
      return unreachable(state)
  }
}

export interface ChecksProps {
  checks: readonly ChangeCheck[]
  className?: string
  text?: Partial<ChecksText>
}

export function Checks({ checks, className, text }: ChecksProps) {
  const t = { ...checksText, ...text }
  return (
    <ul className={cx(s.checks, className)}>
      {checks.map((c) => (
        <li key={c.id} className={cx(s.check, s[c.state])}>
          <span className={s.mark}>
            <Mark state={c.state} />
          </span>
          <span className={s.main}>
            <span className={s.name}>
              {c.name}
              <VisuallyHidden>, {t.state[c.state]}</VisuallyHidden>
              {c.by?.map((m) => (
                <Model key={m.id} model={m} short className={s.by} />
              ))}
              {c.added && (
                <span className={s.added}>
                  <Icon name="plus" size={9} />
                  {t.added}
                </span>
              )}
            </span>
            {c.detail && (
              <span className={s.detail} title={c.detail}>
                {c.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** How many passed, for a heading: 3 of 4. */
export const passedOf = (checks: readonly ChangeCheck[]) => checks.filter((c) => c.state === CheckState.Passed).length
