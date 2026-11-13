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
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './IssueChanges.module.css'

/*
 * Changes to issues on your trackers, as a card in the thread of whoever
 * proposed them: the coordinator, a task's lead, or Althar as a task's pull
 * request opened or merged. Nothing changes on the tracker until you apply
 * it; you can discard it instead, or apply this one and every later one at
 * once. Several issues share one card. Where not
 * all of it applied, each issue says why and applying it again tries what
 * didn't. Applied, by you or at once (a comment, a link, or a change you
 * prefer made at once), or discarded, it folds to a line; a comment's line
 * keeps the start of what it said beneath, and one changed at once, without
 * asking, can ask you first next time.
 *
 * Each issue leads with its title; what changes on it sits beneath, each
 * change a quiet name and the value it takes. A status moves from where it
 * stood to where it goes, in the tracker's own words: In Progress → Done.
 * Where a pull request moved it, the note is a short link to that pull
 * request, beside the task's title.
 */

/**
 * One thing changed on an issue: its status, closing it, its priority,
 * assignee, project, milestone, cycle, parent, estimate, type, components,
 * due date, title or description; labels, or people where it takes several,
 * added and taken off; a comment; a link.
 */
export type IssueChange =
  | {
      field:
        | 'status'
        | 'close'
        | 'priority'
        | 'assignee'
        | 'project'
        | 'milestone'
        | 'cycle'
        | 'parent'
        | 'estimate'
        | 'type'
        | 'components'
        | 'due'
        | 'title'
        | 'description'
        | 'comment'
        | 'link'
      /** What it changes to (null for none); the comment's text; the link. */
      to: string | null
    }
  | { field: 'labels' | 'assignees'; add: readonly string[]; remove: readonly string[] }

export interface IssueChangesIssue {
  /** The tracker's mark and name: Brand.Linear, 'Linear'. */
  mark: Brand
  source: string
  key: string
  href: string
  title: string
  /** Its status before the change, in the tracker's words. */
  from?: string | null
  /** Its status once a close applied, in the tracker's words; Done before. */
  became?: string | null
  changes: readonly IssueChange[]
  /** Applied, or not; unset until it was tried. */
  applied?: boolean | null
  /** Why it didn't apply. */
  error?: string
}

export interface IssueChangesText {
  /** What it is and where: Issue changes · Linear. */
  kicker: (sources: readonly string[]) => string
  /** A change, as what it changes and what to: [Status, Done], [Labels, +perf −bug], [Close, null]. */
  parts: (change: IssueChange) => readonly [string, string | null]
  /** A change, in a few words: Status → Done, Labels +perf −bug; a status or a close from where it stood, In Progress → Done. */
  change: (change: IssueChange, from?: string | null, became?: string | null) => string
  /** Where a closed issue goes, before its tracker says. */
  closedTo: string
  applying: string
  /** Beside the buttons, where not all of it applied. */
  failed: string
  /** On an issue that applied, while others didn't. */
  appliedOne: string
  discard: string
  apply: string
  applyAgain: string
  /** Applies this one, and has every later change to an issue made at once, without a card. */
  alwaysAtOnce: string
  /** On changes made at once: have each later one wait on a card again. */
  alwaysAsk: string
  /** Before the issues, where the change isn't a status moving from one place to another; none where it is. */
  changed: string
  commented: string
  linked: string
  discarded: string
  /** Read after a link that opens a new tab. */
  newTab: string
}

const CHANGE_PARTS = {
  status: (to: string | null) => ['Status', to ?? 'none'],
  close: () => ['Close', null],
  priority: (to: string | null) => ['Priority', to ?? 'none'],
  assignee: (to: string | null) => (to === null ? ['Unassign', null] : ['Assignee', to]),
  project: (to: string | null) => (to === null ? ['Out of its project', null] : ['Project', to]),
  milestone: (to: string | null) => (to === null ? ['Out of its milestone', null] : ['Milestone', to]),
  cycle: (to: string | null) => (to === null ? ['Out of its cycle', null] : ['Cycle', to]),
  parent: (to: string | null) => (to === null ? ['Out of its parent', null] : ['Part of', to]),
  estimate: (to: string | null) => ['Estimate', to ?? 'none'],
  type: (to: string | null) => ['Type', to ?? 'none'],
  components: (to: string | null) => ['Components', to === null || to === '' ? 'none' : to],
  due: (to: string | null) => (to === null ? ['No due date', null] : ['Due', to]),
  title: (to: string | null) => ['Title', `“${to ?? ''}”`],
  description: () => ['New description', null],
  comment: () => ['Comment', null],
  link: () => ['Link the pull request', null],
} satisfies Record<string, (to: string | null) => readonly [string, string | null]>

