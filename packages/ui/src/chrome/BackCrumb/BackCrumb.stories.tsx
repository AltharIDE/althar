import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { BackCrumb } from './BackCrumb'

const meta = {
  title: 'Chrome/BackCrumb',
  component: BackCrumb,
  args: { to: 'Meridian', kbd: 'esc', task: '418', title: 'Repair token refresh on privilege change', onBack: fn() },
} satisfies Meta<typeof BackCrumb>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** Only the way back. */
export const JustBack: Story = { args: { task: undefined, title: undefined } }

export const GoingBack: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Back to Meridian' }))
    await expect(args.onBack).toHaveBeenCalledOnce()
  },
}

/** The title edits where it is: pressing it turns it into a field, Enter keeps what was typed. */
export const Renaming: Story = {
  args: { onRename: fn(), maxLength: 60 },
  play: async ({ args, canvasElement }) => {
    const bar = within(canvasElement)
    await userEvent.click(bar.getByRole('button', { name: /^Rename: / }))
    const field = bar.getByRole('textbox', { name: 'Rename' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Repair token refresh{Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('Repair token refresh')
  },
}

/** Mid-edit, for a still picture. */
export const Editing: Story = { args: { onRename: fn(), maxLength: 60, editing: true } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <BackCrumb {...args} /> })),
        { state: 'just back', node: <BackCrumb {...args} task={undefined} title={undefined} /> },
      ]}
    />
  ),
}
