import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TaskHeader } from '../../chrome/TaskHeader/TaskHeader'
import { TaskStatus } from '../../foundations/vocabulary'
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
  decorators: [
    // In the header, they are segments of the chip that says where the task stands: shown inside it.
    (Story, { args }) =>
      args.place === 'header' ? (
        <TaskHeader title="Prototype: allow everything" status={TaskStatus.Yours} state="Finished" beside={<Story />} />
      ) : (
        <Story />
      ),
  ],
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
/** In the task's header, inside where it stands, in its colour: Done in words, then the pin. */
export const InHeader: Story = {
  args: { place: 'header' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await expect(args.onDone).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Keep for later' }))
    await expect(args.onKeep).toHaveBeenCalled()
  },
}
/** Kept for later already: Done alone. */
export const Kept: Story = { args: { onKeep: undefined, place: 'header' } }
/** A drafted review: Keep for later alone, as it settles once posted. */
export const Review: Story = { args: { onDone: undefined } }
/** Done under way: it says so and keeps its place for the keyboard; the pin waits. */
export const Settling: Story = {
  args: { busy: 'done', place: 'header', onDone: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const done = canvas.getByRole('button', { name: 'Done' })
    await expect(done).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(done)
    await expect(args.onDone).not.toHaveBeenCalled()
    await expect(canvas.getByRole('button', { name: 'Keep for later' })).toBeDisabled()
  },
}
