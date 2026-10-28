import { useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Outside, ReviewDraftState, ReviewVerdict, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useRefocus } from '../../lib/refocus'
import { Rhythm } from '../../lib/rhythm'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { FieldArea, FieldError } from '../../primitives/Field/Field'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Switch } from '../../primitives/Switch/Switch'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ReviewDraft.module.css'

/*
 * A review the task's lead drafted of someone else's pull request, as a card
 * in its thread, framed as an issue draft is: paper, a hairline, a foot of
 * buttons. Nothing reaches the code host until you post it. The verdict is
 * yours: the lead's is only a suggestion, and on a pull request from outside
 * the team Approve is never chosen for you. Each comment is kept or dropped,
 * and Edit rewords the summary and the comments. One an automation's run
 * drafted can also post this one and let that automation's next ones post
 * themselves, the one way to say so. If posting fails the card
 * says why and can post again; perhaps posted, it says to look first. Posted,
 * it folds to a line with the review's link; discarded, to a quiet line.
 */

export interface ReviewDraftText {
  /** What it is and what it reviews: Review draft · GitHub · meridian/api #1212. */
  kicker: (source: string, repository: string, number: string) => string
  /** Who opened it, why it counts as from outside, and who drafted the review. */
  meta: (author: string, outside: string | null, drafter: string | null) => string
  /** Why it counts as from outside. */
  outside: Readonly<Record<Outside, string>>
  /** The verdict's name, beside its choice. */
  verdict: string
  verdicts: Readonly<Record<ReviewVerdict, string>>
  /** The lead's verdict, beside the choice: only a suggestion. */
  suggests: (drafter: string | null, verdict: string) => string
  /** Said beside the verdict when it is posted with none chosen. */
  verdictMissing: string
  /** The verdict, where it can't be chosen here and none is. */
  noVerdict: string
  /** The list of comments, for assistive technology. */
  comments: string
  kept: string
  dropped: string
  /** A comment's switch: where it is. */
  keep: (where: string) => string
  /** Beside the buttons, until it is posted. */
  note: (source: string, as: string | null, kept: number, total: number) => string
  /** Beside the buttons, while it is posted. */
  posting: (source: string) => string
  /** Before why it wasn't posted. */
  failed: (source: string) => string
  /** Before why it may be on the host already, its answer lost. */
  uncertain: (source: string) => string
  /** Under a card from outside: whose words it was written from. */
  steered: (author: string) => string
  /** What the lead could reach, where the consumer can say. */
  reach: string
  discard: string
  edit: string
  post: string
  /** For an automation's review: post this one, and its next ones without asking. */
  postFromNow: string
  postAgain: string
  /** The edit form's name. */
  editing: string
  summaryLabel: string
  commentLabel: (where: string) => string
  /** Said when it is saved without a summary, or a comment without words. */
  summaryMissing: string
  commentMissing: string
  save: string
  cancel: string
  /** Once posted: on what, with which verdict, and how many comments. */
  posted: (number: string) => string
  postedComments: (n: number) => string
  open: (source: string) => string
  /** Read after a link that opens a new tab. */
  newTab: string
  discarded: string
}

