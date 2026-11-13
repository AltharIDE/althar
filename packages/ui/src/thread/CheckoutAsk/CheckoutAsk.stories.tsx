import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ThreadFrame } from '../../storybook/ThreadFrame'
import { CheckoutAsk } from './CheckoutAsk'

const meta = {
  title: 'Thread/CheckoutAsk',
  component: CheckoutAsk,
  args: {
    repository: 'meridian-ios',
    holdup: 'changes',
    files: ['Meridian/Views/LoginView.swift', 'Meridian.xcodeproj/project.pbxproj'],
    branch: 'main',
    onAnswer: fn(),
  },
  decorators: [(Story) => <ThreadFrame>{Story()}</ThreadFrame>],
} satisfies Meta<typeof CheckoutAsk>
export default meta
type Story = StoryObj<typeof meta>

/** The checkout has changes that aren't committed: the task waits for them, or starts in a worktree. Nothing is stashed. */
export const Changes: Story = {}

/** Answered once: the rest wait for the runtime, which moves on and takes the card with the call. */
export const AnsweredOnce: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Wait until they’re committed' }))
    await expect(args.onAnswer).toHaveBeenCalledWith('wait')
    // Answered once: the rest wait for the runtime.
    await userEvent.click(c.getByRole('button', { name: 'Start in a worktree' }))
    await expect(args.onAnswer).toHaveBeenCalledTimes(1)
  },
}

/** On a branch of the person's own: the task's branch is checked out from main, or from that branch. */
export const Branch: Story = { args: { holdup: 'branch', files: [], branch: 'feature/onboarding' } }

export const StartFromTheirBranch: Story = {
  args: { holdup: 'branch', files: [], branch: 'feature/onboarding' },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Start from feature/onboarding' }))
    await expect(args.onAnswer).toHaveBeenCalledWith('from_branch')
  },
}
