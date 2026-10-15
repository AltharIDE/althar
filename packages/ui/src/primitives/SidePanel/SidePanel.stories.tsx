import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { SidePanel, SidePanelBody, SidePanelTitle } from './SidePanel'

const meta = {
  title: 'Primitives/SidePanel',
  component: SidePanel,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: 360, width: 420, marginLeft: 'auto' }}>{Story()}</div>],
  args: {
    label: 'Connect GitHub',
    head: <SidePanelTitle>Connect GitHub</SidePanelTitle>,
    onClose: fn(),
    children: <SidePanelBody>What the panel holds.</SidePanelBody>,
  },
} satisfies Meta<typeof SidePanel>
export default meta
type Story = StoryObj<typeof meta>

/** Beside the thread: its title, and Close. Escape inside it closes it. */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByText('What the panel holds.'))
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
  },
}

/** A panel that steps through pages of its own has a way back first in its head. */
export const SteppingBack: Story = {
  args: { onBack: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Back' }))
    await expect(args.onBack).toHaveBeenCalled()
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'open', node: <SidePanel {...args} /> },
        { state: 'with a way back', node: <SidePanel {...args} onBack={fn()} /> },
      ]}
    />
  ),
}