export const reviewDraftText: ReviewDraftText = {
  kicker: (source, repository, number) => `Review draft · ${source} · ${repository} ${number}`,
  meta: (author, outside, drafter) =>
    [outside === null ? author : `${author}, ${outside}`, ...(drafter === null ? [] : [`drafted by ${drafter}`])].join(' · '),
  outside: { [Outside.Fork]: 'from a fork', [Outside.Author]: 'from outside the team' },
  verdict: 'Your verdict',
  verdicts: { [ReviewVerdict.Comment]: 'Comment', [ReviewVerdict.Approve]: 'Approve', [ReviewVerdict.Changes]: 'Request changes' },
  suggests: (drafter, verdict) => `${drafter ?? 'The lead'} suggests ${verdict}`,
  verdictMissing: 'Choose a verdict first',
  noVerdict: 'None chosen',
  comments: 'Comments on the code',
  kept: 'Kept',
  dropped: 'Dropped',
  keep: (where) => `Keep the comment on ${where}`,
  note: (source, as, kept, total) => {
    const posts = [...(as === null ? [] : [`as ${as}`]), ...(total === 0 ? [] : [`${kept} of ${total} comments`])]
    return `Nothing is on ${source} until you post it.${posts.length === 0 ? '' : ` It posts ${posts.join(', ')}.`}`
  },
  posting: (source) => `Posting on ${source}…`,
  failed: (source) => `Couldn’t post it on ${source}.`,
  uncertain: (source) => `This may be on ${source} already.`,
  steered: (author) => `Written from ${author}’s code and words, which may try to steer it.`,
  reach: 'What it could reach',
  discard: 'Discard',
  edit: 'Edit',
  post: 'Post review',
  postFromNow: 'Post this automation’s reviews from now on',
  postAgain: 'Post again',
  editing: 'Edit the review draft',
  summaryLabel: 'Summary',
  commentLabel: (where) => `Comment on ${where}`,
  summaryMissing: 'Write a summary first',
  commentMissing: 'Write the comment, or drop it',
  save: 'Save',
  cancel: 'Cancel',
  posted: (number) => `Review posted on ${number}:`,
  postedComments: (n) => (n === 1 ? '1 comment' : `${n} comments`),
  open: (source) => `Open on ${source}`,
  newTab: '(opens in a new tab)',
  discarded: 'Review draft discarded',
}

/** A comment on a line of the pull request as it now reads. */
export interface ReviewDraftComment {
  id: string
  path: string
  line: number
  /** Markdown, as text. */
  body: string
  /** The body drawn, where the consumer draws Markdown; the plain text otherwise. */
  bodyView?: ReactNode
  kept: boolean
}

/** What the person changed in the edit form: the summary, and each comment's words. */
export interface ReviewDraftEdit {
  summary: string
  comments: readonly { id: string; body: string }[]
}

export type ReviewDraftProps = RootProps<
  'article',
  {
    /** The code host's mark and name: Brand.GitHub, 'GitHub'. */
    mark: Brand
    source: string
    /** The pull request's repository, and its number as the host writes it: meridian/api, #1212. */
    repository: string
    number: string
    title: string
    author: string
    /** Why it counts as from outside the team, where it does: then Approve is never chosen for you. */
    outside?: Outside
    /** The agent that drafted it. */
    drafter?: string
    /** Who it posts as on the host. */
    as?: string
    /** Markdown, as text. */
    summary: string
    /** The summary drawn, where the consumer draws Markdown; the plain text otherwise. */
    summaryView?: ReactNode
    comments: readonly ReviewDraftComment[]
    /** The lead's verdict. */
    suggested: ReviewVerdict
    /** The verdict it posts with; null while none is chosen. */
    verdict: ReviewVerdict | null
    state: ReviewDraftState
    /** Why it wasn't posted, while it stands failed; or why it may have been, while uncertain. */
    error?: string
    /** The review, once posted: its link. */
    review?: { href: string }
    onVerdict?: (verdict: ReviewVerdict) => void
    /** Keep a comment, or drop it. */
    onKeep?: (commentId: string, kept: boolean) => void
    /** Save what the person changed in the edit form. */
    onChange?: (edit: ReviewDraftEdit) => void
    /** Post it, or post it again after it failed or may have. */
    onPost?: () => void
    /** An automation drafted it: post it, and let the automation's next reviews post themselves. Only before it is first posted. */
    onPostFromNow?: () => void
    onDiscard?: () => void
    /** Shows what the lead could reach, for a card from outside. */
    onReach?: () => void
    /** A save is under way: the form's save button shows it. */
    saving?: boolean
    headingLevel?: HeadingLevel
    text?: Partial<ReviewDraftText>
  }
>

const VERDICTS = [ReviewVerdict.Comment, ReviewVerdict.Approve, ReviewVerdict.Changes] as const

const whereOf = (comment: Pick<ReviewDraftComment, 'path' | 'line'>) => `${comment.path}:${comment.line}`

