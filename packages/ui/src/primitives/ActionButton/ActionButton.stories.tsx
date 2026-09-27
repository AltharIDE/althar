import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { States, statesParameters } from '../../storybook/States'
import { ActionButton, type ActionButtonProps } from './ActionButton'

const meta = {
  title: 'Primitives/ActionButton',
  component: ActionButton,
  args: { icon: 'quote', children: 'Quote', onClick: fn() },
} satisfies Meta<typeof ActionButton>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const IconOnly: Story = { args: { icon: 'close', children: undefined, 'aria-label': 'Close' } }
/** The one action on a row that matters most. */
export const Strong: Story = { args: { tone: 'strong', icon: undefined, children: 'Have it fixed' } }
export const OnDark: Story = {
  args: { tone: 'onDark', icon: 'close', children: 'Close', kbd: 'esc' },
  render: (args) => (
    <div style={{ padding: 10, borderRadius: 10, background: '#1d1c21' }}>
      <ActionButton {...args} />
    </div>
  ),
}
/** Inside a line of 11–12px text, such as a step's row. */
export const Small: Story = { args: { size: 'small', icon: undefined, children: 'Thread' } }
/** Opens a menu: the chevron comes after the label. */
export const WithTrailingIcon: Story = { args: { size: 'small', icon: undefined, trailingIcon: 'chevronD', children: 'This task' } }
/** Pulled out by its padding, so the label lines up with the right edge of the text above it. */
export const FlushEnd: Story = {
  args: { size: 'small', flush: 'end', icon: undefined, children: 'Thread' },
  render: (args) => (
    <div style={{ display: 'grid', justifyItems: 'end', width: 220, fontSize: 11.5, color: 'var(--t-3)' }}>
      <span>The edge of the text</span>
      <ActionButton {...args} />
    </div>
  ),
}
export const Pressed: Story = { args: { 'aria-pressed': true, icon: 'pin', children: 'Pinned' } }

const row = (p: ActionButtonProps, dark = false) =>
  ['rest', 'hover', 'focus', 'pressed', 'disabled'].map((state) => ({
    state,
    dark,
    node: <ActionButton {...p} disabled={state === 'disabled'} />,
  }))

export const AllStates: Story = {
  parameters: statesParameters,
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <States cells={row({ icon: 'external', children: 'Open in VS Code' })} />
      <States cells={row({ tone: 'strong', children: 'Have it fixed' })} />
      <States cells={row({ tone: 'onDark', icon: 'close', children: 'Close', kbd: 'esc' }, true)} />
      <States cells={row({ icon: 'close', 'aria-label': 'Close' })} />
      <States cells={row({ size: 'small', trailingIcon: 'chevronD', children: 'This task' })} />
      <States cells={row({ size: 'small', icon: 'close', 'aria-label': 'Close' })} />
    </div>
  ),
}
