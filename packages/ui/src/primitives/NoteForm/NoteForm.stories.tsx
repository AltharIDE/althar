import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { NoteForm } from './NoteForm'

const meta = {
  title: 'Primitives/NoteForm',
  component: NoteForm,
  decorators: [(Story) => <div style={{ maxWidth: 520, display: 'flex' }}>{Story()}</div>],
  args: {
    placeholder: 'What should change? The lead picks it up with this note',
    submit: 'Send back',
    cancel: 'Cancel',
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof NoteForm>
export default meta
type Story = StoryObj<typeof meta>

/** It takes focus; Send stays off until there is a note. */
export const Empty: Story = {}

export const Sending: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('textbox')).toHaveFocus()
    await expect(c.getByRole('button', { name: 'Send back' })).toBeDisabled()
    await userEvent.type(c.getByRole('textbox'), '   ')
    await expect(c.getByRole('button', { name: 'Send back' })).toBeDisabled()
    await userEvent.type(c.getByRole('textbox'), 'Keep the old cache')
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await expect(args.onSubmit).toHaveBeenCalledWith('Keep the old cache')
  },
}

export const Cancelling: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalledTimes(2)
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  render: (args) => <States size="wide" cells={[{ state: 'empty', node: <NoteForm {...args} /> }]} />,
}
