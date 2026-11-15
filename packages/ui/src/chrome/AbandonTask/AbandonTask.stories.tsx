import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AbandonTask } from './AbandonTask'

const meta = {
  title: 'Chrome/AbandonTask',
  component: AbandonTask,
  parameters: { layout: 'fullscreen' },
  args: {
    worktree: '~/Althar/meridian/add-a-retry/api',
    branch: 'althar/add-a-retry',
    onAbandon: fn(),
    onClose: fn(),
  },
  decorators: [(Story) => <div style={{ minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof AbandonTask>
export default meta
type Story = StoryObj<typeof meta>

/** Its worktree and branch stay. */
export const Default: Story = {}
const PR = { id: 'pr-1206', name: 'pull request #1206', host: 'GitHub' }

/** With a pull request open: closing it on its host is on, deleting its branch there is off. */
export const WithPullRequest: Story = {
  args: { changes: [PR] },
  play: async ({ args }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Abandon this task?' })
    await expect(within(dialog).getByRole('checkbox', { name: 'Close pull request #1206 on GitHub' })).toBeChecked()
    await expect(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' })).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: ['pr-1206'], deleteBranch: [] })
  },
}
/** Its branch deleted on the host too: the branch here stays. */
export const DeletingItsBranch: Story = {
  args: { changes: [PR] },
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Abandon this task?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' }))
    await expect(dialog).toHaveTextContent('Its branch and worktree stay.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: ['pr-1206'], deleteBranch: ['pr-1206'] })
  },
}
/** Left open: nothing is asked of the host, and its branch there can't be deleted alone. */
export const LeavingItOpen: Story = {
  args: { changes: [PR] },
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Abandon this task?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Close pull request #1206 on GitHub' }))
    await expect(within(dialog).queryByRole('checkbox', { name: 'Delete its branch on GitHub' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: [], deleteBranch: [] })
  },
}
/** A pull request in each of two repositories, each its own choice. */
export const TwoPullRequests: Story = {
  args: { changes: [PR, { id: 'mr-12', name: 'merge request !12', host: 'GitLab' }] },
}
/** Abandoned, but the host couldn't be reached to close it: it says so, and offers to try again. */
export const CloseFailed: Story = {
  args: { changes: [PR], abandoned: true, error: 'Althar couldn’t reach GitHub. Check this computer is online.' },
}
/** Abandoned, but the host won't let this account close it: trying again can't change that, so Leave it open is the one way left. */
export const CloseRefused: Story = {
  args: {
    changes: [PR],
    abandoned: true,
    error: 'GitHub won’t let this account do that: Resource not accessible by integration.',
    final: true,
  },
  play: async ({ args }) => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Task abandoned' }))
    await expect(dialog.queryByRole('button', { name: 'Try again' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Leave it open' }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}
/** Merged, with commits after its pull request: those are left out, and it stays merged. */
export const Merged: Story = {
  args: { merged: { name: 'Pull request #142', commits: 1 } },
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    await expect(dialog).toHaveTextContent('Pull request #142 stays merged.')
    await expect(dialog).toHaveTextContent('The commit after it goes in no pull request.')
    await expect(dialog).not.toHaveTextContent('isn’t merged')
  },
}
/** Before its worktree was made, it has none to leave: nothing is said but the question. */
export const NoWorktree: Story = {
  args: { worktree: null, branch: null },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).not.toHaveTextContent('stay')
  },
}
/** A plain task, whose lead changed nothing in the repository: its worktree stays, and it has no branch to. */
export const Plain: Story = {
  args: { branch: null },
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    await expect(dialog).not.toHaveTextContent('branch')
    await expect(dialog).toHaveTextContent('Its worktree stays.')
  },
}
/** A long path and branch wrap inside the dialog. */
export const LongNames: Story = {
  args: {
    worktree: '~/Althar/meridian-payments-platform/backfill-idempotency-keys-on-refunds-created-before-pr-1184/refunds-service',
    branch: 'althar/MER-231-backfill-idempotency-keys-on-refunds-created-before-pr-1184',
  },
}
/** Abandoning it. */
export const Busy: Story = { args: { busy: true } }
/** It didn't go, for a reason pressing again can get past: Abandon task stays, as the way to try again. */
export const Failed: Story = { args: { error: 'Althar couldn’t reach the task’s worktree. Check the disk it’s on is connected.' } }

/** Refused for good: nothing here can change it, so Close is the one way left, and no choice or button offers to fail again. */
export const Refused: Story = {
  args: { changes: [PR], error: 'The task is merged, so it stays done.', final: true },
  play: async ({ args }) => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Abandon this task?' }))
    await expect(dialog.getByRole('alert')).toHaveTextContent('The task is merged, so it stays done.')
    await expect(dialog.queryByRole('button', { name: 'Abandon task' })).toBeNull()
    await expect(dialog.queryByRole('checkbox')).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await expect(args.onClose).toHaveBeenCalled()
    await expect(args.onAbandon).not.toHaveBeenCalled()
  },
}

/** Cancel has focus: Enter alone abandons nothing. */
export const SafeByDefault: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onAbandon).not.toHaveBeenCalled()
    await expect(args.onClose).toHaveBeenCalled()
  },
}

/** Escape closes it, and nothing is abandoned. */
export const Escaping: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await page.findByRole('dialog', { name: 'Abandon this task?' })
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
    await expect(args.onAbandon).not.toHaveBeenCalled()
  },
}

export const Abandoning: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Abandon this task?' })
    await expect(dialog).toHaveTextContent('Its branch and worktree stay.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledOnce()
  },
}

/** Commits that wait for Ship: shipping them is offered first, and settling leaves them on the branch (a task is a conversation plus parts). */
export const WithCommitsNotShipped: Story = {
  args: { changes: [PR], held: { commits: 3, onShip: fn() } },
  play: async ({ args }) => {
    const dialog = within(document.body)
    await expect(dialog.getByText('Its 3 commits not shipped stay on its branch.')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Ship 3 commits' }))
    await expect(args.held?.onShip).toHaveBeenCalled()
  },
}
