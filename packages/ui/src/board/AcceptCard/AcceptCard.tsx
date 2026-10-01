import type { CodeHost } from '../../foundations/codeHost'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './AcceptCard.module.css'

/*
 * Finished work, waiting for you to accept it: the one step no rule takes
 * for you. The card is the change in brief: where each pull request goes,
 * how big it is, and whether the checks passed; or, for work with no pull
 * request, its branch and how big it is. Merging stays yours.
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
  /** Ready means every check passed; with none, none ran. */
  checks: (n: number) => string
  review: string
}

export const acceptCardText: AcceptCardText = {
  kind: 'Ready to accept',
  task: (task) => `Task ${task}`,
  number: (n) => `#${n}`,
  checks: (n) => (n === 0 ? 'No checks ran' : n === 1 ? '1 check passed' : `All ${n} checks passed`),
  review: 'Review',
}

/** Work with no pull request: its branch, and how big its change is. */
export interface BranchBrief {
  name: string
  add: number
  del: number
}

export interface AcceptCardProps {
  task: string
  title: string
  /** One per repository it changes. */
  prs?: readonly PullRequestBrief[]
  /** Where the pull requests live; its mark shows beside each. */
  host?: CodeHost
  /** Its branch, for work with no pull request. */
  branch?: BranchBrief
  /** How many checks it passed: all of them, or it would not be ready. Without pull requests, none are said. */
  checks?: number
  /** When it became ready: 9m ago. */
  at?: string
  current?: boolean
  onOpen?: () => void
  text?: Partial<AcceptCardText>
}

export function AcceptCard({ task, title, prs = [], host, branch, checks, at, current, onOpen, text }: AcceptCardProps) {
  const t = { ...acceptCardText, ...text }
  return (
    <article className={cx(b.card, s.accept)} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={s.kind}>{t.kind}</span>
        <span className={b.ref}>{t.task(task)}</span>
        {at && <span className={b.at}>{at}</span>}
      </div>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      <ul className={s.prs}>
        {prs.map((pr) => (
          <li key={`${pr.repo}${pr.number}`} className={s.pr}>
            {host?.brand && <BrandMark brand={host.brand} size={12} />}
            <span className={s.repo}>{pr.repo}</span>
            <span className={s.number}>{t.number(pr.number)}</span>
            <Delta add={pr.add} del={pr.del} className={s.delta} />
          </li>
        ))}
        {branch && (
          <li className={s.pr}>
            <Icon name="branch" size={12} />
            <span className={s.repo}>{branch.name}</span>
            <Delta add={branch.add} del={branch.del} className={s.delta} />
          </li>
        )}
      </ul>
      <div className={b.foot}>
        {checks !== undefined && (
          <span className={s.checks}>
            {checks > 0 && <Icon name="check" size={11} />}
            {t.checks(checks)}
          </span>
        )}
        <span className={cx(b.go, s.go)} aria-hidden="true">
          {t.review}
          <Icon name="arrow" size={11} />
        </span>
      </div>
    </article>
  )
}
