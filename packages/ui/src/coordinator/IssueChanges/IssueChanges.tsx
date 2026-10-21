import { useId, useRef } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { IssueChangesState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useRefocus } from '../../lib/refocus'
import { Rhythm } from '../../lib/rhythm'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './IssueChanges.module.css'

/*
 * Changes to issues on your trackers, as a card in the thread of whoever
 * proposed them: the coordinator, a task's lead, or Althar as a task's pull
 * request opened or merged. Nothing changes on the tracker until you apply
 * it; you can discard it instead. Several issues share one card. Where not
 * all of it applied, each issue says why and applying it again tries what
 * didn't. Applied, by you or at once (a comment, a link, or a project that
 * lets changes through), or discarded, it folds to a line.
 */

/** One thing changed on an issue: its status, closing it, its priority, assignee, project or title; labels added and taken off; a comment; a link. */
export type IssueChange =
  | {
      field: 'status' | 'close' | 'priority' | 'assignee' | 'project' | 'title' | 'comment' | 'link'
      /** The status, priority, assignee, project or title it changes to (null for none); the comment's text; the link. */
      to: string | null
    }
  | { field: 'labels'; add: readonly string[]; remove: readonly string[] }

export interface IssueChangesIssue {
  /** The tracker's mark and name: Brand.Linear, 'Linear'. */
  mark: Brand
  source: string
  key: string
  href: string
  title: string
  changes: readonly IssueChange[]
  /** Applied, or not; unset until it was tried. */
  applied?: boolean | null
  /** Why it didn't apply. */
  error?: string
}

export interface IssueChangesText {
  /** What it is and where: Issue changes · Linear. */
  kicker: (sources: readonly string[]) => string
  /** A change, in a few words: Status → Done, Labels +perf −bug. */
  change: (change: IssueChange) => string
  /** Beside the buttons, until it is applied. */
  note: string
  applying: string
  /** Beside the buttons, where not all of it applied. */
  failed: string
  /** On an issue that applied, while others didn't. */
  appliedOne: string
  discard: string
  apply: string
  applyAgain: string
  /** Before the issues, once applied. */
  changed: string
  commented: string
  linked: string
  discarded: string
  /** Read after a link that opens a new tab. */
  newTab: string
}

const CHANGE_WORDS = {
  status: (to: string | null) => `Status → ${to ?? 'none'}`,
  close: () => 'Close',
  priority: (to: string | null) => `Priority → ${to ?? 'none'}`,
  assignee: (to: string | null) => (to === null ? 'Unassign' : `Assignee → ${to}`),
  project: (to: string | null) => (to === null ? 'Out of its project' : `Project → ${to}`),
  title: (to: string | null) => `Title → “${to ?? ''}”`,
  comment: () => 'Comment',
  link: () => 'Link the pull request',
}

export const issueChangesText: IssueChangesText = {
  kicker: (sources) => (sources.length === 0 ? 'Issue changes' : `Issue changes · ${sources.join(', ')}`),
  change: (change) =>
    change.field === 'labels'
      ? `Labels ${[...change.add.map((label) => `+${label}`), ...change.remove.map((label) => `−${label}`)].join(' ')}`
      : CHANGE_WORDS[change.field](change.to),
  note: 'Nothing changes until you apply it.',
  applying: 'Applying…',
  failed: 'Not all of it applied.',
  appliedOne: 'Applied',
  discard: 'Discard',
  apply: 'Apply',
  applyAgain: 'Apply again',
  changed: 'Changed',
  commented: 'Commented on',
  linked: 'Linked the pull request to',
  discarded: 'Issue changes discarded',
  newTab: '(opens in a new tab)',
}

export type IssueChangesProps = RootProps<
  'article',
  {
    issues: readonly IssueChangesIssue[]
    /** Why, in a sentence, where whoever proposed it said: PR #212 opened. */
    note?: string
    state: IssueChangesState
    onApply?: () => void
    onDiscard?: () => void
    text?: Partial<IssueChangesText>
  }
>