export function ReviewDraft({
  mark,
  source,
  repository,
  number,
  title,
  author,
  outside,
  drafter,
  as,
  summary,
  summaryView,
  comments,
  suggested,
  verdict,
  state,
  error,
  review,
  onVerdict,
  onKeep,
  onChange,
  onPost,
  onPostFromNow,
  onDiscard,
  onReach,
  saving = false,
  headingLevel = 3,
  text,
  ref,
  className,
  ...rest
}: ReviewDraftProps) {
  const t = { ...reviewDraftText, ...text }
  /* when it folds under the button you pressed, focus goes to the line it folds to */
  const line = useRef<HTMLElement>(null)
  useRefocus(!folds(state), line)
  const setLine = (node: HTMLElement | null) => {
    line.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  switch (state) {
    case ReviewDraftState.Posted: {
      const href = safeHref(review?.href)
      const kept = comments.filter((comment) => comment.kept).length
      return (
        <article ref={setLine} tabIndex={-1} className={cx(s.line, className)} data-rhythm={Rhythm.Fold} {...rest}>
          <Icon name="check" size={13} className={s.ok} />
          <span className={s.said}>
            {t.posted(number)} <strong className={s.verdictWord}>{t.verdicts[verdict ?? suggested]}</strong>, {t.postedComments(kept)}
          </span>
          {href && (
            <a className={s.open} href={href} target="_blank" rel="noreferrer">
              {t.open(source)}
              <VisuallyHidden> {t.newTab}</VisuallyHidden>
            </a>
          )}
        </article>
      )
    }
    case ReviewDraftState.Discarded:
      return (
        <article ref={setLine} tabIndex={-1} className={cx(s.line, className)} data-rhythm={Rhythm.Fold} {...rest}>
          <BrandMark brand={mark} size={12} className={s.lineMark} />
          <span className={s.said}>{t.discarded}</span>
          <span className={cx(s.lineTitle, s.struck)}>{title}</span>
        </article>
      )
    case ReviewDraftState.Pending:
    case ReviewDraftState.Posting:
    case ReviewDraftState.Failed:
    case ReviewDraftState.Uncertain:
      return (
        <DraftCard
          root={{ ...rest, ref, className }}
          draft={{
            mark,
            source,
            repository,
            number,
            title,
            author,
            outside,
            drafter,
            as,
            summary,
            summaryView,
            comments,
            suggested,
            verdict,
            error,
          }}
          state={state}
          actions={{ onVerdict, onKeep, onChange, onPost, onPostFromNow, onDiscard, onReach }}
          saving={saving}
          headingLevel={headingLevel}
          t={t}
        />
      )
    default:
      return unreachable(state)
  }
}

function folds(state: ReviewDraftState) {
  switch (state) {
    case ReviewDraftState.Posted:
    case ReviewDraftState.Discarded:
      return true
    case ReviewDraftState.Pending:
    case ReviewDraftState.Posting:
    case ReviewDraftState.Failed:
    case ReviewDraftState.Uncertain:
      return false
    default:
      return unreachable(state)
  }
}

interface CardProps {
  root: ComponentPropsWithRef<'article'>
  draft: Pick<
    ReviewDraftProps,
    | 'mark'
    | 'source'
    | 'repository'
    | 'number'
    | 'title'
    | 'author'
    | 'outside'
    | 'drafter'
    | 'as'
    | 'summary'
    | 'summaryView'
    | 'comments'
    | 'suggested'
    | 'verdict'
    | 'error'
  >
  state: ReviewDraftState
  actions: Pick<ReviewDraftProps, 'onVerdict' | 'onKeep' | 'onChange' | 'onPost' | 'onPostFromNow' | 'onDiscard' | 'onReach'>
  saving: boolean
  headingLevel: HeadingLevel
  t: ReviewDraftText
}

/** The draft before it is posted: the verdict, the summary, each comment kept or dropped, and the buttons. */
function DraftCard({ root, draft, state, actions, saving, headingLevel, t }: CardProps) {
  const {
    mark,
    source,
    repository,
    number,
    title,
    author,
    outside,
    drafter,
    as,
    summary,
    summaryView,
    comments,
    suggested,
    verdict,
    error,
  } = draft
  const { onVerdict, onKeep, onChange, onPost, onPostFromNow, onDiscard, onReach } = actions
  const { className, ...rest } = root
  const kickerId = useId()
  const titleId = useId()
  const verdictId = useId()
  const missingId = useId()
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState(false)
  const [missing, setMissing] = useState(false)
  const choice = useRef<HTMLDivElement>(null)
  const posting = state === ReviewDraftState.Posting
  const failed = state === ReviewDraftState.Failed
  const unsure = state === ReviewDraftState.Uncertain
  const open = editing && !posting
  /* saved: the form stays while the save is under way, and closes once it isn't */
  if (sent && !saving) {
    setSent(false)
    setEditing(false)
  }
  /* a verdict chosen answers what was missing */
  if (missing && verdict !== null) setMissing(false)
  const edit = useRefocus<HTMLButtonElement>(open)
  const kept = comments.filter((comment) => comment.kept).length
  /* posting needs a verdict: with none chosen, it says so beside the choice, and focus goes there */
  const chosen = (post: () => void) => {
    if (verdict === null) {
      setMissing(true)
      choice.current?.querySelector<HTMLElement>('[role="radio"]')?.focus()
      return
    }
    post()
  }

  return (
    <article
      aria-labelledby={open ? kickerId : `${kickerId} ${titleId}`}
      className={cx(s.card, className)}
      data-rhythm={Rhythm.Card}
      {...rest}
    >
      <div className={s.head}>
        <span className={s.kicker} id={kickerId}>
          <BrandMark brand={mark} size={11} className={s.mark} />
          {t.kicker(source, repository, number)}
        </span>
        {!open && (
          <Heading level={headingLevel} id={titleId} className={s.title}>
            {title}
          </Heading>
        )}
        <p className={s.meta}>{t.meta(author, outside === undefined ? null : t.outside[outside], drafter ?? null)}</p>
      </div>
      {open && onChange ? (
        <EditForm
          summary={summary}
          comments={comments}
          saving={saving}
          t={t}
          onSave={(next) => {
            onChange(next)
            setSent(true)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className={s.section}>
            <div className={s.verdict}>
              <span className={s.label} id={verdictId}>
                {t.verdict}
              </span>
              {onVerdict ? (
                <div ref={choice} className={s.choice}>
                  <Segmented
                    label={t.verdict}
                    value={verdict}
                    onChange={onVerdict}
                    options={VERDICTS.map((value) => ({ value, label: t.verdicts[value], disabled: posting }))}
                  />
                </div>
              ) : (
                <span className={s.chosen}>{verdict === null ? t.noVerdict : t.verdicts[verdict]}</span>
              )}
              <span className={s.suggest}>{t.suggests(drafter ?? null, t.verdicts[suggested])}</span>
            </div>
            {missing && <FieldError id={missingId}>{t.verdictMissing}</FieldError>}
            <div className={s.summary}>{summaryView ?? <p className={s.plain}>{summary}</p>}</div>
          </div>
          {comments.length > 0 && (
            <ol className={s.comments} aria-label={t.comments}>
              {comments.map((comment) => (
                <li key={comment.id} className={cx(s.comment, !comment.kept && s.dropped)}>
                  <div className={s.where}>
                    <code className={s.path}>{whereOf(comment)}</code>
                    <span className={s.keep}>
                      <span className={s.keepWord} aria-hidden="true">
                        {comment.kept ? t.kept : t.dropped}
                      </span>
                      {onKeep && (
                        <Switch
                          checked={comment.kept}
                          label={t.keep(whereOf(comment))}
                          disabled={posting}
                          onChange={(next) => onKeep(comment.id, next)}
                        />
                      )}
                    </span>
                  </div>
                  <div className={s.body}>{comment.bodyView ?? <p className={s.plain}>{comment.body}</p>}</div>
                </li>
              ))}
            </ol>
          )}
          <div aria-live="polite">
            {failed && (
              <p className={s.error}>
                {t.failed(source)}
                {error && <> {error}</>}
              </p>
            )}
            {unsure && (
              <p className={cx(s.error, s.unsure)}>
                {t.uncertain(source)}
                {error && <> {error}</>}
              </p>
            )}
          </div>
          <div className={s.foot}>
            <span className={s.note}>{posting ? t.posting(source) : t.note(source, as ?? null, kept, comments.length)}</span>
            {onDiscard && !posting && (
              <Button variant="quiet" onClick={onDiscard}>
                {t.discard}
              </Button>
            )}
            {onChange && !posting && (
              <Button ref={edit} onClick={() => setEditing(true)}>
                {t.edit}
              </Button>
            )}
            {onPostFromNow && state === ReviewDraftState.Pending && (
              <Button aria-describedby={missing ? missingId : undefined} onClick={() => chosen(onPostFromNow)}>
                {t.postFromNow}
              </Button>
            )}
            {onPost && (
              <Button variant="signal" busy={posting} aria-describedby={missing ? missingId : undefined} onClick={() => chosen(onPost)}>
                {failed || unsure ? t.postAgain : t.post}
              </Button>
            )}
          </div>
          {outside !== undefined && (
            <p className={s.outside}>
              <Icon name="lock" size={11} className={s.lock} />
              <span>{t.steered(author)}</span>
              {onReach && <LinkButton onClick={onReach}>{t.reach}</LinkButton>}
            </p>
          )}
        </>
      )}
    </article>
  )
}

interface EditFormProps {
  summary: string
  comments: readonly ReviewDraftComment[]
  saving: boolean
  onSave: (edit: ReviewDraftEdit) => void
  onCancel: () => void
  t: ReviewDraftText
}

/** The draft as a form: its summary, and each comment's words. */
function EditForm({ summary: initialSummary, comments, saving, onSave, onCancel, t }: EditFormProps) {
  const [summary, setSummary] = useState(initialSummary)
  const [bodies, setBodies] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(comments.map((comment) => [comment.id, comment.body])),
  )
  const [missing, setMissing] = useState<string | null>(null)
  const summaryField = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const summaryId = useId()
  const errorId = useId()
  useEffect(() => {
    summaryField.current?.focus()
  }, [])
  return (
    <form
      ref={form}
      aria-label={t.editing}
      className={s.form}
      /* its Escape, not a panel's round it */
      data-own-escape=""
      onSubmit={(e) => {
        e.preventDefault()
        if (summary.trim() === '') {
          setMissing('summary')
          summaryField.current?.focus()
          return
        }
        const empty = comments.find((comment) => (bodies[comment.id] ?? '').trim() === '')
        if (empty !== undefined) {
          setMissing(empty.id)
          form.current?.querySelector<HTMLTextAreaElement>(`[data-comment="${empty.id}"]`)?.focus()
          return
        }
        onSave({
          summary: summary.trim(),
          comments: comments.map((comment) => ({ id: comment.id, body: (bodies[comment.id] ?? '').trim() })),
        })
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <div className={s.fields}>
        <div className={s.row}>
          <label htmlFor={summaryId} className={s.fieldLabel}>
            {t.summaryLabel}
          </label>
          <FieldArea
            ref={summaryField}
            id={summaryId}
            rows={4}
            value={summary}
            invalid={missing === 'summary'}
            aria-describedby={missing === 'summary' ? errorId : undefined}
            onChange={(e) => {
              setSummary(e.target.value)
              if (missing === 'summary' && e.target.value.trim() !== '') setMissing(null)
            }}
          />
          {missing === 'summary' && <FieldError id={errorId}>{t.summaryMissing}</FieldError>}
        </div>
        {comments.map((comment) => (
          <CommentField
            key={comment.id}
            comment={comment}
            value={bodies[comment.id] ?? ''}
            missing={missing === comment.id}
            t={t}
            onChange={(body) => {
              setBodies({ ...bodies, [comment.id]: body })
              if (missing === comment.id && body.trim() !== '') setMissing(null)
            }}
          />
        ))}
      </div>
      <div className={s.foot}>
        <span className={s.note} />
        <Button variant="quiet" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" busy={saving}>
          {t.save}
        </Button>
      </div>
    </form>
  )
}

function CommentField({
  comment,
  value,
  missing,
  t,
  onChange,
}: {
  comment: ReviewDraftComment
  value: string
  missing: boolean
  t: ReviewDraftText
  onChange: (body: string) => void
}) {
  const id = useId()
  const errorId = useId()
  return (
    <div className={s.row}>
      <label htmlFor={id} className={s.fieldLabel}>
        {t.commentLabel(whereOf(comment))}
      </label>
      <FieldArea
        id={id}
        data-comment={comment.id}
        rows={3}
        value={value}
        invalid={missing}
        aria-describedby={missing ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {missing && <FieldError id={errorId}>{t.commentMissing}</FieldError>}
    </div>
  )
}
