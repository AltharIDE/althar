import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { SidePanel, SidePanelBody, SidePanelTitle } from './SidePanel'

const meta = {
  title: 'Primitives/SidePanel',
  component: SidePanel,
  args: {
    label: 'Connect GitHub',
    head: <SidePanelTitle>Connect GitHub</SidePanelTitle>,
    onClose: fn(),
    children: <SidePanelBody>What the panel holds.</SidePanelBody>,
  },
} satisfies Meta<typeof SidePanel>
export default meta
type Story = StoryObj<typeof meta>

/** At the window's right edge, as it opens beside the thread. */
const beside = {
  parameters: { layout: 'fullscreen' },
  decorators: [(Story: () => ReactNode) => <div style={{ height: 360, width: 420, marginLeft: 'auto' }}>{Story()}</div>],
}

/** Beside the thread: its title, and Close. Escape inside it closes it. */
export const Open: Story = {
  ...beside,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByText('What the panel holds.'))
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
  },
}

/** A panel that steps through pages of its own has a way back first in its head. */
export const SteppingBack: Story = {
  ...beside,
  args: { onBack: fn() },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Back' }))
    await expect(args.onBack).toHaveBeenCalled()
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

/** A panel's height, at a cell's width. */
const box = (node: ReactNode) => <div style={{ flex: 1, height: 220 }}>{node}</div>

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'open', node: box(<SidePanel {...args} />) },
        { state: 'with a way back', node: box(<SidePanel {...args} onBack={fn()} />) },
      ]}
    />
  ),
}