export function IssueChanges({ issues, note, state, onApply, onDiscard, text, ref, className, ...rest }: IssueChangesProps) {
  const t = { ...issueChangesText, ...text }
  /* when it folds under the button you pressed, focus goes to the line it folds to */
  const line = useRef<HTMLElement>(null)
  useRefocus(state !== IssueChangesState.Applied && state !== IssueChangesState.Discarded, line)
  const setLine = (node: HTMLElement | null) => {
    line.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  const [first] = issues
  switch (state) {
    case IssueChangesState.Applied:
    case IssueChangesState.Discarded: {
      const only = first?.changes.length === 1 && issues.length === 1 ? first.changes[0] : undefined
      const said =
        state === IssueChangesState.Discarded
          ? t.discarded
          : only?.field === 'comment'
            ? t.commented
            : only?.field === 'link'
              ? t.linked
              : t.changed
      return (
        <article ref={setLine} tabIndex={-1} className={cx(s.line, className)} data-rhythm={Rhythm.Fold} {...rest}>
          {first && <BrandMark brand={first.mark} size={12} className={s.lineMark} />}
          <span className={s.said}>{said}</span>
          <span className={cx(s.lineWhat, state === IssueChangesState.Discarded && s.struck)}>
            {issues.map((issue, index) => (
              <span key={`${issue.source}:${issue.key}`} className={s.lineIssue}>
                {index > 0 && <span className={s.sep}> · </span>}
                <Key issue={issue} t={t} />{' '}
                {only?.field === 'comment' ? (
                  <span className={s.quote}>{only.to}</span>
                ) : only?.field === 'link' ? null : (
                  issue.changes.map(t.change).join(', ')
                )}
              </span>
            ))}
          </span>
        </article>
      )
    }
    case IssueChangesState.Pending:
    case IssueChangesState.Applying:
    case IssueChangesState.Failed:
      return (
        <Card root={{ ...rest, ref, className }} issues={issues} note={note} state={state} onApply={onApply} onDiscard={onDiscard} t={t} />
      )
    default:
      return unreachable(state)
  }
}

/** An issue's key, linked to it where it has an address. */
function Key({ issue, t }: { issue: IssueChangesIssue; t: IssueChangesText }) {
  const href = safeHref(issue.href)
  return href ? (
    <a className={s.key} href={href} target="_blank" rel="noreferrer">
      {issue.key}
      <VisuallyHidden> {t.newTab}</VisuallyHidden>
    </a>
  ) : (
    <span className={s.key}>{issue.key}</span>
  )
}

interface CardProps {
  root: RootProps<'article', object>
  issues: readonly IssueChangesIssue[]
  note: string | undefined
  state: IssueChangesState
  onApply: (() => void) | undefined
  onDiscard: (() => void) | undefined
  t: IssueChangesText
}

/** The changes before they apply: each issue and what changes on it, and the buttons that apply them or throw them away. */
function Card({ root, issues, note, state, onApply, onDiscard, t }: CardProps) {
  const { className, ...rest } = root
  const kickerId = useId()
  const applying = state === IssueChangesState.Applying
  const failed = state === IssueChangesState.Failed
  const sources = [...new Set(issues.map((issue) => issue.source))]
  return (
    <article aria-labelledby={kickerId} className={cx(s.card, className)} data-rhythm={Rhythm.Card} {...rest}>
      <div className={s.head}>
        <span className={s.kicker} id={kickerId}>
          {issues[0] && <BrandMark brand={issues[0].mark} size={11} className={s.mark} />}
          {t.kicker(sources)}
        </span>
        {note && <p className={s.why}>{note}</p>}
      </div>
      <ul className={s.issues}>
        {issues.map((issue) => {
          const comment = issue.changes.find((change) => change.field === 'comment')
          const rest = issue.changes.filter((change) => change.field !== 'comment')
          return (
            <li key={`${issue.source}:${issue.key}`} className={s.issue}>
              <div className={s.which}>
                <Key issue={issue} t={t} />
                <span className={s.issueTitle}>{issue.title}</span>
              </div>
              {rest.length > 0 && <p className={s.changes}>{rest.map(t.change).join(' · ')}</p>}
              {comment?.field === 'comment' && <p className={s.comment}>{comment.to}</p>}
              {failed && issue.applied === true && <p className={s.done}>{t.appliedOne}</p>}
              {failed && issue.applied === false && issue.error && <p className={s.error}>{issue.error}</p>}
            </li>
          )
        })}
      </ul>
      <div className={s.foot}>
        <span className={cx(s.note, failed && s.noteFailed)} aria-live="polite">
          {applying ? t.applying : failed ? t.failed : t.note}
        </span>
        {onDiscard && !applying && (
          <Button variant="quiet" onClick={onDiscard}>
            {t.discard}
          </Button>
        )}
        {onApply && (
          <Button variant="signal" busy={applying} onClick={onApply}>
            {failed ? t.applyAgain : t.apply}
          </Button>
        )}
      </div>
    </article>
  )
}
