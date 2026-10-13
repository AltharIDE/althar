import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Diverged } from './Diverged'

const meta = {
  title: 'Outputs/Diverged',
  component: Diverged,
  decorators: [(Story) => <div style={{ maxWidth: 640 }}>{Story()}</div>],
  args: { kind: 'rewritten', local: 5, onPullRequest: 4, named: 'PR #124', onReplace: fn(), onMerge: fn() },
} satisfies Meta<typeof Diverged>
export default meta
type Story = StoryObj<typeof meta>

/** The lead rewrote what was pushed: said plainly, with nothing offered to push, and the two ways out. */
export const Rewritten: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(c.getByText('This branch was rewritten since it was pushed: 5 new commits replace 4 on the pull request.')).toBeVisible()
    await expect(c.queryByRole('button', { name: /^Push/ })).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Ask the lead to merge instead' }))
    await expect(args.onMerge).toHaveBeenCalled()
  },
}

/** Replacing asks once more, naming what goes, and only then pushes; cancelling leaves it as it was. */
export const ConfirmingReplace: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Replace the pull request’s commits' }))
    await expect(args.onReplace).not.toHaveBeenCalled()
    await expect(
      c.getByText(
        'Replace the 4 commits on PR #124 with the 5 commits here? If anyone pushed to it since you looked, nothing is replaced.',
      ),
    ).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(c.queryByText(/If anyone pushed/)).not.toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Replace the pull request’s commits' }))
    await userEvent.click(c.getByRole('button', { name: 'Replace them' }))
    await expect(args.onReplace).toHaveBeenCalledTimes(1)
  },
}

/** Its commits gone with nothing new in their place: said as that. */
export const RewrittenAway: Story = { args: { local: 0, onPullRequest: 2 } }

/** With no way to replace, such as no pull request head seen to replace from, only the lead's merge is offered. */
export const NoReplace: Story = {
  args: { onReplace: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /Replace/ })).not.toBeInTheDocument()
  },
}

/** Someone pushed to it from elsewhere, such as the host's Update branch: the lead brings those commits in. */
export const Moved: Story = {
  args: { kind: 'moved', local: 1, onPullRequest: 1, onReplace: undefined },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await expect(
      c.getByText('The pull request has 1 commit pushed from elsewhere that isn’t on this branch, so it won’t take a plain push.'),
    ).toBeVisible()
    await userEvent.click(c.getByRole('button', { name: 'Bring in the pull request’s commits' }))
    await expect(args.onMerge).toHaveBeenCalled()
  },
}

/** A push refused before Althar has those commits here to count. */
export const Refused: Story = { args: { kind: 'moved', local: 2, onPullRequest: null, onReplace: undefined } }

/** In a task of several repositories, which one's pull request. */
export const InOneOfSeveral: Story = { args: { pullRequest: 'web’s pull request', named: 'meridian/web #124' } }

/** The lead is being asked: that button works, the other waits. */
export const Asking: Story = { args: { merging: true, locked: true } }
