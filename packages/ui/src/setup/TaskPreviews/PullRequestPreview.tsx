import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { TaskEnd, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import type { SealFacts } from '../../seal/seal'
import { ReviewSealGlyph } from '../ReviewSeal/ReviewSeal'
import { PullRequestCard } from './PullRequestCard'
import s from './TaskPreviews.module.css'

/*
 * What a project's "When a task is done" and the settings after it make:
 * the pull request a finished task opens, as GitHub shows it. A draft or
 * open; the screenshots its lead posted, where it posts them; the issue it
 * came from, its status moving along with the task where issues follow;
 * the review seal in its corner, where that is on. With "Push the branch
 * only", no pull request: GitHub's line that the branch had recent pushes,
 * with its button to open one. A picture of another site's page: nothing
 * in it can be pressed or focused, and a screen reader reads it as the
 * example it is. Its words are the sample's, or the project's own where
 * the consumer has them.
 */

/** Where an issue stands on its tracker, as the task moves it. */
export type PreviewIssueStatus = 'todo' | 'progress' | 'review'

/** The pull request and the branch it shows: a sample's, or the project's own facts where there are some. */
export interface PullRequestPreviewSample {
  title: string
  /** As the host writes it: #212. */
  number: string
  /** Who opened it, by their name on the host. */
  author: string
  commits: number
  /** The branch it goes into. */
  base: string
  /** The task's branch. */
  branch: string
  /** The start of its description. */
  body: string
  /** How long ago the branch was pushed, as the host says it: 2 minutes ago. */
  pushed: string
  /** The issue it came from, and the tracker's mark; none where the project has no tracker. */
  issue?: { key: string; tracker: Brand } | undefined
  /** The review its seal says. */
  facts: SealFacts
}

export interface PullRequestPreviewText {
  /** What it is, for a screen reader. */
  pullRequest: string
  branch: string
  draft: string
  open: string
  /** The words before the branch it goes into: balazs wants to merge 3 commits into. */
  wants: (author: string, commits: number) => string
  from: string
  pushed: (when: string) => string
  compare: string
  screenshots: string
  status: Record<PreviewIssueStatus, string>
}

export const pullRequestPreviewText: PullRequestPreviewText = {
  pullRequest: 'A pull request as GitHub shows it',
  branch: 'A branch as GitHub shows it',
  draft: 'Draft',
  open: 'Open',
  wants: (author, commits) => `${author} wants to merge ${commits} ${commits === 1 ? 'commit' : 'commits'} into`,
  from: 'from',
  pushed: (when) => `had recent pushes ${when}`,
  compare: 'Compare & pull request',
  screenshots: 'Screenshots from the task',
  status: { todo: 'Todo', progress: 'In Progress', review: 'In Review' },
}

export interface PullRequestPreviewProps {
  /** What a finished task does: opens a draft, opens one for review, or pushes its branch only. */
  end: TaskEnd
  /** Its lead's screenshots are posted to it. */
  screenshots: boolean
  /** Its issue moves along with it. */
  issues: boolean
  /** It carries the review seal. */
  seal: boolean
  sample: PullRequestPreviewSample
  text?: Partial<PullRequestPreviewText>
  className?: string
}

/** How far an issue's status ring is filled, as trackers draw it. */
const FILLED: Record<PreviewIssueStatus, number> = { todo: 0, progress: 0.5, review: 0.75 }

/** An issue's status as a ring filled as far as it has come. */
function StatusMark({ status }: { status: PreviewIssueStatus }) {
  const inner = 2.5
  const round = 2 * Math.PI * inner
  return (
    <svg className={s.statusMark} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle
        cx="6"
        cy="6"
        r={inner}
        fill="none"
        stroke="currentColor"
        strokeWidth={inner * 2}
        strokeDasharray={`${round * FILLED[status]} ${round}`}
        transform="rotate(-90 6 6)"
      />
    </svg>
  )
}

/** Where the issue stands once the task has done what this project says. */
const statusOf = (end: TaskEnd.DraftPr | TaskEnd.ReadyPr, issues: boolean): PreviewIssueStatus => {
  if (!issues) return 'todo'
  switch (end) {
    case TaskEnd.DraftPr:
      return 'progress'
    case TaskEnd.ReadyPr:
      return 'review'
    default:
      return unreachable(end)
  }
}

/** The pull request a finished task opens, as GitHub shows it, following a project's settings; or, pushing the branch only, GitHub's line for it. */
export function PullRequestPreview({ end, screenshots, issues, seal, sample, text, className }: PullRequestPreviewProps) {
  const t = { ...pullRequestPreviewText, ...text }
  if (end === TaskEnd.PushOnly)
    return (
      <figure className={cx(s.pushed, className)} aria-label={t.branch}>
        <Icon name="branch" size={14} />
        <span className={s.pushedWords}>
          <code className={s.ref}>{sample.branch}</code> {t.pushed(sample.pushed)}
        </span>
        <span inert aria-hidden="true">
          <Button size="small" tabIndex={-1}>
            {t.compare}
          </Button>
        </span>
      </figure>
    )
  const draft = end === TaskEnd.DraftPr
  const status = statusOf(end, issues)
  return (
    <PullRequestCard
      className={className}
      label={t.pullRequest}
      title={sample.title}
      number={sample.number}
      state={
        <span className={cx(s.state, !draft && s.stateOpen)}>
          <Icon name="pr" size={11} />
          {draft ? t.draft : t.open}
        </span>
      }
    >
      <div className={s.body}>
        <span className={s.refs}>
          {t.wants(sample.author, sample.commits)} <code className={s.ref}>{sample.base}</code> {t.from}{' '}
          <code className={s.ref}>{sample.branch}</code>
        </span>
        <p className={s.text}>
          {seal && <ReviewSealGlyph className={s.sealIn} facts={sample.facts} size={58} />}
          {sample.body}
        </p>
        {screenshots && (
          <span className={s.shots} role="img" aria-label={t.screenshots}>
            <span className={s.shot} />
            <span className={s.shot} />
          </span>
        )}
        {sample.issue !== undefined && (
          <span className={s.issue}>
            <BrandMark brand={sample.issue.tracker} size={13} />
            <span className={s.issueKey}>{sample.issue.key}</span>
            <span className={s.status}>
              <StatusMark status={status} />
              {t.status[status]}
            </span>
          </span>
        )}
      </div>
    </PullRequestCard>
  )
}
