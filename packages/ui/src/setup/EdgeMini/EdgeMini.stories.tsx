import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { EdgeSpot } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { EdgeMini } from './EdgeMini'

const meta = {
  title: 'Setup/EdgeMini',
  component: EdgeMini,
  parameters: { layout: 'centered' },
  args: { spot: EdgeSpot.Island },
} satisfies Meta<typeof EdgeMini>
export default meta
type Story = StoryObj<typeof meta>

/** Round the notch, as a module draws it. Only a picture: a screen reader passes over it. */
export const RoundTheNotch: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-hidden="true"]')).not.toBeNull()
    await expect(within(canvasElement).queryByRole('img')).toBeNull()
  },
}

/** Larger, for a page that shows it on its own. */
export const Larger: Story = { args: { spot: EdgeSpot.WindowsTray, scale: 2.6 } }

/** Every place, on every system. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'round the notch', node: <EdgeMini spot={EdgeSpot.Island} /> },
        { state: 'menu bar, beside the notch', node: <EdgeMini spot={EdgeSpot.MenuBesideNotch} /> },
        { state: 'menu bar, no notch', node: <EdgeMini spot={EdgeSpot.MenuBar} /> },
        { state: 'Windows’ tray', node: <EdgeMini spot={EdgeSpot.WindowsTray} /> },
        { state: 'Linux’s tray', node: <EdgeMini spot={EdgeSpot.LinuxTray} /> },
        { state: 'no tray', node: <EdgeMini spot={EdgeSpot.WindowOnly} /> },
        { state: 'larger', node: <EdgeMini spot={EdgeSpot.LinuxTray} scale={2.6} /> },
      ]}
    />
  ),
}
