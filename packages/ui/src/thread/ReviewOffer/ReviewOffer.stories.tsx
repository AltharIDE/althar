import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { ReviewOffer } from './ReviewOffer'

const meta = {
  title: 'Thread/ReviewOffer',
  component: ReviewOffer,
  args: { who: 'GPT-6.1 Sol', onAdd: fn(), onDecline: fn() },
  // A line of the thread, where a lead offered it as the person asked to harden a prototype.
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
/** Offered from the coordinator's thread: it names the task. */
export const NamesTheTask: Story = { args: { ask: 'Add a review of “Context ring card”?' } }
/** Added: who reviews it. */
export const Added: Story = {
  args: { answered: 'GPT-6.1 Sol' },
  play: async ({ canvasElement }) => {
    const offer = within(canvasElement)
    await expect(offer.getByText('GPT-6.1 Sol reviews it.')).toBeInTheDocument()
    await expect(offer.queryByRole('button')).toBeNull()
  },
}
/** Turned down: it isn't offered again. */
export const Declined: Story = { args: { answered: null } }
export const Busy: Story = { args: { busy: true } }
export const Failed: Story = { args: { error: 'Althar couldn’t add the review: its agent isn’t signed in.' } }
