import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PhoneList } from './PhoneList'

const meta = {
  title: 'Setup/Phones/PhoneList',
  component: PhoneList,
  args: {
    home: 'This Mac',
    phones: [
      { id: 'dev_1a2b3c4d5e6f708192a3b4c5d6e7f809', name: 'iPhone', paired: 'Today', fresh: true },
      { id: 'dev_9f8e7d6c5b4a39281706f5e4d3c2b1a0', name: 'Pixel 9', paired: '12 Oct' },
      {
        id: 'dev_2b3c4d5e6f708192a3b4c5d6e7f8091a',
        name: 'The old iPhone 13 mini kept in the kitchen drawer for testing',
        paired: '14 Aug',
      },
    ],
    onRemove: fn(),
  },
  render: (args) => (
    <div style={{ width: 420 }}>
      <PhoneList {...args} />
    </div>
  ),
} satisfies Meta<typeof PhoneList>
export default meta
type Story = StoryObj<typeof meta>

/** Each phone with when it paired; Remove asks first, then takes it off. */
export const Phones: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.getByText('Paired just now')).toBeInTheDocument()
    await userEvent.click(view.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement)
    const dialog = within(document.body)
    await expect(dialog.getByText('Remove Pixel 9?')).toBeInTheDocument()
    await userEvent.click(dialog.getAllByRole('button', { name: 'Remove' }).at(-1) as HTMLElement)
    await expect(args.onRemove).toHaveBeenCalledWith('dev_9f8e7d6c5b4a39281706f5e4d3c2b1a0')
  },
}

/** Without Remove, as a window that can't take phones off shows them. */
export const ReadOnly: Story = { args: { onRemove: undefined } }
