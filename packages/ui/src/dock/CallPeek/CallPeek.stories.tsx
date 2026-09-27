import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { CALL } from '../../fixtures/dock'
import { CallPeek } from './CallPeek'

const meta = {
  title: 'Dock/CallPeek',
  component: CallPeek,
  decorators: [(Story, { parameters }) => (parameters.pseudo ? Story() : <div style={{ width: 380 }}>{Story()}</div>)],
  args: { ...CALL, onRecord: fn() },
} satisfies Meta<typeof CallPeek>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** Only the question and the choices. */
export const Bare: Story = { args: { detail: undefined, evidence: undefined, releases: undefined } }

/** Record stays off until you choose. */
export const Recording: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Record decision' })).toBeDisabled()
    await userEvent.click(c.getByRole('radio', { name: /Fail fast/ }))
    await userEvent.click(c.getByRole('button', { name: 'Record decision' }))
    await expect(args.onRecord).toHaveBeenCalledWith('fail')
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'default', node: <CallPeek {...args} /> },
        { state: 'bare', node: <CallPeek {...args} {...Bare.args} /> },
      ]}
    />
  ),
}
