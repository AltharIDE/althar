import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ApiVersionMismatch } from './ApiVersionMismatch'

const meta = {
  title: 'Screens/ApiVersionMismatch',
  component: ApiVersionMismatch,
  parameters: { layout: 'fullscreen' },
  args: {
    windowVersion: 2,
    runtimeVersion: 1,
    onTryAgain: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApiVersionMismatch>
export default meta
type Story = StoryObj<typeof meta>

/** The runtime serves another API version than the window speaks: it names both, says what puts it right, and tries again on the person's word. */
export const Mismatched: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('alert')).toHaveTextContent('The window speaks API version 2; the runtime serves version 1.')
    await userEvent.click(page.getByRole('button', { name: 'Try again' }))
    await expect(args.onTryAgain).toHaveBeenCalledOnce()
  },
}

/** A window that said no version at all is refused the same way. */
export const NoVersionSaid: Story = {
  args: { windowVersion: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('didn’t say which API version')
  },
}
