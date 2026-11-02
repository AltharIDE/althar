import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { POSTED_REVIEW, REVIEW_DRAFT } from '../../fixtures/reviews'
import { Outside, ReviewDraftState, ReviewVerdict } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from '../Markdown/Markdown'
import { Turn } from '../Turn/Turn'
import { ReviewDraft, type ReviewDraftEdit, type ReviewDraftProps } from './ReviewDraft'

const meta = {
  title: 'Thread/ReviewDraft',
  component: ReviewDraft,
  decorators: [threadDecorator],
  args: {
    ...REVIEW_DRAFT,
    comments: REVIEW_DRAFT.comments.map((comment) => ({ ...comment, bodyView: <Markdown source={comment.body} /> })),
    summaryView: <Markdown source={REVIEW_DRAFT.summary} />,
    outside: Outside.Fork,
    state: ReviewDraftState.Pending,
    onVerdict: fn(),
    onKeep: fn(),
    onChange: fn(),
    onPost: fn(),
    onDiscard: fn(),
    onReach: fn(),
  },
} satisfies Meta<typeof ReviewDraft>
export default meta
type Story = StoryObj<typeof meta>

/** The lead's draft, waiting on you, with its suggestion beside your verdict: nothing reaches GitHub until you post it. */
export const Pending: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('article', { name: /Review draft · GitHub · meridian\/api #1212/ })).toBeInTheDocument()
    await expect(c.getByText('ninemate, from a fork · drafted by Claude Code')).toBeInTheDocument()
    await expect(c.getByRole('radio', { name: 'Request changes' })).toBeChecked()
    await expect(c.getByText('Claude Code suggests Request changes')).toBeInTheDocument()
    await expect(c.getByText('Posts as ada, 3 of 3 comments')).toBeInTheDocument()
    await expect(c.getByText('Written from ninemate’s code and words, which may try to steer it.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('radio', { name: 'Comment' }))
    await expect(args.onVerdict).toHaveBeenCalledWith(ReviewVerdict.Comment)
    await userEvent.click(c.getByRole('switch', { name: 'Keep the comment on src/webhooks/retry.ts:57' }))
    await expect(args.onKeep).toHaveBeenCalledWith('c3', false)
    await userEvent.click(c.getByRole('button', { name: 'What it could reach' }))
    await expect(args.onReach).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Post review' }))
    await expect(args.onPost).toHaveBeenCalled()
  },
}

/** From outside, the lead would approve: that's only a suggestion, and no verdict is chosen for you. Post asks for one first. */
export const OutsideWithNoVerdict: Story = {
  args: { suggested: ReviewVerdict.Approve, verdict: null, outside: Outside.Author },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('ninemate, from outside the team · drafted by Claude Code')).toBeInTheDocument()
    await expect(c.getByText('Claude Code suggests Approve')).toBeInTheDocument()
    for (const name of ['Comment', 'Approve', 'Request changes']) await expect(c.getByRole('radio', { name })).not.toBeChecked()
    await userEvent.click(c.getByRole('button', { name: 'Post review' }))
    await expect(args.onPost).not.toHaveBeenCalled()
    await expect(c.getByRole('button', { name: 'Post review' })).toHaveAccessibleDescription('Choose a verdict first')
    await expect(c.getAllByRole('radio')[0]).toHaveFocus()
  },
}

/** A comment you dropped: struck through, still there to keep again, and the note counts what goes. */
export const ACommentDropped: Story = {
  args: { comments: REVIEW_DRAFT.comments.map((comment) => ({ ...comment, kept: comment.id !== 'c3' })) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('switch', { name: 'Keep the comment on src/webhooks/retry.ts:57' })).toHaveAttribute('aria-checked', 'false')
    await expect(c.getByText('Dropped')).toBeInTheDocument()
    await expect(c.getByText('Posts as ada, 2 of 3 comments')).toBeInTheDocument()
  },
}

/** A team's pull request, drafted with nothing to say on its lines. */
export const NoComments: Story = {
  args: { comments: [], outside: undefined, suggested: ReviewVerdict.Approve, verdict: ReviewVerdict.Approve, as: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('list')).not.toBeInTheDocument()
    await expect(c.queryByText(/^Posts/)).not.toBeInTheDocument()
    await expect(c.queryByText(/may try to steer it/)).not.toBeInTheDocument()
  },
}

/** Being posted: Post shows it, and nothing can change meanwhile. */
export const Posting: Story = {
  args: { state: ReviewDraftState.Posting },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Post review' })).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByText('Posting on GitHub…')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
    await expect(c.getAllByRole('switch')[0]).toBeDisabled()
  },
}

/** GitHub turned it down: the card says why, and it can be posted again. */
export const Failed: Story = {
  args: { state: ReviewDraftState.Failed, error: 'Pull request review thread line must be part of the diff' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Couldn’t post it on GitHub\. Pull request review thread line/)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Post again' })).toBeInTheDocument()
  },
}

