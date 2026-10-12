import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { WindowButtons } from './WindowButtons'

const meta = {
  title: 'Chrome/WindowButtons',
  component: WindowButtons,
  args: { onClose: fn(), onMinimize: fn(), onToggleMaximize: fn() },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WindowButtons>
export default meta
type Story = StoryObj<typeof meta>

/** The window's controls, with no window attached. */
export const Rest: Story = {}
/** The third button says restore when the window is maximized. */
export const Maximized: Story = { args: { maximized: true } }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      cells={[
        { state: 'rest', node: <WindowButtons {...args} /> },
        { state: 'hover', node: <WindowButtons {...args} /> },
        { state: 'focus', node: <WindowButtons {...args} /> },
        { state: 'maximized', node: <WindowButtons {...args} maximized /> },
        { state: 'inert', node: <WindowButtons /> },
      ]}
    />
  ),
}
