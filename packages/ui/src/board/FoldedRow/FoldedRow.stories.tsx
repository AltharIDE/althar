import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { laneDecorator, listDecorator } from '../../storybook/lane'
import { FoldedRow } from './FoldedRow'

const meta = {
  title: 'Board/FoldedRow',
  component: FoldedRow,
  decorators: [listDecorator, laneDecorator],
  args: {
    title: 'Mobile: crisp pull-to-reload icon, no scroll jump after',
    into: 'Phone pairs with this Mac over Wi-Fi',
    at: 'just now',
    onOpen: fn(),
    onOpenInto: fn(),
    onResume: fn(),
  },
} satisfies Meta<typeof FoldedRow>
export default meta
type Story = StoryObj<typeof meta>

/** Its work went on in another task: where, which opens it, and Resume shown as the row is hovered. */
export const Folded: Story = {
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement)
    await expect(row.getByText('Folded into')).toBeInTheDocument()
    await userEvent.click(row.getByRole('button', { name: 'Phone pairs with this Mac over Wi-Fi' }))
    await expect(args.onOpenInto).toHaveBeenCalled()
    await expect(args.onOpen).not.toHaveBeenCalled()
    await userEvent.hover(row.getByText('just now'))
    await userEvent.click(row.getByRole('button', { name: 'Resume' }))
    await expect(args.onResume).toHaveBeenCalled()
  },
}
/** Resume under way. */
export const Resuming: Story = { args: { resuming: true } }
/** A long title, and a long task it went into, in a narrow lane: both cut, whole on hover. */
export const Long: Story = {
  args: {
    title: 'Mobile: model picker’s segment control doesn’t change the model, and the sheet closes before the choice is saved',
    into: 'Phone pairs with this Mac over Wi-Fi, and keeps the pairing across restarts of either side',
  },
}