/** Perhaps posted: GitHub's answer was lost, so you look there before posting it again. */
export const Uncertain: Story = {
  args: {
    state: ReviewDraftState.Uncertain,
    error: 'Its answer was lost, so Althar can’t tell whether GitHub took it. Look on the pull request before you post it again.',
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/This may be on GitHub already\. Its answer was lost/)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Post again' })).toBeInTheDocument()
  },
}

/** Posted: one line, its verdict and how many comments went, and the review's link. */
export const Posted: Story = {
  args: {
    state: ReviewDraftState.Posted,
    review: POSTED_REVIEW,
    comments: REVIEW_DRAFT.comments.map((comment) => ({ ...comment, kept: comment.id !== 'c3' })),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Review posted on #1212:/)).toBeInTheDocument()
    await expect(c.getByText('Request changes')).toBeInTheDocument()
    await expect(c.getByText(/2 comments/)).toBeInTheDocument()
    const link = c.getByRole('link', { name: /Open on GitHub/ })
    await expect(link).toHaveAttribute('href', POSTED_REVIEW.href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(c.queryByRole('button')).not.toBeInTheDocument()
  },
}

/** Posted where the host gave no address to open: the line, with no link. */
export const PostedWithoutALink: Story = {
  args: { state: ReviewDraftState.Posted, review: { href: 'github://review/2981' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).not.toBeInTheDocument()
  },
}

/** Thrown away: a quiet line, its title struck through. */
export const Discarded: Story = { args: { state: ReviewDraftState.Discarded } }

/** Where the consumer gives no callbacks, there are no controls: the verdict is said, not chosen. */
export const WithoutActions: Story = {
  args: {
    onVerdict: undefined,
    onKeep: undefined,
    onChange: undefined,
    onPost: undefined,
    onDiscard: undefined,
    onReach: undefined,
    verdict: null,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button')).not.toBeInTheDocument()
    await expect(c.queryByRole('switch')).not.toBeInTheDocument()
    await expect(c.getByText('None chosen')).toBeInTheDocument()
  },
}

/** Edit turns the card into a form: the summary, and each comment's words, with focus in the summary. */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await expect(c.getByRole('form', { name: 'Edit the review draft' })).toBeInTheDocument()
    await expect(c.getByRole('textbox', { name: 'Summary' })).toHaveFocus()
    await expect(c.getByRole('textbox', { name: 'Comment on src/webhooks/retry.ts:57' })).toHaveValue('Nit: `waitMs` is seconds here.')
  },
}

/** Saved with an empty summary, or an empty comment, it says so beside the field and puts focus there. */
export const SavedWithSomethingEmpty: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const summary = c.getByRole('textbox', { name: 'Summary' })
    await userEvent.clear(summary)
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(summary).toHaveAccessibleDescription('Write a summary first')
    await expect(summary).toHaveFocus()
    await userEvent.type(summary, 'Right fix.')
    await expect(c.queryByText('Write a summary first')).not.toBeInTheDocument()
    const nit = c.getByRole('textbox', { name: 'Comment on src/webhooks/retry.ts:57' })
    await userEvent.clear(nit)
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(nit).toHaveAccessibleDescription('Write the comment, or drop it')
    await expect(nit).toHaveFocus()
    await userEvent.type(nit, 'Seconds, not ms.')
    await expect(c.queryByText('Write the comment, or drop it')).not.toBeInTheDocument()
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

/** The consumer that keeps the draft, and how long its save takes. */
function Kept({ onSaved, ...props }: Omit<ReviewDraftProps, 'onChange'> & { onSaved?: (edit: ReviewDraftEdit) => void }) {
  const [draft, setDraft] = useState({ summary: props.summary, comments: props.comments })
  const [saving, setSaving] = useState(false)
  return (
    <ReviewDraft
      {...props}
      summary={draft.summary}
      summaryView={undefined}
      comments={draft.comments}
      saving={saving}
      onChange={(edit) => {
        onSaved?.(edit)
        setSaving(true)
        window.setTimeout(() => {
          setDraft({
            summary: edit.summary,
            comments: draft.comments.map((comment) => ({
              ...comment,
              bodyView: undefined,
              body: edit.comments.find((one) => one.id === comment.id)?.body ?? comment.body,
            })),
          })
          setSaving(false)
        }, 200)
      }}
    />
  )
}

const saved = fn()

/** Saved: the form stays while the save is under way, and focus goes back to Edit. */
export const Saving: Story = {
  render: (args) => <Kept {...args} onSaved={saved} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    const summary = c.getByRole('textbox', { name: 'Summary' })
    await userEvent.clear(summary)
    await userEvent.type(summary, '  Right fix; needs a test.  ')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(saved).toHaveBeenCalledWith({
      summary: 'Right fix; needs a test.',
      comments: REVIEW_DRAFT.comments.map((comment) => ({ id: comment.id, body: comment.body })),
    })
    await expect(c.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus())
    await expect(c.getByText('Right fix; needs a test.')).toBeInTheDocument()
  },
}

