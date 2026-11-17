import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { NotBroughtIn } from './NotBroughtIn'

const meta = {
  title: 'Thread/NotBroughtIn',
  component: NotBroughtIn,
  args: {
    title: 'Not everything picked from other tools came in',
    missed: [
      { name: 'lima', why: 'Its branch is “Checkout retry”’s already.' },
      { name: '“Fix the gyroscope fixture”', why: 'It couldn’t be read, so it didn’t come in.' },
      { name: '“Codex conversation”', why: 'Nothing was said in it.' },
    ],
    onTryAgain: fn(),
  },
  // A line of the project's conversation, after a new project brought in what Conductor and Codex left.
  decorators: [
    (Story) => (
      <div style={{ width: 560, padding: '10px 14px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotBroughtIn>
export default meta
type Story = StoryObj<typeof meta>

/** Some came in, some didn't: each by name and why, and Try again for what another try could bring. */
export const Missed: Story = {
  play: async ({ args, canvasElement }) => {
    const line = within(canvasElement)
    await expect(line.getByText('Nothing was said in it.')).toBeInTheDocument()
    await userEvent.click(line.getByRole('button', { name: 'Try again' }))
    await expect(args.onTryAgain).toHaveBeenCalledOnce()
  },
}
export const MissedDark: Story = { ...Missed, globals: { theme: 'dark' } }
/** Bringing in failed as a whole, after the window moved on. */
export const NothingCame: Story = { args: { title: 'Nothing picked from other tools came in', missed: [] } }
/** Nothing another try could bring: no Try again. */
export const NothingToTry: Story = {
  args: { missed: [{ name: '“Codex conversation”', why: 'Nothing was said in it.' }], onTryAgain: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}
/** Under way, at once as it is pressed. */
export const Trying: Story = { args: { tried: 'trying' } }
/** Tried, and it didn't go through. */
export const Failed: Story = { args: { tried: 'tried', error: 'Althar isn’t answering. Try again in a moment.' } }
