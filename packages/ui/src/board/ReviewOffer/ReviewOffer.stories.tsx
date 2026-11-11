import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { ReviewOffer } from './ReviewOffer'

const meta = {
  title: 'Board/ReviewOffer',
  component: ReviewOffer,
  args: { who: 'GPT-6.1 Sol', onAdd: fn(), onDecline: fn() },
  // By a task's composer, where the person made it a change: a quiet line on the task view's ground.
  decorators: [
    (Story) => (
      <div style={{ width: 560, padding: '10px 14px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewOffer>
export default meta
type Story = StoryObj<typeof meta>

/** A change whose work turned real with no review: offered one, once, quietly; nothing is added by itself. */
export const Offered: Story = {
  play: async ({ canvasElement }) => {
    const offer = within(canvasElement)
    await expect(offer.getByText('Add a review?')).toBeInTheDocument()
    await expect(offer.getByRole('button', { name: 'Add GPT-6.1 Sol' })).toBeInTheDocument()
    await expect(offer.getByRole('button', { name: 'No thanks' })).toBeInTheDocument()
  },
}
export const OfferedDark: Story = { ...Offered, globals: { theme: 'dark' } }
export const Busy: Story = { args: { busy: true } }
export const Failed: Story = { args: { error: 'Althar couldn’t add the review: its agent isn’t signed in.' } }
