import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { laneDecorator, listDecorator } from '../../storybook/lane'
import { KeptRow } from './KeptRow'

const meta = {
  title: 'Board/KeptRow',
  component: KeptRow,
  decorators: [listDecorator, laneDecorator],
  args: {
    title: 'Prototype: link cards that belong to their messages',
    at: 'kept 2d ago',
    onOpen: fn(),
    onDone: fn(),
    doneHint: 'Settle it, and stop its page on :5388.',
  },
} satisfies Meta<typeof KeptRow>
export default meta
type Story = StoryObj<typeof meta>

/** Done at its end, shown as the row is hovered. */
export const Kept: Story = {
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement)
    await userEvent.hover(row.getByText('kept 2d ago'))
    await userEvent.click(row.getByRole('button', { name: 'Done' }))
    await expect(args.onDone).toHaveBeenCalled()
  },
}
/** A review kept for later: no Done, as it settles once its draft is posted. */
export const Review: Story = { args: { title: 'Review #281: Manage MCP servers in a project’s settings', onDone: undefined } }
/** Done under way. */
export const Settling: Story = { args: { busy: true } }
/** Done that didn't go through. */
export const Failed: Story = { args: { error: 'Althar couldn’t stop what the task left running. Try Done again.' } }
