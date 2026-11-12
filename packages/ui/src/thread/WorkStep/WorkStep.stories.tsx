import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { WorkStep } from './WorkStep'

const meta = {
  title: 'Thread/WorkStep',
  component: WorkStep,
  decorators: [threadDecorator],
  args: {
    stamp: 'New change',
    children: (
      <>
        <strong>Rename</strong>, on <code>althar/rename-setting</code>
      </>
    ),
  },
} satisfies Meta<typeof WorkStep>
export default meta
type Story = StoryObj<typeof meta>

/** A change started: its name in ink, its branch as code, in cobalt as work under way. */
export const NewChange: Story = {}

/** One the lead split on its own: the way back, at its end. */
export const WithItsWayOn: Story = {
  args: {
    children: (
      <>
        <strong>Terms page</strong>, on <code>althar/terms-page</code>, for DEV-141
      </>
    ),
    action: { label: 'Keep them together', onPress: fn() },
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep them together' }))
    await expect(args.action?.onPress).toHaveBeenCalled()
  },
}

/** Shipped and merged are done, in green. */
export const Done: Story = {
  render: () => (
    <>
      <WorkStep stamp="Shipped" tone="done">
        2 commits to <strong>Lane heights</strong> (#714)
      </WorkStep>
      <WorkStep stamp="Merged" tone="done">
        <strong>Lane heights</strong> (#714)
      </WorkStep>
    </>
  ),
}

/** A long one ends in an ellipsis, the whole on hover. */
export const Long: Story = {
  args: {
    title: 'New change · Bring the release branch’s failing checks back to green before the release goes out, on althar/fix-release-checks',
    children: (
      <>
        <strong>Bring the release branch’s failing checks back to green before the release goes out</strong>, on{' '}
        <code>althar/fix-release-checks</code>, into <code>release/0.8.0</code>
      </>
    ),
  },
}
