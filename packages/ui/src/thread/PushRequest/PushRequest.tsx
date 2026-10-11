import { Icon } from '../../foundations/Icon/Icon'
import { PushState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './PushRequest.module.css'

/*
 * The lead asking the person to push its new commits to the task's pull
 * request, in the thread: the commits that would go up, oldest first, and
 * Push, which pushes them and nothing newer. Nothing goes up until the
 * person presses it. Where the branch changed since the lead asked, it says
 * so, and shows what is on the branch now. Once pushed, asked again, or its
 * pull request closed, it stays as a record, quiet, with no Push.
 */

export interface PushRequestText {
  /** Who asks, while it waits. */
  asks: (by: string) => string
  /** The same, when who asks isn't said. */
  asked: string
  pushed: string
  replaced: string
  closed: string
  /** Said where the branch changed since the lead asked. */
  moved: string
  /** Moved so far that nothing on the branch is new to the pull request any more. */
  nothingNew: (where: string) => string
  /** Commits not listed. */
  more: (n: number) => string
  push: (n: number) => string
  pushLabel: (n: number, where: string) => string
  /** What a settled one says beneath its commits. */
  replacedNote: string
  closedNote: (where: string) => string
  openLabel: (where: string) => string
  label: (where: string) => string
}

const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

export const pushRequestText: PushRequestText = {
  asks: (by) => `${by} asks you to push`,
  asked: 'Asks you to push',
  pushed: 'Pushed',
  replaced: 'Asked again',
  closed: 'Not pushed',
  moved: 'The branch changed since this was asked. This is what is on it now.',
  nothingNew: (where) => `Nothing on the branch is new to ${where} now.`,
  more: (n) => `and ${n} more`,
  push: (n) => `Push ${commits(n)}`,
  pushLabel: (n, where) => `Push ${commits(n)} to ${where}`,
  replacedNote: 'Asked again below, with more.',
  closedNote: (where) => `${where} isn’t open any more.`,
  openLabel: (where) => `Open ${where}`,
  label: (where) => `Push to ${where}`,
}

export interface PushRequestCommit {
  /** Its short id: 4e1c0a2. */
  readonly sha: string
  readonly subject: string
}

export type PushRequestProps = RootProps<
  'article',
  {
    /** Where the commits go, as the person reads it: PR #106, or web#3 in a task of several repositories. */
    where: string
    /** Who asks: the lead's name. Without it, the card doesn't say. */
    by?: string
    /** The commits that would go up, oldest first: the first few, where there are many. */
    commits: ReadonlyArray<PushRequestCommit>
    /** How many would go up in all, where more than are listed. */
    count?: number
    state?: PushState
    /** The branch changed since the lead asked: the commits are what is on it now. */
    moved?: boolean
    /** When it was asked, or settled: 2m ago. */
    at?: string
    /** Push what it shows. Without it, no Push. */
    onPush?: () => void
    /** The push is under way. */
    pushing?: boolean
    /** Open the pull request on its host. Without it, its name is plain text. */
    onOpen?: () => void
    text?: Partial<PushRequestText>
  }
>

export function PushRequest({
  where,
  by,
  commits: listed,
  count,
  state = PushState.Open,
  moved = false,
  at,
  onPush,
  pushing = false,
  onOpen,
  className,
  text,
  ...rest
}: PushRequestProps) {
  const t = { ...pushRequestText, ...text }
  const open = state === PushState.Open
  const total = Math.max(count ?? listed.length, listed.length)
  const kicker = {
    [PushState.Open]: by === undefined ? t.asked : t.asks(by),
    [PushState.Pushed]: t.pushed,
    [PushState.Replaced]: t.replaced,
    [PushState.Closed]: t.closed,
  }[state]
  return (
    <article className={cx(s.card, !open && s.settled, className)} aria-label={t.label(where)} {...rest}>
      <div className={s.head}>
        <span className={s.kicker}>
          <Icon name={state === PushState.Pushed ? 'check' : 'up'} size={11} className={s.glyph} />
          <span>
            {kicker} ·{' '}
            {onOpen ? (
              <LinkButton className={s.where} aria-label={t.openLabel(where)} onClick={onOpen}>
                {where}
              </LinkButton>
            ) : (
              <span className={s.where}>{where}</span>
            )}
          </span>
          {at !== undefined && <span className={s.at}>{at}</span>}
        </span>
        {open && moved && <p className={s.moved}>{t.moved}</p>}
      </div>
      {listed.length > 0 ? (
        <ol className={s.commits}>
          {listed.map((commit) => (
            <li key={commit.sha} className={s.commit}>
              <code className={s.sha}>{commit.sha}</code>
              <span className={s.subject}>{commit.subject}</span>
            </li>
          ))}
          {total > listed.length && <li className={s.more}>{t.more(total - listed.length)}</li>}
        </ol>
      ) : (
        open && <p className={s.note}>{t.nothingNew(where)}</p>
      )}
      {open && total > 0 && onPush ? (
        <div className={s.foot}>
          <Button variant="signal" size="small" busy={pushing} aria-label={t.pushLabel(total, where)} onClick={onPush}>
            {t.push(total)}
          </Button>
        </div>
      ) : state === PushState.Replaced ? (
        <p className={s.note}>{t.replacedNote}</p>
      ) : state === PushState.Closed ? (
        <p className={s.note}>{t.closedNote(where)}</p>
      ) : null}
    </article>
  )
}
