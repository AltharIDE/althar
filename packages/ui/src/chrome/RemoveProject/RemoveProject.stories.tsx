import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RemoveProject } from './RemoveProject'

const meta = {
  title: 'Chrome/RemoveProject',
  component: RemoveProject,
  parameters: { layout: 'fullscreen' },
  args: { project: 'meridian', working: 2, worktrees: '~/Althar/meridian', onRemove: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof RemoveProject>
export default meta
type Story = StoryObj<typeof meta>

/** With work under way: what stops, and what stays where. */
export const Working: Story = {}
/** One task under way. */
export const OneTask: Story = { args: { working: 1 } }
/** Nothing running, and no worktrees made yet. */
export const Quiet: Story = { args: { working: 0, worktrees: null } }
/** Removing it. */
export const Busy: Story = { args: { busy: true } }
/** The runtime said no. */
export const Failed: Story = { args: { error: 'Althar couldn’t remove the project.' } }

/** Cancel has focus: Enter alone removes nothing. */
export const SafeByDefault: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onRemove).not.toHaveBeenCalled()
    await expect(args.onClose).toHaveBeenCalled()
  },
}

export const Removing: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Remove project' }))
    await expect(args.onRemove).toHaveBeenCalledOnce()
  },
}
