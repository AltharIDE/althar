import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import b from '../Board/Board.module.css'
import s from './AcceptCard.module.css'

/*
 * Finished work, waiting for you to accept it: the one step no rule takes
 * for you. The card is the change in brief: where each pull request goes,
 * how big it is, and whether the checks passed. Merging stays yours.
 */

export interface PullRequestBrief {
  /** The repository, without its owner: meridian-api. */
  repo: string
  number: number
  add: number
  del: number
}

export interface AcceptCardText {
  kind: string
  task: (task: string) => string
  number: (n: number) => string
  /** Ready means every check passed. */
  checks: (n: number) => string
  review: string
}

export const acceptCardText: AcceptCardText = {
  kind: 'Ready to accept',
  task: (task) => `Task ${task}`,
  number: (n) => `#${n}`,
  checks: (n) => (n === 1 ? '1 check passed' : `All ${n} checks passed`),
  review: 'Review',
}

export interface AcceptCardProps {
  task: string
  title: string
  /** One per repository it changes. */
  prs: readonly PullRequestBrief[]
  /** How many checks it passed: all of them, or it would not be ready. */
  checks: number
  /** When it became ready: 9m ago. */
  at?: string
  current?: boolean
  onOpen?: () => void
  text?: Partial<AcceptCardText>
}

export function AcceptCard({ task, title, prs, checks, at, current, onOpen, text }: AcceptCardProps) {
  const t = { ...acceptCardText, ...text }
  return (
    <article className={cx(b.card, s.accept)} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={s.kind}>{t.kind}</span>
        <span className={b.ref}>{t.task(task)}</span>
        {at && <span className={b.at}>{at}</span>}
      </div>
      <button type="button" className={cx(b.open, s.title)} onClick={onOpen}>
        {title}
      </button>
      <ul className={s.prs}>
        {prs.map((pr) => (
          <li key={`${pr.repo}${pr.number}`} className={s.pr}>
            <BrandMark brand={Brand.GitHub} size={12} />
            <span className={s.repo}>{pr.repo}</span>
            <span className={s.number}>{t.number(pr.number)}</span>
            <span className={s.delta}>
              <span className={s.add}>+{pr.add}</span>
              <span className={s.del}>−{pr.del}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className={b.foot}>
        <span className={s.checks}>
          <Icon name="check" size={11} />
          {t.checks(checks)}
        </span>
        <span className={cx(b.go, s.go)} aria-hidden="true">
          {t.review}
          <Icon name="arrow" size={11} />
        </span>
      </div>
    </article>
  )
}
