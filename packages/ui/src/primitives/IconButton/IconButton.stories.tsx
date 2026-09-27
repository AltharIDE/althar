import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { IconButton, type IconButtonProps } from './IconButton'

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { icon: 'mic', label: 'Dictate', onClick: fn() },
} satisfies Meta<typeof IconButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Small: Story = { args: { size: 'small', icon: 'close', label: 'Close' } }
/** The one strong button in a bar: send. */
export const Fill: Story = { args: { tone: 'fill', icon: 'up', label: 'Send' } }
export const Danger: Story = { args: { tone: 'danger', icon: 'square', label: 'Stop dictating' } }
export const Pressed: Story = { args: { 'aria-pressed': true, icon: 'pin', label: 'Pinned' } }

const row = (p: IconButtonProps) =>
  ['rest', 'hover', 'focus', 'pressed', 'disabled'].map((state) => ({ state, node: <IconButton {...p} disabled={state === 'disabled'} /> }))

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <States cells={row({ icon: 'mic', label: 'Dictate' })} />
      <States cells={row({ icon: 'up', label: 'Send', tone: 'fill' })} />
      <States cells={row({ icon: 'square', label: 'Stop dictating', tone: 'danger' })} />
    </div>
  ),
}
