import { useState } from 'react'

import type { ReviewBrief, ReviewDraftState as State, ReviewVerdict as Verdict, Unfurl } from '@althar/contracts'
import { Markdown, Outside, type ReachPhrase, ReviewDraft, ReviewDraftState, ReviewVerdict } from '@althar/ui'

import { productBrand, productName } from '../../shared/products'
import type { ReviewDraftContent } from '../../shared/thread'

/*
 * A review task's lead's draft of someone else's pull request, in its
 * thread: the verdict, the summary and each comment, kept or dropped, and
 * where it stands. Nothing is posted until the person posts it here. A
 * verdict chosen or a comment kept shows at once, and gives way to what the
 * runtime kept once the change has been read back. An automation's first
 * review can also let that automation's next ones post themselves.
 */

export interface ReviewActions {
  readonly onChange: (
    draftId: string,
    edit: {
      readonly verdict?: Verdict
      readonly summary?: string
      readonly comments?: ReadonlyArray<{ readonly id: string; readonly kept?: boolean; readonly body?: string }>
    },
  ) => Promise<void>
  readonly onPost: (draftId: string) => void
  /** An automation drafted it: post it, and let that automation's next reviews post themselves. */
  readonly onPostFromNow?: (draftId: string, automationId: string) => void
  readonly onDiscard: (draftId: string) => void
}

/** The kit's state and verdict, from the runtime's. */
const STATES: Readonly<Record<State, ReviewDraftState>> = {
  pending: ReviewDraftState.Pending,
  posting: ReviewDraftState.Posting,
  posted: ReviewDraftState.Posted,
  failed: ReviewDraftState.Failed,
  uncertain: ReviewDraftState.Uncertain,
  discarded: ReviewDraftState.Discarded,
}
const VERDICTS: Readonly<Record<Verdict, ReviewVerdict>> = {
  approve: ReviewVerdict.Approve,
  changes: ReviewVerdict.Changes,
  comment: ReviewVerdict.Comment,
}
const FROM_KIT: Readonly<Record<ReviewVerdict, Verdict>> = {
  [ReviewVerdict.Approve]: 'approve',
  [ReviewVerdict.Changes]: 'changes',
  [ReviewVerdict.Comment]: 'comment',
}

/** A pull request's number as its host writes it: GitLab's merge requests with `!`, the rest with `#`. */
export const numberOf = (product: ReviewBrief['product'], number: number) => `${product === 'gitlab' ? '!' : '#'}${number}`

export function ReviewCard({ draft, actions }: { draft: ReviewDraftContent; actions: ReviewActions }) {
  // What the person chose, shown at once, until the change is read back.
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [kept, setKept] = useState<Readonly<Record<string, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const shown = verdict ?? draft.verdict
  // An automation's first review waits for the person, who can let its next ones post themselves from here.
  const automation = draft.automation ?? null
  const fromNow = actions.onPostFromNow
  const asksOnce = automation !== null && !automation.postsReviews && draft.state === 'pending' && fromNow !== undefined
  return (
    <ReviewDraft
      mark={productBrand(draft.product)}
      source={productName(draft.product)}
      repository={draft.repository}
      number={numberOf(draft.product, draft.number)}
      title={draft.title}
      author={draft.author}
      {...(draft.outside ? { outside: draft.fork ? Outside.Fork : Outside.Author } : {})}
      {...(draft.drafter === null ? {} : { drafter: draft.drafter })}
      {...(draft.account === null ? {} : { as: draft.account })}
      summary={draft.summary}
      summaryView={<Markdown source={draft.summary} />}
      comments={draft.comments.map((comment) => ({
        id: comment.id,
        path: comment.path,
        line: comment.line,
        body: comment.body,
        bodyView: <Markdown source={comment.body} />,
        kept: kept[comment.id] ?? comment.kept,
      }))}
      suggested={VERDICTS[draft.suggested]}
      verdict={shown === null ? null : VERDICTS[shown]}
      state={STATES[draft.state]}
      {...(draft.error === null ? {} : { error: draft.error })}
      {...(draft.review === null ? {} : { review: { href: draft.review.url } })}
      onVerdict={(chosen) => {
        const next = FROM_KIT[chosen]
        setVerdict(next)
        void actions.onChange(draft.draftId, { verdict: next }).finally(() => setVerdict(null))
      }}
      onKeep={(id, on) => {
        setKept((was) => ({ ...was, [id]: on }))
        void actions
          .onChange(draft.draftId, { comments: [{ id, kept: on }] })
          .finally(() => setKept((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key !== id))))
      }}
      onChange={(edit) => {
        setSaving(true)
        void actions.onChange(draft.draftId, { summary: edit.summary, comments: edit.comments }).finally(() => setSaving(false))
      }}
      onPost={() => actions.onPost(draft.draftId)}
      {...(asksOnce ? { onPostFromNow: () => fromNow(draft.draftId, automation.id) } : {})}
      onDiscard={() => actions.onDiscard(draft.draftId)}
      saving={saving}
    />
  )
}

/** The pull request a review task reviews, as its thread opens with it: unfurled under what the person asked. */
export const reviewedUnfurl = (review: ReviewBrief): Unfurl => ({
  kind: 'change',
  product: review.product,
  key: `PR ${numberOf(review.product, review.number)}`,
  title: review.title,
  url: review.url,
  // Open as it was when the review began: Althar doesn't listen to someone else's pull request.
  state: 'open',
  repository: review.repository,
})

export const reachText = {
  reads: (author: string) => `Reads ${author}’s branch`,
  readsMeans: 'A copy of the pull request’s head, which the agent can’t change.',
  runs: 'runs nothing of it',
  runsMeans: 'No install, build, tests or scripts. Commands that only look are allowed.',
  offline: 'no network',
  offlineMeans: (source: string) =>
    `From outside the team. The agent sees its code, and its description, checks and comments on ${source}.`,
  posts: 'posts nothing until you do',
  postsMeans: (source: string) => `Nothing reaches ${source} until you post the draft.`,
  postsItself: 'posts once drafted',
  postsItselfMeans: (source: string) => `Your team’s reviews post on ${source} once drafted. Change it in Settings.`,
}

/** What a review task's lead can reach, as the sentence under its header says it. */
export const reachOf = (review: ReviewBrief, postsItself: boolean, text = reachText): ReadonlyArray<ReachPhrase> => {
  const source = productName(review.product)
  return [
    { id: 'reads', words: text.reads(review.author), means: text.readsMeans },
    { id: 'runs', words: text.runs, means: text.runsMeans },
    ...(review.outside ? [{ id: 'network', words: text.offline, means: text.offlineMeans(source) }] : []),
    postsItself && !review.outside
      ? { id: 'posts', words: text.postsItself, means: text.postsItselfMeans(source) }
      : { id: 'posts', words: text.posts, means: text.postsMeans(source) },
  ]
}
