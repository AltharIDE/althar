import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SettleWays } from './SettleWays'

const meta = {
  title: 'Board/SettleWays',
  component: SettleWays,
  args: {
    onDone: fn(),
    onKeep: fn(),
    doneHint: 'Settle it, and stop its page on :5361.',
    keepHint: 'Out of Needs you, as it is, its page still up.',
  },
} satisfies Meta<typeof SettleWays>
export default meta
type Story = StoryObj<typeof meta>

/** For a finished card's corner: a pin, Keep for later, and a check, Done, each named on hover. */
export const OnCard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await expect(args.onDone).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Keep for later' }))
    await expect(args.onKeep).toHaveBeenCalled()
  },
}
/** In the task's header, beside where it stands: Done in words and in ink, then the pin. */
export const InHeader: Story = { args: { place: 'header' } }
/** Kept for later already: Done alone. */
export const Kept: Story = { args: { onKeep: undefined, place: 'header' } }
/** A drafted review: Keep for later alone, as it settles once posted. */
export const Review: Story = { args: { onDone: undefined } }
/** Done under way. */
export const Settling: Story = { args: { busy: 'done', place: 'header' } }