/** Escape, from anywhere in the form, puts it away; so does Cancel. Focus goes back to Edit. */
export const EscapeCancels: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await userEvent.type(c.getByRole('textbox', { name: 'Summary' }), ' now')
    await userEvent.keyboard('{Escape}')
    await expect(c.queryByRole('form')).not.toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(c.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await expect(args.onChange).not.toHaveBeenCalled()
  },
}

/** The consumer that posts it: a moment on its way, then its line. */
function Poster(props: ReviewDraftProps) {
  const [state, setState] = useState(ReviewDraftState.Pending)
  return (
    <ReviewDraft
      {...props}
      state={state}
      review={POSTED_REVIEW}
      onPost={() => {
        setState(ReviewDraftState.Posting)
        window.setTimeout(() => setState(ReviewDraftState.Posted), 200)
      }}
      onDiscard={() => setState(ReviewDraftState.Discarded)}
    />
  )
}

/** Posted from the card: it shows it on its way, then folds to its line, and focus goes to the line. */
export const PostedFromTheCard: Story = {
  render: (args) => <Poster {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Post review' }))
    await expect(c.getByText('Posting on GitHub…')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('link', { name: /Open on GitHub/ })).toBeInTheDocument())
    await waitFor(() => expect(c.getByRole('article')).toHaveFocus())
  },
}

/** Discarded from the card: it folds to its line, and focus goes there. */
export const DiscardedFromTheCard: Story = {
  render: (args) => <Poster {...args} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Discard' }))
    await expect(c.getByText('Review draft discarded')).toBeInTheDocument()
    await waitFor(() => expect(c.getByRole('article')).toHaveFocus())
  },
}

/**
 * An automation's first review waits for you, as any does; beside Post, the
 * one way to let its next reviews post themselves. It needs a verdict too.
 */
export const AnAutomationsFirst: Story = {
  args: { outside: undefined, onPostFromNow: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Post this automation’s reviews from now on' }))
    await expect(args.onPostFromNow).toHaveBeenCalled()
    await expect(args.onPost).not.toHaveBeenCalled()
  },
}

/** With no verdict chosen, posting from now on asks for one first, as Post does. */
export const AnAutomationsFirstWithNoVerdict: Story = {
  args: { outside: undefined, verdict: null, onPostFromNow: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Post this automation’s reviews from now on' }))
    await expect(c.getByText('Choose a verdict first')).toBeInTheDocument()
    await expect(args.onPostFromNow).not.toHaveBeenCalled()
  },
}

/** Once it is on its way or failed, only posting it again is offered. */
export const AnAutomationsPosting: Story = {
  args: { outside: undefined, state: ReviewDraftState.Failed, onPostFromNow: fn() },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: 'Post this automation’s reviews from now on' })).toBeNull()
    await expect(c.getByRole('button', { name: 'Post again' })).toBeInTheDocument()
  },
}

/** Where a draft comes from: the lead's words, then its card. */
export const InTheConversation: Story = {
  render: (args) => (
    <>
      <Turn voice="Claude Code" at="11:40">
        The fix is right, but nothing covers a Retry-After longer than the cap. I’d request changes for that.
      </Turn>
      <ReviewDraft {...args} />
    </>
  ),
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:last-of-type', focus: 'button:last-of-type', pressed: 'button:last-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'pending, with the lead’s suggestion', node: <ReviewDraft {...args} /> },
        {
          state: 'outside, no verdict chosen',
          node: <ReviewDraft {...args} suggested={ReviewVerdict.Approve} verdict={null} outside={Outside.Author} />,
        },
        {
          state: 'a comment dropped',
          node: <ReviewDraft {...args} comments={args.comments.map((comment) => ({ ...comment, kept: comment.id !== 'c3' }))} />,
        },
        { state: 'no comments, a team’s', node: <ReviewDraft {...args} comments={[]} outside={undefined} /> },
        { state: 'an automation’s first', node: <ReviewDraft {...args} outside={undefined} onPostFromNow={() => {}} /> },
        { state: 'hover', node: <ReviewDraft {...args} /> },
        { state: 'focus', node: <ReviewDraft {...args} /> },
        { state: 'pressed', node: <ReviewDraft {...args} /> },
        { state: 'posting', node: <ReviewDraft {...args} state={ReviewDraftState.Posting} /> },
        {
          state: 'failed',
          node: <ReviewDraft {...args} state={ReviewDraftState.Failed} error="GitHub took too long to answer. Nothing was posted." />,
        },
        {
          state: 'uncertain',
          node: <ReviewDraft {...args} state={ReviewDraftState.Uncertain} error="Look on the pull request before you post it again." />,
        },
        { state: 'posted, folded', node: <ReviewDraft {...args} state={ReviewDraftState.Posted} review={POSTED_REVIEW} /> },
        { state: 'discarded', node: <ReviewDraft {...args} state={ReviewDraftState.Discarded} /> },
      ]}
    />
  ),
}
