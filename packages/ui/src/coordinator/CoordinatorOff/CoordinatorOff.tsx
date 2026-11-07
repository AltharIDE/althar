import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './CoordinatorOff.module.css'

/*
 * A project's Conversation while its coordinator is off (ADR-097): what
 * writing there does now, and the way to turn it on. In a conversation that
 * hasn't begun it stands in the middle, as an empty state; under one that
 * has, it closes it, so what the coordinator said before stays readable
 * above it.
 */

export interface CoordinatorOffText {
  off: (project: string) => string
  what: string
  turnOn: string
}

export const coordinatorOffText: CoordinatorOffText = {
  off: (project) => `The coordinator is off in ${project}.`,
  what: 'What you write here starts a task.',
  turnOn: 'Turn it on',
}

export type CoordinatorOffProps = RootProps<
  'div',
  {
    project: string
    /** Turns the coordinator on; without it, there is no link. */
    onTurnOn?: () => void
    /** Under a conversation that has begun, rather than in an empty one. */
    after?: boolean
    text?: Partial<CoordinatorOffText>
  }
>

export function CoordinatorOff({ project, onTurnOn, after = false, className, text, ...rest }: CoordinatorOffProps) {
  const t = { ...coordinatorOffText, ...text }
  return (
    <div className={cx(s.off, after && s.after, className)} {...rest}>
      <p className={s.head}>{t.off(project)}</p>
      <p className={s.what}>
        {t.what}
        {onTurnOn !== undefined && (
          <>
            {' '}
            <LinkButton onClick={onTurnOn}>{t.turnOn}</LinkButton>
          </>
        )}
      </p>
    </div>
  )
}
