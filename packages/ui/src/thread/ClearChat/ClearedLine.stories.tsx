import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { ClearedLine } from './ClearedLine'

const meta = {
  title: 'Thread/ClearedLine',
  component: ClearedLine,
  decorators: [threadDecorator],
  args: { earlierOpen: false, onShowEarlier: fn(), onBackToNow: fn(), onUndo: fn() },
} satisfies Meta<typeof ClearedLine>
export default meta
type Story = StoryObj<typeof meta>

/** Where the view was cleared: the earlier conversation a press away, and Undo. */
export const Cleared: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show earlier' }))
    await expect(args.onShowEarlier).toHaveBeenCalledOnce()
  },
}

/** The earlier conversation is read in the thread's place; the way back is at the top. */
export const ReadingEarlier: Story = {
  args: { earlierOpen: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Back to now' }))
    await expect(args.onBackToNow).toHaveBeenCalledOnce()
  },
}
