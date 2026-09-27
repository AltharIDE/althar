import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { ACCEPT } from '../../fixtures/dock'
import { AcceptPeek } from './AcceptPeek'

const meta = {
  title: 'Dock/AcceptPeek',
  component: AcceptPeek,
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ width: 380 }}>{Story()}</div>)],
  args: { ...ACCEPT, onAccept: fn(), onSendBack: fn(), onOpenFile: fn() },
} satisfies Meta<typeof AcceptPeek>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** No reviewer named, no link to GitHub, files not links. */
export const Plain: Story = { args: { reviewers: [], url: undefined, onOpenFile: undefined } }

export const Accepting: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open the diff of src/refunds/create.ts' }))
    await expect(args.onOpenFile).toHaveBeenCalledWith('src/refunds/create.ts')
    await userEvent.click(c.getByRole('button', { name: 'Accept and merge' }))
    await expect(args.onAccept).toHaveBeenCalledOnce()
  },
}

export const SendingBack: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await userEvent.type(c.getByRole('textbox', { name: 'What should change?' }), 'Return 422, not 409')
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await expect(args.onSendBack).toHaveBeenCalledWith('Return 422, not 409')
    await userEvent.click(c.getByRole('button', { name: 'Send back' }))
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(c.getByRole('button', { name: 'Accept and merge' })).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'default', node: <AcceptPeek {...args} /> },
        { state: 'plain', node: <AcceptPeek {...args} {...Plain.args} /> },
      ]}
    />
  ),
}
