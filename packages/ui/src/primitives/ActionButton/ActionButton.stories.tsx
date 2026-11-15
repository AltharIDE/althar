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
