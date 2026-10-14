import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TaskActivity } from '../../foundations/vocabulary'
import { AbandonTask } from './AbandonTask'

const meta = {
  title: 'Chrome/AbandonTask',
  component: AbandonTask,
  parameters: { layout: 'fullscreen' },
  args: {
    activity: TaskActivity.Working,
    worktree: '~/Althar/meridian/add-a-retry/api',
    branch: 'althar/add-a-retry',
    onAbandon: fn(),
    onClose: fn(),
  },
  decorators: [(Story) => <div style={{ minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof AbandonTask>
export default meta
type Story = StoryObj<typeof meta>

/** With agents on it: they stop, and its worktree and branch stay. */
export const Working: Story = {}
/** Its plan waits to start: it doesn't. */
export const Planned: Story = { args: { activity: TaskActivity.Planned } }
/** Stopped, or ready: nothing runs, so nothing is said to stop. */
export const Still: Story = { args: { activity: TaskActivity.Still } }
const PR = { id: 'pr-1206', name: 'pull request #1206', host: 'GitHub' }

/** With a pull request open: closing it on its host is on, deleting its branch there is off. */
export const WithPullRequest: Story = {
  args: { activity: TaskActivity.Still, changes: [PR] },
  play: async ({ args }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Abandon this task?' })
    await expect(within(dialog).getByRole('checkbox', { name: 'Close pull request #1206 on GitHub' })).toBeChecked()
    await expect(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' })).not.toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: ['pr-1206'], deleteBranch: [] })
  },
}
/** Its branch deleted on the host too: the branch here stays, and the dialog says so. */
export const DeletingItsBranch: Story = {
  args: { activity: TaskActivity.Still, changes: [PR] },
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Abandon this task?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' }))
    await expect(dialog).toHaveTextContent('Its branch althar/add-a-retry stays on this Mac.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: ['pr-1206'], deleteBranch: ['pr-1206'] })
  },
}
/** Left open: nothing is asked of the host, and its branch there can't be deleted alone. */
export const LeavingItOpen: Story = {
  args: { activity: TaskActivity.Still, changes: [PR] },
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Abandon this task?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete its branch on GitHub' }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Close pull request #1206 on GitHub' }))
    await expect(within(dialog).queryByRole('checkbox', { name: 'Delete its branch on GitHub' })).toBeNull()
    await expect(dialog).toHaveTextContent('Nothing is pushed or deleted.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledWith({ close: [], deleteBranch: [] })
  },
}
/** A pull request in each of two repositories, each its own choice. */
export const TwoPullRequests: Story = {
  args: { activity: TaskActivity.Still, changes: [PR, { id: 'mr-12', name: 'merge request !12', host: 'GitLab' }] },
}
/** Abandoned, but the host wouldn't close it: it says so, and offers to try again. */
export const CloseFailed: Story = {
  args: {
    activity: TaskActivity.Still,
    changes: [PR],
    abandoned: true,
    error: 'Pull request #1206 is still open. GitHub won’t let this account do that: Resource not accessible by integration.',
  },
}
/** Before its worktree was made, it has none to leave. */
export const NoWorktree: Story = {
  args: { activity: TaskActivity.Planned, worktree: null, branch: null },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toHaveTextContent('You can reopen it later.')
  },
}
/** A plain task, whose lead changed nothing in the repository: its worktree stays, and it has no branch to. */
export const Plain: Story = {
  args: { activity: TaskActivity.Still, branch: null },
  play: async () => {
    const dialog = within(document.body).getByRole('dialog')
    await expect(dialog).not.toHaveTextContent('branch')
    await expect(dialog).toHaveTextContent('You can reopen it later, on the same worktree.')
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
/** The runtime said no. */
export const Failed: Story = { args: { error: 'The task is merged, so it stays done.' } }

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
    await expect(dialog).toHaveTextContent('Its worktree stays in ~/Althar/meridian/add-a-retry/api, as it is.')
    await expect(dialog).toHaveTextContent('Its branch althar/add-a-retry stays. Nothing is pushed or deleted.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abandon task' }))
    await expect(args.onAbandon).toHaveBeenCalledOnce()
  },
}
