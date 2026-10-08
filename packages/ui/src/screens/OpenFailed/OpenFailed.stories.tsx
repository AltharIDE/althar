import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { OpenFailed } from './OpenFailed'

const meta = {
  title: 'Screens/OpenFailed',
  component: OpenFailed,
  parameters: { layout: 'fullscreen' },
  args: { reason: 'The runtime didn’t start.', onRetry: fn() },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OpenFailed>
export default meta
type Story = StoryObj<typeof meta>

/** The runtime never sent its port. */
export const NeverStarted: Story = {}

/** Connecting, or the first reads, failed, with what was said. */
export const ReadFailed: Story = { args: { reason: 'SQLITE_CANTOPEN: unable to open database file' } }

export const TryingAgain: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalledOnce()
  },
}
