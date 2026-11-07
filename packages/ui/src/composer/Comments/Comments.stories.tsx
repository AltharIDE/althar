import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { COMMENTS } from '../../fixtures/pages'
import { Composer } from '../Composer/Composer'
import { CommentCard, CommentChip } from './Comments'

const first = COMMENTS[0]!

const meta = {
  title: 'Composer/Comments',
  component: CommentChip,
  args: { comment: first, onOpen: fn(), onRemove: fn() },
} satisfies Meta<typeof CommentChip>
export default meta
type Story = StoryObj<typeof meta>

/** A comment waiting in the composer: its crop small, its number and words, where it is. */
export const Chip: Story = {}
export const ChipDark: Story = { ...Chip, globals: { theme: 'dark' } }

/** Pointed at: its card, the crop, what was said, then the element as the page drew it. */
export const Card: Story = {
  render: () => (
    <div style={{ width: 316, padding: 12, background: 'var(--paper)', boxShadow: 'var(--lift-pop)', borderRadius: 10 }}>
      <CommentCard comment={first} />
    </div>
  ),
}
export const CardDark: Story = { ...Card, globals: { theme: 'dark' } }

/** Hovering the chip opens the card over it. */
export const Hovered: Story = {
  decorators: [(Story) => <div style={{ paddingTop: 460 }}>{Story()}</div>],
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: /Comment 1/ }))
    await expect(await within(canvasElement.ownerDocument.body).findAllByText('main > div.banner')).not.toHaveLength(0)
  },
}

/** Pressed, it opens again on the page; ✕ takes it off. */
export const Pressed: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /Comment 1/ }))
    await expect(args.onOpen).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Remove comment 1' }))
    await expect(args.onRemove).toHaveBeenCalled()
  },
}

/** In the composer, beside the person's own attachments; with them, it sends with nothing written. */
export const InTheComposer: Story = {
  render: () => (
    <div style={{ width: 600, paddingTop: 40 }}>
      <Composer
        value=""
        onChange={fn()}
        onSubmit={fn()}
        placeholder="Tell Claude Code something"
        comments={COMMENTS}
        onOpenComment={fn()}
        onRemoveComment={fn()}
        files={[{ id: 'f1', name: 'refunds.log', meta: '2 KB' }]}
        onRemoveFile={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('list', { name: '3 attachments to send' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: /Send/ })).toBeEnabled()
  },
}
export const InTheComposerDark: Story = { ...InTheComposer, globals: { theme: 'dark' } }