const partsOf = (change: IssueChange): readonly [string, string | null] =>
  'add' in change
    ? [
        change.field === 'labels' ? 'Labels' : 'Assignees',
        [...change.add.map((one) => `+${one}`), ...change.remove.map((one) => `−${one}`)].join(' '),
      ]
    : CHANGE_PARTS[change.field](change.to)

export const issueChangesText: IssueChangesText = {
  kicker: (sources) => (sources.length === 0 ? 'Issue changes' : `Issue changes · ${sources.join(', ')}`),
  parts: partsOf,
  change: (change, from, became) => {
    if (from && (change.field === 'status' || change.field === 'close'))
      return `${from} → ${change.field === 'close' ? (became ?? issueChangesText.closedTo) : (change.to ?? 'none')}`
    const [what, to] = partsOf(change)
    return to === null ? what : `${what}${change.field === 'labels' || change.field === 'assignees' ? ' ' : ' → '}${to}`
  },
  closedTo: 'Done',
  applying: 'Applying…',
  failed: 'Not all of it applied.',
  appliedOne: 'Applied',
  discard: 'Discard',
  apply: 'Apply',
  applyAgain: 'Apply again',
  alwaysAtOnce: 'Always change at once',
  alwaysAsk: 'Always ask first',
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
    /** Why, in a few words, where whoever proposed it said: PR #212 opened. */
    note?: string
    /** Where the note links to: the pull request. */
    noteHref?: string
    /** The title of the task whose pull request it was. */
    task?: string
    state: IssueChangesState
    onApply?: () => void
    onDiscard?: () => void
    /** Apply these, and every later change to an issue, at once. Without it, no such link. */
    onAlwaysAtOnce?: () => void
    /** On changes made at once, without asking: have each later one wait on its card. Without it, no such link. */
    onAlwaysAsk?: () => void
    text?: Partial<IssueChangesText>
  }
>

export function IssueChanges({
  issues,
  note,
  noteHref,
  task,
  state,
  onApply,
  onDiscard,
  onAlwaysAtOnce,
  onAlwaysAsk,
  text,
  ref,
  className,
  ...rest
}: IssueChangesProps) {
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
      const moves = issues.every(
        (issue) => issue.from && issue.changes.every((change) => change.field === 'status' || change.field === 'close'),
      )
      const said =
        state === IssueChangesState.Discarded
          ? t.discarded
          : only?.field === 'comment'
            ? t.commented
            : only?.field === 'link'
              ? t.linked
              : moves
                ? null
                : t.changed
      const comment = state === IssueChangesState.Applied && only?.field === 'comment' ? only.to : null
      return (
        <article
          ref={setLine}
          tabIndex={-1}
          className={cx(s.line, comment !== null && s.lineComment, className)}
          data-rhythm={Rhythm.Fold}
          {...rest}
        >
          <span className={s.lineHead}>
            {first && <BrandMark brand={first.mark} size={12} className={s.lineMark} />}
            {said && <span className={s.said}>{said}</span>}
            <span className={cx(s.lineWhat, state === IssueChangesState.Discarded && s.struck)}>
              {issues.map((issue, index) => (
                <span key={`${issue.source}:${issue.key}`} className={s.lineIssue}>
                  {index > 0 && <span className={s.sep}> · </span>}
                  <Key issue={issue} t={t} />
                  {only?.field === 'comment' || only?.field === 'link'
                    ? null
                    : ` ${issue.changes.map((change) => t.change(change, issue.from, issue.became)).join(', ')}`}
                </span>
              ))}
              {note && state === IssueChangesState.Applied && (
                <span className={s.lineIssue}>
                  <span className={s.sep}> · </span>
                  <Why note={note} href={noteHref} t={t} />
                </span>
              )}
            </span>
            {state === IssueChangesState.Applied && onAlwaysAsk && (
              <LinkButton className={s.lineAsk} onClick={onAlwaysAsk}>
                {t.alwaysAsk}
              </LinkButton>
            )}
          </span>
          {/* what it said, in its own words, a couple of lines of it */}
          {comment !== null && <span className={s.lineQuote}>{comment}</span>}
        </article>
      )
    }
    case IssueChangesState.Pending:
    case IssueChangesState.Applying:
    case IssueChangesState.Failed:
      return (
        <Card
          root={{ ...rest, ref, className }}
          issues={issues}
          note={note}
          noteHref={noteHref}
          task={task}
          state={state}
          onApply={onApply}
          onDiscard={onDiscard}
          onAlwaysAtOnce={onAlwaysAtOnce}
          t={t}
        />
      )
    default:
      return unreachable(state)
  }
}

