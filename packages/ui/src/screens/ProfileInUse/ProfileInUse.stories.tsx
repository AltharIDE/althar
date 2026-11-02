import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ProfileInUse } from './ProfileInUse'

const meta = {
  title: 'Screens/ProfileInUse',
  component: ProfileInUse,
  parameters: { layout: 'fullscreen' },
  args: {
    reason: 'Another copy of Althar is using this profile.',
    onTryAgain: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProfileInUse>
export default meta
type Story = StoryObj<typeof meta>

/** Another Althar or the command line has the profile open: it says so, that Althar can open again once that closes, and tries again on the person's word. */
export const InUse: Story = {
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByRole('alert')).toHaveTextContent('Another copy of Althar is using this profile.')
    await expect(page.getByRole('alert')).toHaveTextContent('Close it, then try again.')
    await userEvent.click(page.getByRole('button', { name: 'Try again' }))
    await expect(args.onTryAgain).toHaveBeenCalledOnce()
  },
}
