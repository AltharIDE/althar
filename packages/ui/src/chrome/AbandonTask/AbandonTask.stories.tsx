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
/** With a pull request open: it stays open on its host. */
export const WithPullRequest: Story = {
  args: { activity: TaskActivity.Still, change: { name: 'Pull request #1206', host: 'GitHub' } },
}
/** Before its worktree was made, it has none to leave. */
export const NoWorktree: Story = { args: { activity: TaskActivity.Planned, worktree: null, branch: null } }
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