/** Why it changed, a short link to the pull request where it has an address. */
function Why({ note, href, t }: { note: string; href: string | undefined; t: IssueChangesText }) {
  const safe = href === undefined ? undefined : safeHref(href)
  return safe ? (
    <a className={s.pr} href={safe} target="_blank" rel="noreferrer">
      {note}
      <VisuallyHidden> {t.newTab}</VisuallyHidden>
    </a>
  ) : (
    <span>{note}</span>
  )
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
  noteHref: string | undefined
  task: string | undefined
  state: IssueChangesState
  onApply: (() => void) | undefined
  onDiscard: (() => void) | undefined
  onAlwaysAtOnce: (() => void) | undefined
  t: IssueChangesText
}

/** The changes before they apply: each issue and what changes on it, and the buttons that apply them or throw them away. */
function Card({ root, issues, note, noteHref, task, state, onApply, onDiscard, onAlwaysAtOnce, t }: CardProps) {
  const { className, ...rest } = root
  const kickerId = useId()
  const applying = state === IssueChangesState.Applying
  const failed = state === IssueChangesState.Failed
  const sources = [...new Set(issues.map((issue) => issue.source))]
  return (
    <article aria-labelledby={kickerId} className={cx(s.card, className)} data-rhythm={Rhythm.Card} {...rest}>
      <p className={s.head}>
        {issues[0] && <BrandMark brand={issues[0].mark} size={11} className={s.mark} />}
        <span id={kickerId}>{t.kicker(sources)}</span>
        {(task || note) && (
          <span className={s.why}>
            {task && <span className={s.task}>{task}</span>}
            {note && <Why note={note} href={noteHref} t={t} />}
          </span>
        )}
      </p>
      <ul className={s.issues}>
        {issues.map((issue) => {
          const comment = issue.changes.find((change) => change.field === 'comment')
          const rest = issue.changes.filter((change) => change.field !== 'comment')
          const moved = (change: IssueChange) => Boolean(issue.from) && (change.field === 'status' || change.field === 'close')
          return (
            <li key={`${issue.source}:${issue.key}`} className={s.issue}>
              <p className={s.which}>
                <span className={s.issueTitle}>{issue.title}</span>
                <Key issue={issue} t={t} />
              </p>
              {rest.length > 0 && (
                <p className={s.changes}>
                  {rest.map((change, index) => {
                    const [what, to] = t.parts(change)
                    return (
                      <span key={index} className={s.change}>
                        {moved(change) ? (
                          <>
                            <span className={s.what}>{issue.from}</span> <span className={s.arrow}>→</span>{' '}
                            <span className={s.to}>{change.field === 'close' ? (issue.became ?? t.closedTo) : to}</span>
                          </>
                        ) : to === null ? (
                          <span className={s.to}>{what}</span>
                        ) : (
                          <>
                            <span className={s.what}>{what}</span> <span className={s.to}>{to}</span>
                          </>
                        )}
                      </span>
                    )
                  })}
                </p>
              )}
              {comment?.field === 'comment' && <p className={s.comment}>{comment.to}</p>}
              {failed && issue.applied === true && <p className={s.done}>{t.appliedOne}</p>}
              {failed && issue.applied === false && issue.error && <Problem size="small">{issue.error}</Problem>}
            </li>
          )
        })}
      </ul>
      {/* no foot where there is nothing to say or press: a card the person can't act on ends with its issues */}
      {(onApply !== undefined || onDiscard !== undefined || onAlwaysAtOnce !== undefined || applying || failed) && (
        <div className={s.foot}>
          <span className={cx(s.note, failed && s.noteFailed)} aria-live="polite">
            {applying ? (
              t.applying
            ) : failed ? (
              t.failed
            ) : onAlwaysAtOnce ? (
              <LinkButton onClick={onAlwaysAtOnce}>{t.alwaysAtOnce}</LinkButton>
            ) : null}
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
      )}
    </article>
  )
}
