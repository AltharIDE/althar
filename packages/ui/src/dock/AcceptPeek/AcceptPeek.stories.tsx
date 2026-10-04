import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { ACCEPT } from '../../fixtures/dock'
import { CHECKS_RUNNING } from '../../fixtures/outputs'
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
/** No reviewer named, no link to the host, files not links. */
export const Plain: Story = { args: { reviewers: [], url: undefined, onOpenFile: undefined } }
/** A pull request no checks ran on: it says so, and can be accepted. */
export const NoChecks: Story = {
  args: { checks: [] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('No checks ran on it.')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: /Accept and merge/ })).toBeInTheDocument()
  },
}

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

/** The lead committed more since: pushed first, before anything can be accepted. */
export const Unpushed: Story = {
  args: { unpushed: 2, onPush: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('2 commits aren’t on the pull request yet')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Accept and merge' })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Push' }))
    await expect(args.onPush).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'default', node: <AcceptPeek {...args} /> },
        { state: 'plain', node: <AcceptPeek {...args} {...Plain.args} /> },
        { state: 'a check still running', node: <AcceptPeek {...args} checks={CHECKS_RUNNING} /> },
        { state: 'accepting', node: <AcceptPeek {...args} accepting /> },
        { state: 'sending back', node: <AcceptPeek {...args} sendingBack /> },
        { state: 'a commit to push', node: <AcceptPeek {...args} unpushed={1} onPush={() => {}} /> },
        { state: 'pushing', node: <AcceptPeek {...args} unpushed={2} onPush={() => {}} pushing /> },
        { state: 'accept failed', node: <AcceptPeek {...args} error="GitHub refused the merge: the branch is behind main." /> },
      ]}
    />
  ),
}
