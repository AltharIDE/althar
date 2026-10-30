import type { CodeHost } from '../../foundations/codeHost'
import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { NextStep, NextSteps } from '../../primitives/NextStep/NextStep'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import { BranchChip, PullChip } from '../BoardCard/Chips'
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
  /** Its lines added and deleted, where the host counts them. */
  add?: number
  del?: number
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
  /** Why it needs you before it can be accepted, such as a conflict its lead couldn't resolve: a line under the title. */
  note?: string
  current?: boolean
  onOpen?: () => void
  text?: Partial<AcceptCardText>
}

export function AcceptCard({ task, title, prs = [], host, branch, checks, at, note, current, onOpen, text }: AcceptCardProps) {
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
      {note && <p className={s.note}>{note}</p>}
      <ul className={s.prs}>
        {prs.map((pr) => (
          <li key={`${pr.repo}${pr.number}`}>
            <PullChip
              {...(host === undefined ? {} : { host })}
              repo={pr.repo}
              number={pr.number}
              // A host that doesn't count lines shows no size, rather than half of one.
              {...(pr.add !== undefined && pr.del !== undefined ? { add: pr.add, del: pr.del } : {})}
              text={{ number: t.number }}
            />
          </li>
        ))}
        {branch && (
          <li>
            <BranchChip name={branch.name} add={branch.add} del={branch.del} />
          </li>
        )}
      </ul>
      {checks !== undefined && (
        <div className={b.foot}>
          <span className={s.checks}>
            {checks > 0 && <Icon name="check" size={11} />}
            {t.checks(checks)}
          </span>
        </div>
      )}
      <NextSteps className={b.strip} aria-hidden="true">
        <NextStep signal>{t.review}</NextStep>
      </NextSteps>
    </article>
  )
}
