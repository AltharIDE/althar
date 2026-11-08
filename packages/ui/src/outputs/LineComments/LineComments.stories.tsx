import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ADDRESSED, GATHERED, ON_BUCKET, ON_OUTERMOST, SENT } from '../../fixtures/lineComments'
import { ROUTER_DIFF } from '../../fixtures/meridian'
import { You } from '../../thread/You/You'
import { ChangeView, type ChangeViewProps, type ViewedFile } from '../ChangeView/ChangeView'
import { CommentExcerpt, type ViewedComment } from './LineComments'

const FILES: ViewedFile[] = [
  { path: 'src/refunds/router.ts', status: 'modified', add: 5, del: 1 },
  { path: 'src/charges/limit.ts', status: 'modified', add: 14, del: 3 },
  { path: 'src/refunds/limit.test.ts', status: 'added', add: 48, del: 0 },
]

/**
 * The Changes view where the person comments on lines, as the app keeps
 * them: a new one waits to go, numbered after the others; Send takes those
 * waiting to the lead.
 */
const Commenting = (args: ChangeViewProps) => {
  const [comments, setComments] = useState<readonly ViewedComment[]>(args.comments ?? [])
  const renumber = (all: readonly ViewedComment[]) => {
    let n = 0
    return all.map((one) => (one.state === 'draft' ? { ...one, n: (n += 1) } : one))
  }
  return (
    <ChangeView
      {...args}
      comments={comments}
      onComment={(made) => {
        args.onComment?.(made)
        setComments((now) => renumber([...now, { ...made, id: `comment-${now.length + 1}`, state: 'draft', line: made.end }]))
      }}
      onEditComment={(id, note) => {
        args.onEditComment?.(id, note)
        setComments((now) => now.map((one) => (one.id === id ? { ...one, note } : one)))
      }}
      onRemoveComment={(id) => {
        args.onRemoveComment?.(id)
        setComments((now) => renumber(now.filter((one) => one.id !== id)))
      }}
      onSendComments={() => {
        args.onSendComments?.()
        setComments((now) => now.map(({ n: _n, ...one }) => (one.state === 'draft' ? { ...one, state: 'sent', sentAt: 'now' } : one)))
      }}
    />
  )
}

const meta = {
  title: 'Outputs/LineComments',
  component: ChangeView,
  parameters: { layout: 'fullscreen' },
  args: {
    branch: 'althar/mer-231-rate-limit-refunds',
    base: 'main',
    files: FILES,
    selected: 'src/refunds/router.ts',
    onSelect: fn(),
    view: { state: 'ready', lines: ROUTER_DIFF },
    onClose: fn(),
    onComment: fn(),
    onEditComment: fn(),
    onRemoveComment: fn(),
    onSendComments: fn(),
  },
  render: (args) => <Commenting {...args} />,
} satisfies Meta<typeof ChangeView>
export default meta
type Story = StoryObj<typeof meta>

/** No comments yet: a line's number picks it, Shift with another a range, and the box opens under them. */
export const Empty: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.queryByRole('button', { name: /^Send/ })).toBeNull()
    // One person's hands: Shift held across the second press.
    const user = userEvent.setup()
    await user.click(body.getByRole('button', { name: 'Comment on line 22' }))
    await user.keyboard('{Shift>}')
    await user.click(body.getByRole('button', { name: 'Comment on line 23' }))
    await user.keyboard('{/Shift}')
    const box = body.getByRole('textbox', { name: 'Comment on lines 22–23' })
    await waitFor(() => expect(box).toHaveFocus())
    await expect(body.getByRole('button', { name: 'Comment on line 23' })).toHaveAttribute('aria-pressed', 'true')
    // Nothing written, nothing to add.
    await expect(body.getByRole('button', { name: 'Comment' })).toBeDisabled()
    await expect(args.onComment).not.toHaveBeenCalled()
  },
}

/** Comments gathered before sending: each a note under its lines, numbered as its chip in the composer is; Send takes them all. */
export const Gathering: Story = {
  args: { comments: GATHERED },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('button', { name: 'Send 2 comments' })).toBeInTheDocument()
    await expect(body.getByText('Lines 22–23')).toBeInTheDocument()
    await expect(body.getByText('Removed line 20')).toBeInTheDocument()
    // A third, on the import, with Enter; then taken off again.
    await userEvent.click(body.getByRole('button', { name: 'Comment on line 19' }))
    await userEvent.type(body.getByRole('textbox', { name: 'Comment on line 19' }), 'Import it from the limiter’s index.{Enter}')
    await expect(args.onComment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'src/refunds/router.ts',
        side: 'new',
        start: 19,
        end: 19,
        note: 'Import it from the limiter’s index.',
      }),
    )
    await expect(body.getByRole('button', { name: 'Send 3 comments' })).toBeInTheDocument()
    const third = body.getByRole('article', { name: 'Comment on line 19' })
    await userEvent.click(within(third).getByRole('button', { name: 'Remove' }))
    await expect(body.getByRole('button', { name: 'Send 2 comments' })).toBeInTheDocument()
    // One written before opens again in its box, to change.
    const first = body.getByRole('article', { name: 'Comment on lines 22–23' })
    await userEvent.click(within(first).getByRole('button', { name: 'Edit' }))
    const box = body.getByRole('textbox', { name: 'Comment on lines 22–23' })
    await userEvent.type(box, ' Same for retryAfter.{Enter}')
    await expect(args.onEditComment).toHaveBeenCalledWith('comment-bucket', `${ON_BUCKET.note} Same for retryAfter.`)
    // Escape in a box leaves the box, not the view.
    await userEvent.click(within(body.getByRole('article', { name: 'Comment on lines 22–23' })).getByRole('button', { name: 'Edit' }))
    await userEvent.keyboard('{Escape}')
    await expect(body.getByRole('dialog', { name: 'Changes' })).toBeInTheDocument()
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

/** Sent: the comments stay under their lines, saying so, until the lead's commits address them. */
export const Sent: Story = {
  args: { comments: SENT },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.queryByRole('button', { name: /^Send/ })).toBeNull()
    await expect(body.getAllByText('Sent')).toHaveLength(2)
    await expect(body.getByText('2 comments')).toBeInTheDocument()
  },
}

/** Addressed: a commit of the lead's since changed its lines, and it steps back; the other is still to do. */
export const Addressed: Story = {
  args: { comments: ADDRESSED },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('article', { name: 'Comment on lines 22–23' })).toHaveAttribute('data-state', 'addressed')
    await expect(body.getByText('Addressed')).toBeInTheDocument()
    await expect(body.getByText('1 comment')).toBeInTheDocument()
  },
}

/** Sent, in the thread: the person's message, its comments each with its code; its place opens the diff on it. */
export const InTheThread: StoryObj = {
  parameters: { layout: 'padded' },
  render: () => {
    const open = fn()
    return (
      <div style={{ maxWidth: 680 }}>
        <You
          at="2m"
          comments={[ON_BUCKET, ON_OUTERMOST].map((one) => (
            <CommentExcerpt key={one.id} comment={one} onOpen={() => open(one.id)} />
          ))}
        >
          Two things on the router.
        </You>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Open src/refunds/router.ts, lines 22–23, in the diff' })).toBeInTheDocument()
    await expect(canvas.getByText("refunds.post('/', idempotent(createRefund))")).toBeInTheDocument()
  },
}
